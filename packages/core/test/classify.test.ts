import assert from 'node:assert/strict';
import test from 'node:test';

import { classify, parseEpisodeTag, seriesTitleFromEpisode } from '../src/classify.ts';
import type { RawEntry } from '../src/models.ts';

function entry(name: string, group: string, url = 'http://host/x'): RawEntry {
  return { name, url, attrs: { 'group-title': group }, line: 1 };
}

test('parseEpisodeTag acepta las variantes que usan los proveedores', () => {
  assert.deepEqual(pick(parseEpisodeTag('Pa Quererte (2020) 1080p S1 E47')), { season: 1, episode: 47 });
  assert.deepEqual(pick(parseEpisodeTag('Serie S01E47')), { season: 1, episode: 47 });
  assert.deepEqual(pick(parseEpisodeTag('Serie 1x47')), { season: 1, episode: 47 });
  assert.deepEqual(pick(parseEpisodeTag('Serie T1 C47')), { season: 1, episode: 47 });
  assert.deepEqual(pick(parseEpisodeTag('Serie Temporada 2 Capitulo 5')), { season: 2, episode: 5 });
  assert.equal(parseEpisodeTag('Lola Pater (2017)_720p x264'), null);
});

test('parseEpisodeTag se queda con la marca más a la derecha', () => {
  // "1x" del título no debe ganarle a la marca real del final.
  const tag = parseEpisodeTag('Fórmula 1 2024 S3 E12');
  assert.deepEqual(pick(tag), { season: 3, episode: 12 });
});

test('seriesTitleFromEpisode deja el título limpio', () => {
  const name = 'Pa Quererte (2020) 1080p S1 E47';
  assert.equal(seriesTitleFromEpisode(name, parseEpisodeTag(name)!), 'Pa Quererte');

  const otro = 'Avatar: La leyenda de Aang 1080p S1 E1';
  assert.equal(seriesTitleFromEpisode(otro, parseEpisodeTag(otro)!), 'Avatar: La leyenda de Aang');
});

test('classify separa directo, película y serie', () => {
  assert.equal(classify(entry('24 Horas FHD', '== NOTICIAS')).kind, 'live');
  assert.equal(classify(entry('Pa Quererte (2020) 1080p S1 E47', 'TV Series OTROS')).kind, 'series');
  assert.equal(classify(entry('Lola Pater (2017)_720p x264', 'Peliculas 2017')).kind, 'movie');
});

test('classify descarta los avisos del proveedor', () => {
  assert.equal(classify(entry('ANUNCIOS DEL SERVER', '== NOVEDADES')).kind, 'junk');
  assert.equal(classify(entry('=====', '== NOVEDADES')).kind, 'junk');
  assert.equal(classify(entry('TU CUENTA CADUCA EN 3 DIAS', '== NOVEDADES')).kind, 'junk');
});

test('la ruta de la URL manda sobre el grupo', () => {
  // Grupo de directo pero URL de VOD: gana la URL, que es la señal fiable.
  const e = entry('Algo raro', '== NOTICIAS', 'http://host/movie/u/p/1.mkv');
  assert.equal(classify(e).kind, 'movie');
});

test('una marca de episodio rescata series metidas en grupos genéricos', () => {
  const e = entry('Cualquier Cosa S2 E3', 'VARIOS', 'http://host/x.mkv');
  assert.equal(classify(e).kind, 'series');
});

test('un fichero de vídeo nunca se clasifica como directo', () => {
  const e = entry('Peli sin grupo', 'VARIOS', 'http://host/algo.mkv');
  assert.equal(classify(e).kind, 'movie');
});

function pick(tag: { season: number; episode: number } | null) {
  return tag ? { season: tag.season, episode: tag.episode } : null;
}

test('un título de película no se oculta por parecerse a un aviso', () => {
  // Casos reales de la lista: se estaban ocultando 12 películas.
  assert.equal(classify(entry('El aviso (2018) 1080p x264', 'Peliculas 2018')).kind, 'movie');
  assert.equal(classify(entry('Tres anuncios en las afueras (2017)_720p x264', 'Peliculas 2017')).kind, 'movie');
  assert.equal(classify(entry('Contacto sangriento (1988) 1080p', 'Peliculas 1988')).kind, 'movie');
  assert.equal(classify(entry('Star Trek VIII: Primer contacto (1996)_720p x264', 'Peliculas 1996')).kind, 'movie');
});

test('hace falta doble señal para dar una entrada por aviso', () => {
  assert.equal(classify(entry('ANUNCIOS DEL SERVER', 'NOVEDADES')).kind, 'junk');
  assert.equal(classify(entry('TU CUENTA CADUCA EN 3 DIAS', 'NOVEDADES')).kind, 'junk');
  // "aviso" a secas, en un grupo de directo, no basta.
  assert.equal(classify(entry('Aviso Canal 4', 'NOTICIAS')).kind, 'live');
});

test('un número de episodio de cinco cifras sigue siendo un episodio', () => {
  // El proveedor cuela el id del stream como número de episodio.
  const tag = parseEpisodeTag('Doctor Who(720p_x264) S2 E43171');
  assert.deepEqual(pick(tag), { season: 2, episode: 43171 });
  assert.equal(classify(entry('Doctor Who(720p_x264) S2 E43171', 'TV Series OTROS')).kind, 'series');
});

test('la resolución del nombre no se confunde con una marca de episodio', () => {
  assert.equal(parseEpisodeTag('Peli 1920x1080'), null);
  assert.equal(parseEpisodeTag('Lola Pater (2017)_720p x264'), null);
});

test('el año como número de temporada también vale', () => {
  const tag = parseEpisodeTag('Formula 1- 2026 S2026 E24');
  assert.deepEqual(pick(tag), { season: 2026, episode: 24 });
});
