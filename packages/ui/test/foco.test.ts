import assert from 'node:assert/strict';
import test from 'node:test';

import { mover, paginaDe } from '../src/foco.ts';

// Rejilla de 4 columnas y 10 elementos: dos filas llenas y una de dos.
//   0  1  2  3
//   4  5  6  7
//   8  9
const REJILLA = { total: 10, columnas: 4 };

test('el foco se mueve dentro de la fila', () => {
  assert.equal(mover(1, 'derecha', REJILLA), 2);
  assert.equal(mover(1, 'izquierda', REJILLA), 0);
});

test('en los bordes laterales no se envuelve', () => {
  // Insistir a la izquierda en la primera columna no salta a la fila anterior.
  assert.equal(mover(4, 'izquierda', REJILLA), 4);
  assert.equal(mover(3, 'derecha', REJILLA), 3);
});

test('no se sale por arriba en la primera fila', () => {
  assert.equal(mover(2, 'arriba', REJILLA), 2);
  assert.equal(mover(6, 'arriba', REJILLA), 2);
});

test('bajar a una fila incompleta lleva al último elemento', () => {
  // Debajo del 6 no hay nada (la última fila solo tiene 8 y 9), así que el
  // foco va al 9 en vez de quedarse quieto y dejarlo inalcanzable.
  assert.equal(mover(6, 'abajo', REJILLA), 9);
  assert.equal(mover(4, 'abajo', REJILLA), 8);
});

test('en la última fila, bajar no hace nada', () => {
  assert.equal(mover(9, 'abajo', REJILLA), 9);
});

test('una lista vertical es una rejilla de una columna', () => {
  const lista = { total: 3, columnas: 1 };
  assert.equal(mover(0, 'abajo', lista), 1);
  assert.equal(mover(2, 'abajo', lista), 2);
  assert.equal(mover(1, 'derecha', lista), 1);
});

test('una rejilla vacía no rompe', () => {
  assert.equal(mover(0, 'abajo', { total: 0, columnas: 4 }), 0);
});

test('un índice fuera de rango se recorta antes de mover', () => {
  assert.equal(mover(99, 'izquierda', REJILLA), 8);
});

test('la página se calcula por bloques', () => {
  assert.equal(paginaDe(0, 50), 0);
  assert.equal(paginaDe(49, 50), 0);
  assert.equal(paginaDe(50, 50), 50);
  assert.equal(paginaDe(137, 50), 100);
});
