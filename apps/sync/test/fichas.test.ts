/**
 * El relleno de géneros, poco a poco.
 *
 * Lo que hay que dejar clavado son las dos reglas de las que depende que el
 * recorrido termine algún día:
 *
 * - **No se repite lo ya preguntado**, incluido lo que el panel dejó en
 *   blanco. Sin eso, cada pasada volvería sobre las mismas cuatrocientas
 *   películas sin género y el catálogo no avanzaría nunca.
 * - **Se empieza por lo último que ha entrado**, que es lo que llena los
 *   carruseles del inicio: así se nota desde el primer día y no al final del
 *   mes.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { rellenarFichas } from '../src/fichas.ts';
import type { FichaTmdb } from '../src/tmdb.ts';

const URL_PANEL = 'http://panel/get.php?username=u&password=p';

/** Un TMDb de mentira que contesta siempre lo mismo, o nunca. */
function tmdbFalso(ficha: FichaTmdb | null) {
  return { async fichaDe(): Promise<FichaTmdb | null> { return ficha; } };
}

/** Un panel de mentira con cuatro películas de distintas fechas de alta. */
function panelFalso(preguntadas: number[] = []): typeof globalThis.fetch {
  const respuesta = (datos: unknown): Response =>
    new Response(JSON.stringify(datos), { status: 200, headers: { 'Content-Type': 'application/json' } });

  return (async (entrada: string | URL | Request) => {
    const url = new URL(String(entrada));
    const accion = url.searchParams.get('action');

    if (accion === 'get_vod_streams') {
      return respuesta([
        { stream_id: 1, name: 'La vieja (2001)', added: '1000' },
        { stream_id: 2, name: 'La nueva (2024)', added: '4000' },
        { stream_id: 3, name: 'La de en medio (2015)', added: '3000' },
        // Otra calidad de la más nueva: comparte identificador y no se
        // pregunta dos veces.
        { stream_id: 4, name: 'La nueva (2024) 720p', added: '3900' },
        // Y una de la que el panel no sabe el género.
        { stream_id: 5, name: 'La muda (2020)', added: '2000' },
      ]);
    }

    if (accion === 'get_series') {
      return respuesta([
        { series_id: 9, name: 'La serie', releaseDate: '2022-04-01', last_modified: '3500' },
      ]);
    }

    if (accion === 'get_vod_info') {
      const id = Number(url.searchParams.get('vod_id'));
      preguntadas.push(id);
      if (id === 5) return respuesta({ info: {} });
      return respuesta({ info: { genre: `Género ${id}`, plot: `La sinopsis de ${id}.` } });
    }

    return respuesta({});
  }) as typeof globalThis.fetch;
}

test('se empieza por lo último que ha entrado', async () => {
  const averiguados = await rellenarFichas(URL_PANEL, {
    conocidas: new Set(),
    cuantas: 2,
    fetch: panelFalso(),
  });

  assert.deepEqual(
    averiguados.map((uno) => uno.id),
    ['la-nueva-2024', 'la-de-en-medio-2015'],
  );
});

test('lo ya preguntado no se vuelve a preguntar', async () => {
  const preguntadas: number[] = [];
  const averiguados = await rellenarFichas(URL_PANEL, {
    conocidas: new Set(['la-nueva-2024', 'la-de-en-medio-2015']),
    cuantas: 2,
    fetch: panelFalso(preguntadas),
  });

  assert.deepEqual(
    averiguados.map((uno) => uno.id),
    ['la-muda-2020', 'la-vieja-2001'],
  );
  assert.deepEqual(preguntadas, [5, 1], 'ni la nueva ni la de en medio se han pedido al panel');
});

test('lo que el panel no sabe también se apunta, con el género vacío', async () => {
  const averiguados = await rellenarFichas(URL_PANEL, {
    conocidas: new Set(['la-nueva-2024', 'la-de-en-medio-2015', 'la-vieja-2001']),
    cuantas: 5,
    fetch: panelFalso(),
  });

  /*
    Se devuelve para poder guardarla como preguntada. Si se omitiera, mañana
    volvería a ser candidata y el recorrido se atascaría en las que el panel no
    sabe contestar.
  */
  assert.deepEqual(averiguados, [
    { id: 'la-muda-2020', clase: 'pelicula', genero: '', sinopsis: undefined, reparto: undefined, fondo: undefined, trailer: undefined },
  ]);
});

test('TMDb contesta primero, y el panel solo lo que aquel no sepa', async () => {
  const preguntadas: number[] = [];
  const averiguados = await rellenarFichas(URL_PANEL, {
    conocidas: new Set(['la-de-en-medio-2015', 'la-muda-2020', 'la-vieja-2001']),
    cuantas: 5,
    fetch: panelFalso(preguntadas),
    tmdb: tmdbFalso({ genero: 'Comedia', sinopsis: 'Una comedia.' }),
  });

  assert.deepEqual(averiguados, [
    { id: 'la-nueva-2024', clase: 'pelicula', genero: 'Comedia', sinopsis: 'Una comedia.' },
    // Las series entran en el mismo recorrido, ordenadas por lo mismo.
    { id: 'la-serie-2022', clase: 'serie', genero: 'Comedia', sinopsis: 'Una comedia.' },
  ]);
  assert.deepEqual(preguntadas, [], 'al panel no se le ha preguntado nada');
});

test('lo que TMDb no reconoce se le acaba preguntando al panel', async () => {
  const preguntadas: number[] = [];
  const averiguados = await rellenarFichas(URL_PANEL, {
    conocidas: new Set(['la-de-en-medio-2015', 'la-muda-2020', 'la-vieja-2001']),
    cuantas: 5,
    fetch: panelFalso(preguntadas),
    // Vacío es "no la conozco": es el caso del cine local y de los títulos
    // que el proveedor escribe a su manera.
    tmdb: tmdbFalso(null),
  });

  assert.deepEqual(averiguados, [
    {
      id: 'la-nueva-2024',
      clase: 'pelicula',
      genero: 'Género 2',
      sinopsis: 'La sinopsis de 2.',
      reparto: undefined,
      fondo: undefined,
      trailer: undefined,
    },
    /*
      La serie se queda sin nada y no se le pregunta al panel: su ficha viene
      con la lista entera de episodios detrás, y bajarse eso 6.500 veces por
      una sinopsis no sale a cuenta. Se apunta igualmente, para no volver
      sobre ella mañana.
    */
    { id: 'la-serie-2022', clase: 'serie', genero: '' },
  ]);
  assert.deepEqual(preguntadas, [2], 'al panel solo se le pregunta por la película');
});

test('dos calidades de la misma película cuestan una sola pregunta', async () => {
  const preguntadas: number[] = [];
  await rellenarFichas(URL_PANEL, {
    conocidas: new Set(),
    cuantas: 5,
    fetch: panelFalso(preguntadas),
  });

  assert.equal(preguntadas.filter((id) => id === 4).length, 0, 'la segunda calidad no se pregunta');
  assert.equal(preguntadas.length, 4, 'cinco entradas, cuatro películas');
});
