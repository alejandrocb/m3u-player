/**
 * El audio y los subtítulos que cada perfil quiere en cada serie.
 *
 * Lo que hay que dejar clavado: **se recuerda el idioma, no el número de
 * pista**. El número cambia de un capítulo a otro según cómo lo empaquetara
 * quien lo codificó, y guardar "la pista 2" acaba poniendo el comentario del
 * director.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SIN_SUBTITULOS,
  clavePistas,
  comoRecordar,
  escribirPistas,
  leerPistas,
  pistaQueToca,
} from '../src/pistas.ts';

/** Un capítulo cualquiera, con las pistas en otro orden que el anterior. */
const PISTAS = [
  { indice: 0, nombre: 'Castellano · es', idioma: 'es' },
  { indice: 1, nombre: 'Comentario del director · en', idioma: 'en' },
];

test('se casa por idioma, aunque la pista haya cambiado de número', () => {
  const puesta = pistaQueToca(PISTAS, 'en');
  assert.equal(puesta?.indice, 1);
});

test('sin nada recordado no se toca nada: manda lo que traiga el fichero', () => {
  assert.equal(pistaQueToca(PISTAS, null), null);
  assert.equal(pistaQueToca(PISTAS, ''), null);
});

test('si el capítulo no trae ese idioma, se queda el de por defecto', () => {
  // Mejor oírlo en español que no oírlo.
  assert.equal(pistaQueToca(PISTAS, 'fr'), null);
});

test('cuando el fichero no dice el idioma, vale el nombre entero', () => {
  const sinIdioma = [
    { indice: 0, nombre: 'Pista 1' },
    { indice: 1, nombre: 'Inglés (VO)' },
  ];
  assert.equal(pistaQueToca(sinIdioma, 'Inglés (VO)')?.indice, 1);
  assert.equal(comoRecordar(sinIdioma[1]!), 'Inglés (VO)');
});

test('y el idioma manda sobre el nombre al guardarlo', () => {
  assert.equal(comoRecordar(PISTAS[1]!), 'en');
});

test('lo guardado se lee, y lo ilegible no tumba la reproducción', () => {
  const guardado = escribirPistas({ audio: 'en', subtitulo: SIN_SUBTITULOS });
  assert.deepEqual(leerPistas(guardado), { audio: 'en', subtitulo: SIN_SUBTITULOS });

  assert.deepEqual(leerPistas('esto no es json'), { audio: null, subtitulo: null });
  assert.deepEqual(leerPistas(null), { audio: null, subtitulo: null });
});

test('apagar los subtítulos también se recuerda', () => {
  // Si se guardara como "nada elegido", volverían a salir en el siguiente.
  const leido = leerPistas(escribirPistas({ audio: null, subtitulo: SIN_SUBTITULOS }));
  assert.equal(leido.subtitulo, SIN_SUBTITULOS);
  // Y `SIN_SUBTITULOS` no casa con ninguna pista de verdad.
  assert.equal(pistaQueToca(PISTAS, SIN_SUBTITULOS), null);
});

test('cada serie guarda lo suyo', () => {
  assert.notEqual(clavePistas('friends'), clavePistas('the-pitt'));
});
