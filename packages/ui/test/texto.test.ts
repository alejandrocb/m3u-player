import assert from 'node:assert/strict';
import test from 'node:test';

import { cantidad, duracion, mediasEstrellas, nota, numero, reloj } from '../src/texto.ts';
import { nombreDeCategoria, ordenarCategorias } from '../src/presentador.ts';

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

test('la nota se convierte a medias estrellas sobre cinco', () => {
  assert.equal(mediasEstrellas(10), 10, 'cinco estrellas');
  assert.equal(mediasEstrellas(8), 8, 'cuatro');
  assert.equal(mediasEstrellas(6), 6, 'tres');
  assert.equal(mediasEstrellas(2), 2, 'una');
});

test('se redondea al medio punto más cercano', () => {
  assert.equal(mediasEstrellas(7), 7, 'tres y media');
  assert.equal(mediasEstrellas(8.7), 9, 'un 8,7 es cuatro y media');
  assert.equal(mediasEstrellas(9.9), 10);
  assert.equal(mediasEstrellas(5.4), 5, 'dos y media');
});

test('sin nota no hay estrellas', () => {
  // Cinco estrellas huecas parecen "valorada con cero", que no es lo mismo
  // que "sin valorar".
  assert.equal(mediasEstrellas(0), 0);
  assert.equal(mediasEstrellas(Number.NaN), 0);
  assert.equal(mediasEstrellas(-3), 0);
});

test('una nota fuera de escala no desborda las cinco', () => {
  assert.equal(mediasEstrellas(12), 10);
});

/*
  Las categorías del proveedor vienen a gritos y con la sección delante. Como
  rótulo de una fila del inicio, eso no se lee: se limpia.
*/

test('el nombre de una categoría se deja legible', () => {
  assert.equal(nombreDeCategoria('PELICULAS ACCION'), 'Accion');
  assert.equal(nombreDeCategoria('SERIES | DRAMA'), 'Drama');
  assert.equal(nombreDeCategoria('CINE - TERROR'), 'Terror');
  assert.equal(nombreDeCategoria('Comedia'), 'Comedia');
});

test('si al quitar la sección no queda nada, se deja el nombre entero', () => {
  // "PELICULAS" a secas es una categoría de verdad en algunas listas.
  assert.equal(nombreDeCategoria('PELICULAS'), 'Peliculas');
});

test('las categorías se ordenan por lo que ve el perfil, y luego por tamaño', () => {
  const categorias = [
    { nombre: 'Acción', canales: 900 },
    { nombre: 'Terror', canales: 300 },
    { nombre: 'Comedia', canales: 600 },
  ];

  // Sin haber visto nada, mandan las más gordas.
  assert.deepEqual(
    ordenarCategorias(categorias, {}).map((una) => una.nombre),
    ['Acción', 'Comedia', 'Terror'],
  );

  // Y en cuanto uno ve terror, el terror sube.
  assert.deepEqual(
    ordenarCategorias(categorias, { Terror: 3, Comedia: 1 }).map((una) => una.nombre),
    ['Terror', 'Comedia', 'Acción'],
  );
});
