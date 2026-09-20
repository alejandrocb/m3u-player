/**
 * Los temas de una ficha, partidos y juntados.
 *
 * Lo que hay que dejar clavado es que las escrituras distintas de lo mismo
 * caen en la misma fila: si "Ciencia ficción" y "CIENCIA FICCION" fueran dos
 * temas, el inicio saldría con dos filas medio vacías del mismo género.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { contarTemas, temasDe } from '../src/temas.ts';

test('un campo con varios géneros se parte', () => {
  assert.deepEqual(temasDe('Drama, Romance'), ['Drama', 'Romance']);
  assert.deepEqual(temasDe('Acción / Aventura'), ['Acción', 'Aventura']);
  assert.deepEqual(temasDe('Comedia'), ['Comedia']);
});

test('lo que no es un género no cuenta', () => {
  assert.deepEqual(temasDe(''), []);
  assert.deepEqual(temasDe(null), []);
  assert.deepEqual(temasDe('N/A'), []);
  assert.deepEqual(temasDe('Drama, Otros'), ['Drama']);
});

test('el mismo género repetido dentro de la ficha cuenta una vez', () => {
  assert.deepEqual(temasDe('Drama, drama'), ['Drama']);
});

test('las escrituras distintas de lo mismo se juntan, y manda la más usada', () => {
  const temas = contarTemas([
    { genero: 'Ciencia ficción', fichas: 30 },
    { genero: 'CIENCIA FICCION', fichas: 4 },
    { genero: 'Ciencia Ficción, Drama', fichas: 6 },
    { genero: 'Drama', fichas: 50 },
  ]);

  assert.deepEqual(temas, [
    { nombre: 'Drama', fichas: 56 },
    { nombre: 'Ciencia ficción', fichas: 40 },
  ]);
});
