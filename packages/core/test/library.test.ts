import assert from 'node:assert/strict';
import test from 'node:test';

import { buildLibrary } from '../src/m3u/library.ts';
import { parseM3U } from '../src/m3u/parser.ts';
import { SAMPLE } from './fixtures.ts';

const library = buildLibrary(parseM3U(SAMPLE).entries);

test('el parser lee todas las entradas de la muestra', () => {
  const doc = parseM3U(SAMPLE);
  assert.equal(doc.entries.length, 12);
  assert.equal(doc.malformed, 0);
  assert.equal(doc.entries[0]!.attrs['group-title'], '== NOVEDADES');
});

test('las variantes de calidad se fusionan en un solo canal', () => {
  const horas = library.channels.find((c) => c.name === '24 Horas');
  assert.ok(horas, 'debería existir el canal 24 Horas');
  assert.equal(horas.variants.length, 2);
  // Ordenadas de mejor a peor: FHD antes que SD.
  assert.equal(horas.variants[0]!.quality, 'FHD');
  assert.equal(horas.variants[1]!.quality, 'SD');
});

test('los grupos pierden la decoración y agrupan sus canales', () => {
  const noticias = library.groups.find((g) => g.name === 'NOTICIAS');
  assert.ok(noticias, 'debería existir el grupo NOTICIAS');
  // 24 Horas (fusionado), Al Jazeera English y Al Jazeera Arabic.
  assert.equal(noticias.channelIds.length, 3);
});

test('un canal sin tvg-id sigue teniendo identidad propia', () => {
  const arabic = library.channels.find((c) => c.name === 'Al Jazeera Arabic');
  assert.ok(arabic);
  assert.equal(arabic.tvgId, null);
  assert.ok(arabic.id.startsWith('name:'));
});

test('los episodios se agrupan en serie y temporada', () => {
  const paQuererte = library.series.find((s) => s.title === 'Pa Quererte');
  assert.ok(paQuererte, 'debería existir la serie Pa Quererte');
  assert.equal(paQuererte.year, 2020);
  assert.equal(paQuererte.seasons.length, 2);
  assert.deepEqual(
    paQuererte.seasons.map((s) => s.number),
    [1, 2],
  );
  assert.equal(paQuererte.seasons[0]!.episodes.length, 2);
});

test('la misma serie repartida en varios grupos se fusiona en una ficha', () => {
  const paQuererte = library.series.find((s) => s.title === 'Pa Quererte')!;
  assert.deepEqual(paQuererte.groups.sort(), ['TV Series NETFLIX', 'TV Series OTROS']);
});

test('las películas quedan con el título limpio', () => {
  assert.equal(library.movies.length, 1);
  const lola = library.movies[0]!;
  assert.equal(lola.title, 'Lola Pater');
  assert.equal(lola.year, 2017);
  assert.deepEqual(lola.groups, ['Peliculas 2017']);
});

test('la misma película en dos calidades es una ficha con dos variantes', () => {
  const lola = library.movies[0]!;
  assert.equal(lola.variants.length, 2);
  // De mejor a peor: 1080p antes que 720p.
  assert.deepEqual(
    lola.variants.map((v) => v.quality),
    ['1080p', '720p'],
  );
});

test('el mismo episodio en dos calidades no se duplica', () => {
  const paQuererte = library.series.find((s) => s.title === 'Pa Quererte')!;
  const primera = paQuererte.seasons[0]!;
  const episodio47 = primera.episodes.find((e) => e.episode === 47)!;
  assert.equal(episodio47.variants.length, 2);
  assert.deepEqual(
    episodio47.variants.map((v) => v.quality),
    ['1080p', '720p'],
  );
});

test('los anuncios del servidor se apartan sin borrarse', () => {
  assert.equal(library.junk.length, 1);
  assert.equal(library.junk[0]!.name, 'ANUNCIOS DEL SERVER');
});

test('las estadísticas cuadran con la muestra', () => {
  assert.deepEqual(library.stats, {
    entries: 12,
    channels: 3,
    channelEntries: 4,
    groups: 1,
    movies: 1,
    movieEntries: 2,
    series: 2,
    episodes: 4,
    episodeEntries: 5,
    junk: 1,
    unknown: 0,
  });
});
