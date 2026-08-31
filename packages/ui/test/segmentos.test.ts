/**
 * Las reglas de la intro marcada a mano.
 *
 * Lo que hay que dejar clavado es que **lo concreto manda**: una serie que
 * arranca con una escena lleva la careta en otro sitio en cada capítulo, y la
 * marca de ese capítulo tiene que ganarle a la de la temporada.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ambitoDeTemporada,
  dentroDelSegmento,
  segmentoQueManda,
  segmentoValido,
} from '../src/segmentos.ts';
import type { Segmento } from '../src/segmentos.ts';

const deTemporada: Segmento = { ambito: 'doctor-who:s1', tipo: 'intro', desde: 97, hasta: 184 };
const delCapitulo: Segmento = { ambito: 'doctor-who:s1e4', tipo: 'intro', desde: 412, hasta: 499 };

test('la temporada vale para todos sus capítulos', () => {
  assert.equal(ambitoDeTemporada('doctor-who:s1e4'), 'doctor-who:s1');
  assert.equal(segmentoQueManda([deTemporada], 'doctor-who:s1e7', 'intro'), deTemporada);
});

test('pero la marca del capítulo le gana', () => {
  // Es el caso de la serie que empieza con una escena: la careta está en un
  // sitio distinto cada vez, y por eso se marcó ese capítulo aparte.
  assert.equal(segmentoQueManda([deTemporada, delCapitulo], 'doctor-who:s1e4', 'intro'), delCapitulo);
  // Y en los demás sigue mandando la de la temporada.
  assert.equal(segmentoQueManda([deTemporada, delCapitulo], 'doctor-who:s1e5', 'intro'), deTemporada);
});

test('los créditos no se confunden con la intro', () => {
  const creditos: Segmento = { ambito: 'doctor-who:s1', tipo: 'outro', desde: 2600, hasta: 2900 };
  assert.equal(segmentoQueManda([deTemporada, creditos], 'doctor-who:s1e1', 'outro'), creditos);
});

test('sin marca no hay nada que ofrecer', () => {
  assert.equal(segmentoQueManda([], 'doctor-who:s1e1', 'intro'), null);
  // Una película no tiene temporada a la que subir la marca.
  assert.equal(ambitoDeTemporada('lola-pater-2017'), null);
});

test('el botón sale dentro de la careta y no después', () => {
  assert.equal(dentroDelSegmento(deTemporada, 120), true);
  assert.equal(dentroDelSegmento(deTemporada, 10), false);
  // Pasado el final ya no hay nada que saltar.
  assert.equal(dentroDelSegmento(deTemporada, 184), false);
  // Con un poco de margen por delante: el reloj del vídeo no va al segundo.
  assert.equal(dentroDelSegmento(deTemporada, 96.7), true);
});

test('una marca al revés o absurda no se guarda', () => {
  // Estropearía la serie para toda la casa, que es lo que la comparte.
  assert.equal(segmentoValido({ ambito: 'x:s1', tipo: 'intro', desde: 200, hasta: 100 }), false);
  assert.equal(segmentoValido({ ambito: 'x:s1', tipo: 'intro', desde: 100, hasta: 102 }), false);
  assert.equal(segmentoValido({ ambito: 'x:s1', tipo: 'intro', desde: 60, hasta: 900 }), false);
  assert.equal(segmentoValido(deTemporada), true);
});
