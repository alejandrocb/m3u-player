import assert from 'node:assert/strict';
import test from 'node:test';

import { cantidad, duracion, nota, numero, reloj } from '../src/texto.ts';

test('los miles se separan con punto', () => {
  assert.equal(numero(0), '0');
  assert.equal(numero(486), '486');
  assert.equal(numero(1000), '1.000');
  assert.equal(numero(17968), '17.968');
  assert.equal(numero(218662), '218.662');
});

test('la unidad concuerda en número', () => {
  // El caso que se ve nada más abrir una serie de una temporada corta.
  assert.equal(cantidad(1, 'episodio', 'episodios'), '1 episodio');
  assert.equal(cantidad(2, 'episodio', 'episodios'), '2 episodios');
  assert.equal(cantidad(0, 'canal', 'canales'), '0 canales');
});

test('las cantidades grandes salen formateadas y en plural', () => {
  assert.equal(cantidad(17968, 'título', 'títulos'), '17.968 títulos');
});

test('la duración usa la unidad que toca', () => {
  // Un clip corto en "0 min" no dice nada; una película en "127 min", tampoco.
  assert.equal(duracion(10), '10 s');
  assert.equal(duracion(59), '59 s');
  assert.equal(duracion(60), '1 min');
  assert.equal(duracion(5548), '1 h 32 min');
  assert.equal(duracion(7200), '2 h');
});

test('una duración desconocida no se pinta', () => {
  assert.equal(duracion(0), '');
  assert.equal(duracion(Number.NaN), '');
});

test('el reloj del reproductor da el segundo exacto', () => {
  assert.equal(reloj(0), '0:00');
  assert.equal(reloj(297), '4:57');
  assert.equal(reloj(2977), '49:37');
  // La hora solo aparece cuando la hay.
  assert.equal(reloj(6577), '1:49:37');
});

test('un tiempo desconocido no rompe el reloj', () => {
  assert.equal(reloj(Number.NaN), '0:00');
  assert.equal(reloj(-5), '0:00');
});

test('la nota se pinta a la española y sin decimal de más', () => {
  assert.equal(nota(7.2), '7,2');
  assert.equal(nota(7.25), '7,3');
  // Las redondas van sin ",0": en una pastilla de la carátula sobra.
  assert.equal(nota(9), '9');
  assert.equal(nota(10), '10');
  assert.equal(nota(8.04), '8');
});
