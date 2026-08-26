/**
 * El servidor de sincronización, de punta a punta.
 *
 * Se levanta de verdad en un puerto libre y se le habla con `fetch`, porque
 * lo que más se rompe de esto no son las funciones sueltas sino el reparto:
 * qué ruta contesta qué, quién puede llamar sin token y qué ve cada grupo.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { Panel } from '../src/panel.ts';
import { crearServidor } from '../src/servidor.ts';

interface Montaje {
  url: string;
  panel: Panel;
  codigo: string;
  cerrar: () => Promise<void>;
}

/** Levanta un servidor limpio en un puerto que elija el sistema. */
async function montar(): Promise<Montaje> {
  const carpeta = mkdtempSync(join(tmpdir(), 'm3u-sync-'));
  const panel = new Panel(carpeta);
  const codigo = 'ABCD-2345';
  const servidor = crearServidor(panel, () => codigo);

  await new Promise<void>((listo) => servidor.listen(0, '127.0.0.1', listo));
  const puerto = (servidor.address() as AddressInfo).port;

  return {
    url: `http://127.0.0.1:${puerto}`,
    panel,
    codigo,
    cerrar: async () => {
      await new Promise<void>((hecho) => servidor.close(() => hecho()));
      panel.cerrar();
      try {
        rmSync(carpeta, { recursive: true, force: true });
      } catch {
        // En Windows el fichero puede seguir bloqueado un instante; no es
        // motivo para dar por fallado el test.
      }
    },
  };
}

async function pedir(
  url: string,
  ruta: string,
  opciones: { metodo?: string; cuerpo?: unknown; token?: string } = {},
): Promise<{ estado: number; datos: Record<string, unknown> }> {
  const cabeceras: Record<string, string> = { 'content-type': 'application/json' };
  if (opciones.token) cabeceras.authorization = `Bearer ${opciones.token}`;

  const respuesta = await fetch(`${url}${ruta}`, {
    method: opciones.metodo ?? 'POST',
    headers: cabeceras,
    body: opciones.cuerpo === undefined ? undefined : JSON.stringify(opciones.cuerpo),
  });
  const texto = await respuesta.text();
  return { estado: respuesta.status, datos: texto ? (JSON.parse(texto) as Record<string, unknown>) : {} };
}

/** Emparejar un aparato entero: pide alta, lo apruebas, recoge su token. */
async function emparejar(m: Montaje, grupoId: string, nombre: string): Promise<string> {
  const alta = await pedir(m.url, '/api/alta', { cuerpo: { aparato: `a-${nombre}`, apodo: nombre } });
  const codigo = alta.datos.codigo as string;
  const espera = alta.datos.espera as string;

  assert.ok(m.panel.aprobar(codigo, grupoId, nombre), 'la aprobación debería salir bien');

  const recogida = await pedir(m.url, '/api/espera', { cuerpo: { espera } });
  assert.equal(recogida.datos.estado, 'aprobado');
  return recogida.datos.token as string;
}

/** Un avance de película, en la forma en que viajan los cambios. */
function avance(segundos: number, cuando: string, origen: string) {
  return {
    tabla: 'progress',
    clave: ['ana', 'pelicula', 'lola-pater-2017'],
    campos: { seconds: segundos, duration: 5400, title: 'Lola Pater' },
    actualizado: cuando,
    borrado: false,
    origen,
  };
}

