import assert from 'node:assert/strict';
import test from 'node:test';

import { cleanGroup, parseChannelName, parseName, qualityRank, slug } from '../src/normalize.ts';

test('cleanGroup quita la decoración con la que el proveedor fuerza el orden', () => {
  assert.equal(cleanGroup('== NOTICIAS'), 'NOTICIAS');
  assert.equal(cleanGroup('▶ DEPORTES |'), 'DEPORTES');
  assert.equal(cleanGroup('  ●● CINE ●●  '), 'CINE');
  assert.equal(cleanGroup('TV Series NETFLIX'), 'TV Series NETFLIX');
  // Un grupo hecho solo de símbolos no se puede limpiar: se deja como estaba.
  assert.equal(cleanGroup('====='), '=====');
});

test('parseChannelName separa el sufijo de calidad sin tocar el nombre', () => {
  assert.deepEqual(parseChannelName('24 Horas FHD'), { name: '24 Horas', quality: 'FHD' });
  assert.deepEqual(parseChannelName('24 Horas SD'), { name: '24 Horas', quality: 'SD' });
  assert.deepEqual(parseChannelName('Al Jazeera Arabic'), { name: 'Al Jazeera Arabic', quality: null });
  // "HD" en medio del nombre no es un sufijo de calidad.
  assert.deepEqual(parseChannelName('Canal HD Directo'), { name: 'Canal HD Directo', quality: null });
});

test('parseName descompone el nombre de una película', () => {
  assert.deepEqual(parseName('Lola Pater (2017)_720p x264'), {
    title: 'Lola Pater',
    year: 2017,
    quality: '720p',
    tags: ['x264'],
  });
});

test('parseName conserva los dos puntos del título', () => {
  const parsed = parseName('Avatar: La leyenda de Aang 1080p');
  assert.equal(parsed.title, 'Avatar: La leyenda de Aang');
  assert.equal(parsed.quality, '1080p');
});

test('parseName no confunde un número del título con el año', () => {
  assert.equal(parseName('Blade Runner 2049').year, null);
  assert.equal(parseName('Blade Runner 2049 (2017)').year, 2017);
});

test('las abreviaturas con puntos son la misma película que sin ellos', () => {
  /*
    "V.O.S.E." es lo mismo que "VOSE", pero los puntos rompen el patrón de
    etiquetas y el título se quedaba con ellos dentro. Como la identidad de una
    película es su título más el año, en la biblioteca salían dos: *La captura*
    y *La captura V.O.S.E.*.
  */
  assert.equal(parseName('La captura V.O.S.E.').title, 'La captura');
  assert.deepEqual(parseName('La captura V.O.S.E.').tags, ['vose']);
  assert.equal(parseName('La captura VOSE').title, 'La captura');

  // Y las siglas se unifican, que el proveedor las escribe de las dos formas.
  assert.equal(parseName('S.W.A.T.').title, 'SWAT');

  // Sin tocar los títulos que llevan puntuación de verdad.
  assert.equal(parseName('K-PAX: Un universo aparte').title, 'K-PAX: Un universo aparte');
  assert.equal(parseName('Wall-E').title, 'Wall-E');
});

test('qualityRank ordena de mejor a peor', () => {
  assert.ok(qualityRank('4K') > qualityRank('FHD'));
  assert.ok(qualityRank('FHD') > qualityRank('HD'));
  assert.ok(qualityRank('HD') > qualityRank('SD'));
  assert.ok(qualityRank('1080p') > qualityRank('720p'));
  assert.equal(qualityRank(null), 0);
});

test('slug es estable frente a acentos y puntuación', () => {
  assert.equal(slug('Avatar: La leyenda de Aang'), 'avatar-la-leyenda-de-aang');
  assert.equal(slug('Películas'), 'peliculas');
});

test('tidy limpia los paréntesis que quedan vacíos al quitar etiquetas', () => {
  // "Friends (Latino - Castellano)": al irse las etiquetas de idioma queda "( - )".
  assert.equal(parseName('Friends (Latino - Castellano)').title, 'Friends');
  assert.equal(parseName('Alguna Peli [DUAL]').title, 'Alguna Peli');
  // Un paréntesis con contenido real no se toca.
  assert.equal(parseName('Rocky (2)').title, 'Rocky (2)');
});
