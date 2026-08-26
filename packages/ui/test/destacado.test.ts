/**
 * Qué película preside el inicio.
 *
 * Es una decisión pequeña que se ve mucho: ocupa media pantalla nada más
 * abrir. Por eso el criterio es explícito y con tope —reciente, bien valorada
 * y con cartel— en vez de "la primera que haya".
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { destacar } from '../src/presentador.ts';

const AHORA = new Date('2026-08-26T12:00:00.000Z');

function pelicula(anio: number | null, valoracion: number | null, logo: string | null = 'http://host/a.jpg') {
  return { anio, valoracion, logo };
}

test('se queda con la mejor valorada de las recientes', async () => {
  const elegida = destacar(
    [pelicula(2026, 7.5), pelicula(2026, 9.1), pelicula(2025, 8.0)],
    AHORA,
  );
  assert.equal(elegida?.valoracion, 9.1);
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
