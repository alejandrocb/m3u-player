/**
 * La misma película dos veces porque a una le falta el año.
 *
 * Lo que hay que dejar clavado son las dos mitades de la regla: que se junten
 * cuando no hay duda, y que **no** se junten cuando la hay. Meter una ficha en
 * la película equivocada es peor que dejar el duplicado: el duplicado se ve y
 * se entiende, y lo otro es una carátula que lleva a otra cosa.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { duplicadasSinAnio } from '../src/duplicados.ts';

test('la que no lleva año se junta con la única que sí lo lleva', () => {
  const parejas = duplicadasSinAnio([
    { id: 'he-man-y-los-masters-del-universo', title: 'He-Man y los Masters del Universo', year: null },
    { id: 'he-man-y-los-masters-del-universo-2021', title: 'He-Man y los Masters del Universo', year: 2021 },
  ]);

  assert.equal(parejas.length, 1);
  assert.equal(parejas[0]?.suelta.id, 'he-man-y-los-masters-del-universo');
  assert.equal(parejas[0]?.destino.id, 'he-man-y-los-masters-del-universo-2021');
});

test('con dos candidatas no se junta con ninguna', () => {
  // No hay forma de saber si el "Robin Hood" suelto es el de 2018 o el de
  // 2010, y colocarlo en el que no es sería peor que dejarlo aparte.
  const parejas = duplicadasSinAnio([
    { id: 'robin-hood', title: 'Robin Hood', year: null },
    { id: 'robin-hood-2018', title: 'Robin Hood', year: 2018 },
    { id: 'robin-hood-2010', title: 'Robin Hood', year: 2010 },
  ]);

  assert.deepEqual(parejas, []);
});

test('sin ninguna con año no hay nada que juntar', () => {
  const parejas = duplicadasSinAnio([
    { id: 'una', title: 'Una película', year: null },
    { id: 'otra', title: 'Otra película', year: null },
  ]);

  assert.deepEqual(parejas, []);
});

test('el título se compara sin acentos ni mayúsculas', () => {
  const parejas = duplicadasSinAnio([
    { id: 'el-heroe', title: 'EL HÉROE', year: null },
    { id: 'el-heroe-2019', title: 'El héroe', year: 2019 },
  ]);

  assert.equal(parejas.length, 1);
  assert.equal(parejas[0]?.destino.year, 2019);
});
