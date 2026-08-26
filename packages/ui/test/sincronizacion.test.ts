import assert from 'node:assert/strict';
import test from 'node:test';

import type { Cambio } from '../src/sincronizacion.ts';
import { fusionar, gana, marcaTras } from '../src/sincronizacion.ts';

/** Un avance de una película, con lo justo para distinguirlo. */
function avance(segundos: number, actualizado: string, origen = 'tele'): Cambio {
  return {
    tabla: 'progress',
    clave: ['ana', 'pelicula', 'lola-pater-2017'],
    campos: { seconds: segundos, duration: 5400, title: 'Lola Pater' },
    actualizado,
    borrado: false,
    origen,
  };
}

test('gana el cambio más reciente', () => {
  const enLaTele = avance(600, '2026-08-20T21:00:00.000Z', 'tele');
  const enLaTablet = avance(2400, '2026-08-21T10:00:00.000Z', 'tablet');

  const aplicar = fusionar([enLaTele], [enLaTablet]);
  assert.equal(aplicar.length, 1);
  assert.equal(aplicar[0]?.campos.seconds, 2400);
});

test('lo local más nuevo no lo pisa lo que llega viejo', () => {
  // El caso de la tele que lleva una semana apagada: al encenderse manda su
  // versión de hace días, y no puede tirar por tierra lo de la tablet.
  const enLaTablet = avance(2400, '2026-08-21T10:00:00.000Z', 'tablet');
  const enLaTele = avance(600, '2026-08-14T21:00:00.000Z', 'tele');

  assert.deepEqual(fusionar([enLaTablet], [enLaTele]), []);
});

test('un borrado reciente gana, y lo quitado no reaparece', () => {
  // Es el fallo que se evita guardando lápidas: quitas algo de favoritos en
  // un aparato y al día siguiente el otro lo ha vuelto a subir.
  const marcado: Cambio = {
    tabla: 'favorite',
    clave: ['ana', 'pelicula', 'lola-pater-2017'],
    campos: { title: 'Lola Pater', created: '2026-08-01T12:00:00.000Z' },
    actualizado: '2026-08-01T12:00:00.000Z',
    borrado: false,
    origen: 'tele',
  };
  const quitado: Cambio = { ...marcado, actualizado: '2026-08-21T18:00:00.000Z', borrado: true, origen: 'tablet' };

  const aplicar = fusionar([marcado], [quitado]);
  assert.equal(aplicar.length, 1);
  assert.equal(aplicar[0]?.borrado, true);

  // Y al revés: el aparato que ya lo tiene borrado no lo recupera porque el
  // otro le mande la versión antigua en que estaba marcado.
  assert.deepEqual(fusionar([quitado], [marcado]), []);
});

test('volver a marcar después de borrar resucita la fila', () => {
  const quitado: Cambio = {
    tabla: 'favorite',
    clave: ['ana', 'pelicula', 'lola-pater-2017'],
    campos: { title: 'Lola Pater', created: '2026-08-01T12:00:00.000Z' },
    actualizado: '2026-08-21T18:00:00.000Z',
    borrado: true,
    origen: 'tablet',
  };
  const otraVez: Cambio = { ...quitado, actualizado: '2026-08-22T09:00:00.000Z', borrado: false, origen: 'tele' };

  assert.equal(fusionar([quitado], [otraVez])[0]?.borrado, false);
});

test('lo que no se tenía entra siempre, lápidas incluidas', () => {
  const nuevo = avance(120, '2026-08-21T10:00:00.000Z');
  const lapida: Cambio = { ...avance(0, '2026-08-21T11:00:00.000Z'), clave: ['ana', 'pelicula', 'otra'], borrado: true };

  assert.equal(fusionar([], [nuevo, lapida]).length, 2);
});

test('en el mismo milisegundo desempata el aparato, y los dos llegan a lo mismo', () => {
  // Sin desempate cada uno se quedaría con lo suyo y la diferencia no se
  // resolvería jamás: los dos creerían estar al día.
  const tele = avance(600, '2026-08-21T10:00:00.000Z', 'tele');
  const tablet = avance(2400, '2026-08-21T10:00:00.000Z', 'tablet');

  const enLaTele = fusionar([tele], [tablet])[0] ?? tele;
  const enLaTablet = fusionar([tablet], [tele])[0] ?? tablet;
  assert.deepEqual(enLaTele, enLaTablet);
});

test('dos versiones de la misma fila en la misma tanda: se queda la buena', () => {
  const pronto = avance(600, '2026-08-21T10:00:00.000Z');
  const luego = avance(2400, '2026-08-21T11:00:00.000Z');

  // Llegando del revés, la vieja no puede colarse por detrás de la nueva.
  const aplicar = fusionar([], [luego, pronto]);
  assert.equal(aplicar.length, 1);
  assert.equal(aplicar[0]?.campos.seconds, 2400);
});

test('filas distintas de la misma tabla no se estorban', () => {
  const una = avance(600, '2026-08-21T10:00:00.000Z');
  const otra: Cambio = { ...avance(300, '2026-08-19T10:00:00.000Z'), clave: ['ana', 'pelicula', 'el-aviso-2018'] };

  assert.equal(fusionar([una], [otra]).length, 1);
});

test('el mismo item en perfiles distintos es otra fila', () => {
  const deAna = avance(600, '2026-08-21T10:00:00.000Z');
  const deLuis: Cambio = { ...avance(60, '2026-08-01T10:00:00.000Z'), clave: ['luis', 'pelicula', 'lola-pater-2017'] };

  assert.equal(fusionar([deAna], [deLuis]).length, 1);
});

test('la marca de agua se queda en lo más nuevo que se ha visto', () => {
  const cambios = [avance(600, '2026-08-21T10:00:00.000Z'), avance(900, '2026-08-21T12:00:00.000Z')];
  assert.equal(marcaTras('2026-08-01T00:00:00.000Z', cambios), '2026-08-21T12:00:00.000Z');
  // Sin novedades, se conserva la que había.
  assert.equal(marcaTras('2026-08-21T12:00:00.000Z', []), '2026-08-21T12:00:00.000Z');
});

test('sin nada con que comparar, el entrante gana', () => {
  assert.equal(gana(avance(600, '2026-08-21T10:00:00.000Z'), undefined), true);
});
