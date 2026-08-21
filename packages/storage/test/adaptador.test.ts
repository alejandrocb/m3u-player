import assert from 'node:assert/strict';
import test from 'node:test';

import { buildLibrary, parseM3U } from '@m3u/core/m3u';

import { LibraryStore, bibliotecaDesde } from '../src/index.ts';
import { SAMPLE } from '../../core/test/fixtures.ts';

function biblioteca() {
  const store = LibraryStore.open(':memory:');
  store.import(buildLibrary(parseM3U(SAMPLE).entries));
  return { biblioteca: bibliotecaDesde(store), store };
}

test('los totales llegan a la interfaz', async () => {
  const { biblioteca: b, store } = biblioteca();
  assert.deepEqual(await b.totales(), { canales: 3, peliculas: 1, series: 2, episodios: 4 });
  store.close();
});

test('los grupos y sus canales salen con los nombres de la interfaz', async () => {
  const { biblioteca: b, store } = biblioteca();
  assert.deepEqual(await b.grupos(), [{ nombre: 'NOTICIAS', canales: 3 }]);

  const canales = await b.canalesDeGrupo('NOTICIAS');
  assert.deepEqual(
    canales.map((canal) => canal.nombre),
    ['24 Horas', 'Al Jazeera Arabic', 'Al Jazeera English'],
  );
  store.close();
});

test('las series traen sus temporadas y episodios', async () => {
  const { biblioteca: b, store } = biblioteca();
  const series = await b.series({ limite: 10, desde: 0 });
  const paQuererte = series.find((serie) => serie.titulo === 'Pa Quererte');
  assert.ok(paQuererte, 'la serie repartida entre dos grupos sale una sola vez');

  const temporadas = await b.temporadas(paQuererte.id);
  assert.deepEqual(temporadas, [
    { numero: 1, episodios: 2 },
    { numero: 2, episodios: 1 },
  ]);

  const episodios = await b.episodios(paQuererte.id, 1);
  assert.deepEqual(
    episodios.map((episodio) => episodio.numero),
    [47, 48],
  );
  store.close();
});

test('las variantes vienen de mejor a peor calidad', async () => {
  const { biblioteca: b, store } = biblioteca();
  const canales = await b.canalesDeGrupo('NOTICIAS');
  const veinticuatro = canales.find((canal) => canal.nombre === '24 Horas')!;

  const variantes = await b.variantes('canal', veinticuatro.id);
  assert.deepEqual(
    variantes.map((variante) => variante.calidad),
    ['FHD', 'SD'],
  );
  store.close();
});

test('la paginación recorta como pide la interfaz', async () => {
  const { biblioteca: b, store } = biblioteca();
  const primera = await b.peliculas({ limite: 1, desde: 0 });
  assert.equal(primera.length, 1);
  assert.equal(primera[0]!.titulo, 'Lola Pater');
  assert.equal(primera[0]!.anio, 2017);

  const segunda = await b.peliculas({ limite: 1, desde: 1 });
  assert.equal(segunda.length, 0, 'solo hay una película en la muestra');
  store.close();
});

test('la búsqueda traduce los tipos al idioma de la interfaz', async () => {
  const { biblioteca: b, store } = biblioteca();
  const resultados = await b.buscar('lola');
  assert.deepEqual(resultados, [{ tipo: 'pelicula', id: 'lola-pater-2017', titulo: 'Lola Pater' }]);
  store.close();
});

/** Biblioteca a mano con fechas de alta y notas: el M3U no las trae. */
function conFechas() {
  const store = LibraryStore.open(':memory:');
  const base = buildLibrary(parseM3U(SAMPLE).entries);
  store.import({
    ...base,
    movies: [
      { id: 'vieja', title: 'Vieja', year: 1990, rating: 4, added: 1_000, logo: null, groups: [], tags: [], variants: [] },
      { id: 'nueva', title: 'Nueva', year: 2026, rating: 6, added: 9_000, logo: null, groups: [], tags: [], variants: [] },
      { id: 'sinfecha', title: 'Sin fecha', year: null, rating: 9, added: null, logo: null, groups: [], tags: [], variants: [] },
    ],
  });
  return { biblioteca: bibliotecaDesde(store), store };
}

test('se puede ordenar por lo último que entró en el catálogo', async () => {
  const { biblioteca: b, store } = conFechas();
  const peliculas = await b.peliculas({ limite: 10, desde: 0, orden: 'reciente' });

  assert.deepEqual(
    peliculas.map((pelicula) => pelicula.titulo),
    ['Nueva', 'Vieja', 'Sin fecha'],
    'lo que no trae fecha va al final, no delante como si fuera de 1970',
  );
  store.close();
});

test('las fichas por identificador vuelven en el orden que se piden', async () => {
  const { biblioteca: b, store } = conFechas();
  // Es el orden de los favoritos: lo marcado más recientemente, primero.
  const peliculas = await b.peliculasPorId(['sinfecha', 'vieja']);
  assert.deepEqual(
    peliculas.map((pelicula) => pelicula.titulo),
    ['Sin fecha', 'Vieja'],
  );

  // Un identificador que ya no existe —el proveedor quitó la película— no
  // rompe la lista: simplemente no sale.
  assert.deepEqual(await b.peliculasPorId(['fantasma']), []);
  assert.deepEqual(await b.peliculasPorId([]), []);
  store.close();
});