test('el alta da un código corto y un secreto de espera distintos', async () => {
  const m = await montar();
  try {
    const alta = await pedir(m.url, '/api/alta', { cuerpo: { apodo: 'Philips 50PUS' } });

    assert.equal(alta.estado, 200);
    assert.match(alta.datos.codigo as string, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    // El secreto de espera es largo: es lo que protege de verdad el alta, y
    // por eso no puede ser el código que se enseña en pantalla.
    assert.ok((alta.datos.espera as string).length >= 64);
    assert.notEqual(alta.datos.codigo, alta.datos.espera);
  } finally {
    await m.cerrar();
  }
});

test('mientras no lo apruebas, el aparato se queda esperando', async () => {
  const m = await montar();
  try {
    const alta = await pedir(m.url, '/api/alta', { cuerpo: {} });
    const espera = await pedir(m.url, '/api/espera', { cuerpo: { espera: alta.datos.espera } });

    assert.equal(espera.datos.estado, 'pendiente');
    assert.equal(espera.datos.token, undefined);
  } finally {
    await m.cerrar();
  }
});

test('adivinar el código corto no sirve para llevarse el token', async () => {
  const m = await montar();
  try {
    m.panel.crearGrupo('Casa Triana');
    const alta = await pedir(m.url, '/api/alta', { cuerpo: {} });
    m.panel.aprobar(alta.datos.codigo as string, 'casa-triana', 'TV Salón');

    // Con el código corto en la mano, que es lo que se ve en la pantalla.
    const intento = await pedir(m.url, '/api/espera', { cuerpo: { espera: alta.datos.codigo } });
    assert.equal(intento.estado, 404);
    assert.equal(intento.datos.token, undefined);
  } finally {
    await m.cerrar();
  }
});

test('al aprobarlo recibe token, grupo y las listas de la casa', async () => {
  const m = await montar();
  try {
    const grupo = m.panel.crearGrupo('Casa Triana');
    m.panel.guardarLista(grupo.id, 'Principal', 'http://panel.example:8080/get.php?username=u&password=p');

    const alta = await pedir(m.url, '/api/alta', { cuerpo: { apodo: 'Philips' } });
    m.panel.aprobar(alta.datos.codigo as string, grupo.id, 'TV Salón');
    const recogida = await pedir(m.url, '/api/espera', { cuerpo: { espera: alta.datos.espera } });

    assert.equal(recogida.datos.estado, 'aprobado');
    assert.ok((recogida.datos.token as string).length >= 64);
    assert.deepEqual(recogida.datos.grupo, { id: grupo.id, nombre: 'Casa Triana' });
    assert.equal((recogida.datos.listas as unknown[]).length, 1);
  } finally {
    await m.cerrar();
  }
});

test('el token se entrega una sola vez', async () => {
  const m = await montar();
  try {
    const grupo = m.panel.crearGrupo('Casa Triana');
    const alta = await pedir(m.url, '/api/alta', { cuerpo: {} });
    m.panel.aprobar(alta.datos.codigo as string, grupo.id, 'TV Salón');

    const primera = await pedir(m.url, '/api/espera', { cuerpo: { espera: alta.datos.espera } });
    assert.equal(primera.datos.estado, 'aprobado');

    // De él solo queda la huella, así que no hay segunda entrega.
    const segunda = await pedir(m.url, '/api/espera', { cuerpo: { espera: alta.datos.espera } });
    assert.equal(segunda.estado, 404);
  } finally {
    await m.cerrar();
  }
});

test('sin token no se sincroniza', async () => {
  const m = await montar();
  try {
    const sinNada = await pedir(m.url, '/api/sync', { cuerpo: { desde: '', cambios: [] } });
    assert.equal(sinNada.estado, 401);

    const inventado = await pedir(m.url, '/api/sync', { cuerpo: { desde: '' }, token: 'a'.repeat(64) });
    assert.equal(inventado.estado, 401);
  } finally {
    await m.cerrar();
  }
});

test('lo dejado a medias en la tele le llega a la tablet', async () => {
  const m = await montar();
  try {
    const grupo = m.panel.crearGrupo('Casa Triana');
    const tele = await emparejar(m, grupo.id, 'tele');
    const tablet = await emparejar(m, grupo.id, 'tablet');

    // La tele sube por dónde iba.
    const subida = await pedir(m.url, '/api/sync', {
      cuerpo: { desde: '', cambios: [avance(1800, '2026-08-22T21:00:00.000Z', 'tele')] },
      token: tele,
    });
    assert.equal(subida.estado, 200);

    // Y la tablet, que no sabía nada, se lo encuentra.
    const bajada = await pedir(m.url, '/api/sync', { cuerpo: { desde: '', cambios: [] }, token: tablet });
    const cambios = bajada.datos.cambios as Array<Record<string, unknown>>;
    const suyo = cambios.find((cambio) => cambio.tabla === 'progress');
    assert.equal((suyo?.campos as Record<string, unknown>).seconds, 1800);
    // La marca es el sello con que el servidor lo recibió, no la fecha en que
    // se vio la película: son dos relojes distintos y no se mezclan.
    assert.equal(bajada.datos.marca, suyo?.sello);
    assert.notEqual(bajada.datos.marca, '2026-08-22T21:00:00.000Z');
  } finally {
    await m.cerrar();
  }
});

test('con la marca puesta no se vuelve a bajar lo mismo', async () => {
  const m = await montar();
  try {
    const grupo = m.panel.crearGrupo('Casa Triana');
    const tele = await emparejar(m, grupo.id, 'tele');

    const primera = await pedir(m.url, '/api/sync', {
      cuerpo: { desde: '', cambios: [avance(1800, '2026-08-22T21:00:00.000Z', 'tele')] },
      token: tele,
    });

    // La marca que se guarda es **la que devuelve el servidor**, que va en su
    // escala de recepción. Mandar una fecha de cambio aquí no filtraría nada,
    // y es justo la confusión que hay que no tener.
    const otra = await pedir(m.url, '/api/sync', {
      cuerpo: { desde: primera.datos.marca, cambios: [] },
      token: tele,
    });

    assert.deepEqual(otra.datos.cambios, []);
  } finally {
    await m.cerrar();
  }
});

test('una casa no ve el historial de la otra', async () => {
  const m = await montar();
  try {
    const triana = m.panel.crearGrupo('Casa Triana');
    const fariones = m.panel.crearGrupo('Casa Fariones');
    const enTriana = await emparejar(m, triana.id, 'tele-triana');
    const enFariones = await emparejar(m, fariones.id, 'tele-fariones');

    await pedir(m.url, '/api/sync', {
      cuerpo: { desde: '', cambios: [avance(1800, '2026-08-22T21:00:00.000Z', 'tele-triana')] },
      token: enTriana,
    });

    const otra = await pedir(m.url, '/api/sync', { cuerpo: { desde: '', cambios: [] }, token: enFariones });
    assert.deepEqual(otra.datos.cambios, []);
  } finally {
    await m.cerrar();
  }
});

test('un aparato revocado deja de entrar', async () => {
  const m = await montar();
  try {
    const grupo = m.panel.crearGrupo('Casa Triana');
    const token = await emparejar(m, grupo.id, 'tablet');

    const antes = await pedir(m.url, '/api/sync', { cuerpo: { desde: '', cambios: [] }, token });
    assert.equal(antes.estado, 200);

    const suyo = m.panel.aparatosDe(grupo.id)[0];
    m.panel.revocar(suyo!.id);

    const despues = await pedir(m.url, '/api/sync', { cuerpo: { desde: '', cambios: [] }, token });
    assert.equal(despues.estado, 401);
  } finally {
    await m.cerrar();
  }
});

test('un cambio con mala pinta se descarta sin tirar el resto de la tanda', async () => {
  const m = await montar();
  try {
    const grupo = m.panel.crearGrupo('Casa Triana');
    const token = await emparejar(m, grupo.id, 'tele');

    const subida = await pedir(m.url, '/api/sync', {
      cuerpo: {
        desde: '',
        cambios: [
          { tabla: 'progress', clave: ['solo-una-parte'], campos: {}, actualizado: 'x', borrado: false, origen: null },
          { tabla: 'DROP TABLE progress', clave: ['a'], campos: {}, actualizado: 'x', borrado: false, origen: null },
          avance(1800, '2026-08-22T21:00:00.000Z', 'tele'),
        ],
      },
      token,
    });

    assert.equal(subida.estado, 200);
    const bajada = await pedir(m.url, '/api/sync', { cuerpo: { desde: '', cambios: [] }, token });
    const cambios = bajada.datos.cambios as Array<Record<string, unknown>>;
    assert.equal(cambios.length, 1);
    assert.equal((cambios[0]?.campos as Record<string, unknown>).seconds, 1800);
  } finally {
    await m.cerrar();
  }
});

test('las listas se piden aparte, y solo con token', async () => {
  const m = await montar();
  try {
    const grupo = m.panel.crearGrupo('Casa Triana');
    m.panel.guardarLista(grupo.id, 'Principal', 'http://panel.example:8080/get.php?username=u&password=p');
    const token = await emparejar(m, grupo.id, 'tele');

    const sin = await pedir(m.url, '/api/listas', { metodo: 'GET' });
    assert.equal(sin.estado, 401);

    const con = await pedir(m.url, '/api/listas', { metodo: 'GET', token });
    assert.equal((con.datos.listas as unknown[]).length, 1);
  } finally {
    await m.cerrar();
  }
});

test('la tele que llevaba una semana apagada no se queda sin subir lo suyo', async () => {
  // El fallo que esto vigila: si las novedades se pidieran por la fecha del
  // cambio, lo que la tele escribió el martes llegaría al servidor el lunes
  // siguiente, por detrás de la marca que la tablet ya tiene del domingo, y
  // la tablet no lo vería jamás. Se piden por el sello de recepción del
  // servidor justo para esto.
  const m = await montar();
  try {
    const grupo = m.panel.crearGrupo('Casa Triana');
    const tele = await emparejar(m, grupo.id, 'tele');
    const tablet = await emparejar(m, grupo.id, 'tablet');

    // La tablet va sincronizando y su marca avanza hasta el domingo.
    await pedir(m.url, '/api/sync', {
      cuerpo: {
        desde: '',
        cambios: [
          {
            tabla: 'favorite',
            clave: ['ana', 'pelicula', 'el-aviso-2018'],
            campos: { title: 'El aviso', created: '2026-08-23T10:00:00.000Z' },
            actualizado: '2026-08-23T10:00:00.000Z',
            borrado: false,
            origen: 'tablet',
          },
        ],
      },
      token: tablet,
    });
    const alDia = await pedir(m.url, '/api/sync', { cuerpo: { desde: '', cambios: [] }, token: tablet });
    const marca = alDia.datos.marca as string;

    // Y ahora la tele sube por fin lo que anotó el martes anterior.
    await pedir(m.url, '/api/sync', {
      cuerpo: { desde: '', cambios: [avance(1800, '2026-08-18T21:00:00.000Z', 'tele')] },
      token: tele,
    });

    // La tablet pide novedades desde su marca y tiene que verlo, aunque la
    // fecha del cambio sea de hace cinco días.
    const despues = await pedir(m.url, '/api/sync', { cuerpo: { desde: marca, cambios: [] }, token: tablet });
    const cambios = despues.datos.cambios as Array<Record<string, unknown>>;
    const suyo = cambios.find((cambio) => cambio.tabla === 'progress');

    assert.ok(suyo, 'la tablet debería ver el avance atrasado de la tele');
    assert.equal((suyo!.campos as Record<string, unknown>).seconds, 1800);
  } finally {
    await m.cerrar();
  }
});

test('dos tandas seguidas no comparten sello', async () => {
  // Si dos tandas cayeran en el mismo milisegundo llevarían el mismo sello, y
  // el aparato que se quedara con esa marca no volvería a ver la segunda.
  const m = await montar();
  try {
    const sellos = new Set<string>();
    for (let i = 0; i < 50; i++) sellos.add(m.panel.selloNuevo());
    assert.equal(sellos.size, 50);
  } finally {
    await m.cerrar();
  }
});
