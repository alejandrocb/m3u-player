import assert from 'node:assert/strict';
import test from 'node:test';

import { buildLibrary, parseM3U } from '@m3u/core/m3u';

import { LibraryStore, toMatchQuery } from '../src/index.ts';
import { SAMPLE } from '../../core/test/fixtures.ts';

function store(): LibraryStore {
  const instance = LibraryStore.open(':memory:');
  instance.import(buildLibrary(parseM3U(SAMPLE).entries));
  return instance;
}

test('la importación deja los totales que trae la biblioteca', () => {
  const db = store();
  assert.deepEqual(db.counts(), { channels: 3, movies: 1, series: 2, episodes: 4 });
  db.close();
});

test('los grupos salen con su recuento de canales', () => {
  const db = store();
  assert.deepEqual(db.groups(), [{ name: 'NOTICIAS', channels: 3 }]);
  db.close();
});

test('los canales de un grupo salen ordenados', () => {
  const db = store();
  const names = db.channelsInGroup('NOTICIAS').map((channel) => channel.name);
  assert.deepEqual(names, ['24 Horas', 'Al Jazeera Arabic', 'Al Jazeera English']);
  db.close();
});

test('las variantes se recuperan de mejor a peor calidad', () => {
  const db = store();
  const canal = db.channelsInGroup('NOTICIAS').find((c) => c.name === '24 Horas')!;
  const variants = db.variants('channel', canal.id);
  assert.deepEqual(
    variants.map((v) => v.quality),
    ['FHD', 'SD'],
  );
  db.close();
});

test('las temporadas y episodios se navegan por serie', () => {
  const db = store();
  const serie = db.series().find((s) => s.title === 'Pa Quererte')!;
  assert.deepEqual(db.seasons(serie.id), [
    { season: 1, episodes: 2 },
    { season: 2, episodes: 1 },
  ]);
  const primera = db.episodes(serie.id, 1);
  assert.deepEqual(
    primera.map((e) => e.episode),
    [47, 48],
  );
  db.close();
});

test('un episodio guarda sus variantes de calidad', () => {
  const db = store();
  const serie = db.series().find((s) => s.title === 'Pa Quererte')!;
  const episodio47 = db.episodes(serie.id, 1).find((e) => e.episode === 47)!;
  assert.equal(db.variants('episode', String(episodio47.id)).length, 2);
  db.close();
});

test('la búsqueda global encuentra en las tres secciones', () => {
  const db = store();
  assert.equal(db.search('24 horas')[0]?.kind, 'channel');
  assert.equal(db.search('lola')[0]?.kind, 'movie');
  assert.equal(db.search('avatar')[0]?.kind, 'series');
  db.close();
});

test('la búsqueda ignora acentos y funciona al teclear', () => {
  const db = store();
  // "aang" a medias, y sin la tilde que sí lleva el título.
  assert.equal(db.search('avat').length, 1);
  db.close();
});

test('la consulta de búsqueda no se rompe con caracteres raros', () => {
  const db = store();
  // Sin escapar, esto haría que FTS5 lanzara un error de sintaxis.
  assert.doesNotThrow(() => db.search('star wars: "el* imperio" -'));
  assert.equal(toMatchQuery('   '), null);
  db.close();
});

test('reimportar reemplaza en vez de duplicar', () => {
  const db = LibraryStore.open(':memory:');
  const library = buildLibrary(parseM3U(SAMPLE).entries);
  db.import(library);
  db.import(library);
  assert.deepEqual(db.counts(), { channels: 3, movies: 1, series: 2, episodes: 4 });
  db.close();
});
