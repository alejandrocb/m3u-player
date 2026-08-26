/**
 * Qué preside el inicio.
 *
 * Es una decisión pequeña que se ve mucho: ocupa media pantalla nada más
 * abrir. Por eso el criterio es explícito —reciente, con nota creíble, con
 * cartel y sin ser una copia de pase de prensa— en vez de "la primera que
 * haya".
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { destacar, destacarVarias } from '../src/presentador.ts';

const AHORA = new Date('2026-08-26T12:00:00.000Z');

function pelicula(
  anio: number | null,
  valoracion: number | null,
  logo: string | null = 'http://host/a.jpg',
  titulo = 'Una película',
) {
  return { titulo, anio, valoracion, logo };
}

test('manda el año, y dentro del año el orden en que llegaron', async () => {
  // Quien llama pide la página por "reciente", así que el orden de entrada ya
  // es el de lo último añadido: dentro del mismo año se respeta.
  const elegidas = destacarVarias(
    [pelicula(2025, 9.5), pelicula(2026, 7.1, undefined, 'La que entró antes'), pelicula(2026, 8.9)],
    3,
    AHORA,
  );
  assert.deepEqual(
    elegidas.map((ficha) => ficha.anio),
    [2026, 2026, 2025],
  );
  assert.equal(elegidas[0]?.titulo, 'La que entró antes', 'dentro del año no manda la nota');
});

test('un diez no vale: el proveedor los reparte a mansalva', async () => {
  assert.equal(destacar([pelicula(2026, 10)], AHORA), null);
  assert.equal(destacar([pelicula(2026, 9.9)], AHORA)?.valoracion, 9.9);
});

test('las copias de pase de prensa no presiden nada', async () => {
  assert.equal(destacar([pelicula(2026, 8, undefined, 'Los renglones torcidos SCREENING')], AHORA), null);
  assert.equal(destacar([pelicula(2026, 8, undefined, 'Screening Room')], AHORA), null);
});

test('el año pasado también cuenta como reciente', async () => {
  // Con el criterio en el año en curso, en enero no habría casi nada que
  // destacar: un catálogo tarda en llenarse de estrenos.
  assert.equal(destacar([pelicula(2025, 8.5)], AHORA)?.anio, 2025);
  assert.equal(destacar([pelicula(2024, 9.9)], AHORA), null);
});

test('lo mal valorado no preside nada', async () => {
  assert.equal(destacar([pelicula(2026, 6.9)], AHORA), null);
  assert.equal(destacar([pelicula(2026, null)], AHORA), null);
});

test('sin cartel no hay nada que enseñar', async () => {
  assert.equal(destacar([pelicula(2026, 9.5, null)], AHORA), null);
});

test('sin año conocido tampoco: no se puede saber si es reciente', async () => {
  assert.equal(destacar([pelicula(null, 9.5)], AHORA), null);
});

test('si nada cumple, mejor no tener destacado', async () => {
  assert.equal(destacar([], AHORA), null);
  assert.equal(destacar([pelicula(2019, 9.9), pelicula(2026, 3)], AHORA), null);
});
