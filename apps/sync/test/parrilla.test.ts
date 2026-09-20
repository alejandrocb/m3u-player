/**
 * La parrilla del directo: traerla, guardarla y entregar lo que echan ahora.
 *
 * Lo que hay que dejar clavado es que el servidor **no manda la parrilla
 * entera**: manda dos programas por canal, el de ahora y el siguiente. Es lo
 * que separa una respuesta de decenas de kilobytes de una de varios megas.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { Panel } from '../src/panel.ts';
import { traerParrilla } from '../src/parrilla.ts';

/** Un panel de mentira que sirve un XMLTV con dos canales. */
function panelFalso(xml: string): typeof globalThis.fetch {
  return (async (entrada: string | URL | Request) => {
    const url = new URL(String(entrada));
    assert.equal(url.pathname, '/xmltv.php');
    // Las credenciales van en la petición, que es como las pide el panel.
    assert.equal(url.searchParams.get('username'), 'u');
    assert.equal(url.searchParams.get('password'), 'p');
    return new Response(xml, { status: 200 });
  }) as typeof globalThis.fetch;
}

const XML = `<tv>
  <channel id="La1.es"><display-name>La 1</display-name></channel>
  <channel id="Antena3.es"><display-name>Antena 3</display-name></channel>
  <programme start="20260829170000 +0000" stop="20260829180000 +0000" channel="La1.es"><title>Lo de antes</title></programme>
  <programme start="20260829180000 +0000" stop="20260829193000 +0000" channel="La1.es"><title>Lo de ahora</title></programme>
  <programme start="20260829193000 +0000" stop="20260829210000 +0000" channel="La1.es"><title>Lo siguiente</title></programme>
  <programme start="20260829210000 +0000" stop="20260829220000 +0000" channel="La1.es"><title>Lo de después</title></programme>
  <programme start="20260829180000 +0000" stop="20260829200000 +0000" channel="Antena3.es"><title>La otra cadena</title></programme>
</tv>`;

const URL_LISTA = 'http://panel.example:8080/get.php?username=u&password=p&type=m3u_plus';

test('se trae el EPG entero y lo deja listo para guardar', async () => {
  const traida = await traerParrilla(URL_LISTA, { fetch: panelFalso(XML) });

  assert.equal(traida.canales, 2);
  assert.equal(traida.programas.length, 5);
  // Las horas viajan en ISO y en UTC: el huso lo pone el aparato al pintar.
  const antes = traida.programas.find((uno) => uno.titulo === 'Lo de antes')!;
  assert.equal(antes.desde, '2026-08-29T17:00:00.000Z');
  assert.equal(antes.hasta, '2026-08-29T18:00:00.000Z');
});

test('sin usuario y contraseña no hay a quién pedírselo', async () => {
  await assert.rejects(() => traerParrilla('http://panel.example:8080/get.php'), /usuario y contraseña/);
});

function conPanel(prueba: (panel: Panel) => void | Promise<void>): () => Promise<void> {
  return async () => {
    const carpeta = mkdtempSync(join(tmpdir(), 'parrilla-'));
    const panel = new Panel(carpeta);
    try {
      await prueba(panel);
    } finally {
      panel.cerrar();
      rmSync(carpeta, { recursive: true, force: true });
    }
  };
}

test(
  'lo que echan son dos por canal: el de ahora y el siguiente',
  conPanel(async (panel) => {
    const traida = await traerParrilla(URL_LISTA, { fetch: panelFalso(XML) });
    panel.guardarParrilla('lista-1', traida.programas);

    const ahora = '2026-08-29T18:45:00.000Z';
    const echan = panel.loQueEchan('lista-1', ahora);

    assert.deepEqual(
      echan.map((uno) => `${uno.canal}: ${uno.titulo}`),
      [
        // De La 1, el que está en marcha y el que viene; "lo de después" no,
        // que en la ficha de un canal no cabe.
        'Antena3.es: La otra cadena',
        'La1.es: Lo de ahora',
        'La1.es: Lo siguiente',
      ],
    );
  }),
);

test(
  'lo que ya terminó no se manda',
  conPanel(async (panel) => {
    const traida = await traerParrilla(URL_LISTA, { fetch: panelFalso(XML) });
    panel.guardarParrilla('lista-1', traida.programas);

    const echan = panel.loQueEchan('lista-1', '2026-08-29T18:45:00.000Z');
    assert.equal(
      echan.some((uno) => uno.titulo === 'Lo de antes'),
      false,
    );
  }),
);

test(
  'volver a guardarla reemplaza la anterior, no la acumula',
  conPanel(async (panel) => {
    const traida = await traerParrilla(URL_LISTA, { fetch: panelFalso(XML) });
    panel.guardarParrilla('lista-1', traida.programas);
    panel.guardarParrilla('lista-1', traida.programas);

    assert.equal(panel.parrillaDe('lista-1')!.programas, 5);
    assert.equal(panel.loQueEchan('lista-1', '2026-08-29T18:45:00.000Z').length, 3);
  }),
);

test(
  'la parrilla de una lista no se mezcla con la de otra',
  conPanel(async (panel) => {
    const traida = await traerParrilla(URL_LISTA, { fetch: panelFalso(XML) });
    panel.guardarParrilla('lista-1', traida.programas);

    assert.equal(panel.loQueEchan('lista-2', '2026-08-29T18:45:00.000Z').length, 0);
    assert.equal(panel.parrillaDe('lista-2'), null);
  }),
);

test(
  'un canal sin programación no aparece, y eso no es un fallo',
  conPanel(async (panel) => {
    // 272 de los 463 canales de la lista real no traen tvg-id y no salen en el
    // XMLTV. Preguntar por uno de ellos devuelve vacío, no un error.
    const traida = await traerParrilla(URL_LISTA, { fetch: panelFalso(XML) });
    panel.guardarParrilla('lista-1', traida.programas);

    const echan = panel.loQueEchan('lista-1', '2026-08-29T18:45:00.000Z');
    assert.equal(
      echan.some((uno) => uno.canal === 'NBA-01'),
      false,
    );
  }),
);
