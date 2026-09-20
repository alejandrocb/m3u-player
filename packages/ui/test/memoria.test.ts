import assert from 'node:assert/strict';
import test from 'node:test';

import { buildLibrary, parseM3U } from '@m3u/core/m3u';

import { bibliotecaEnMemoria } from '../src/memoria.ts';
import { Presentador } from '../src/presentador.ts';
import { SAMPLE } from '../../core/test/fixtures.ts';

function biblioteca() {
  return bibliotecaEnMemoria(buildLibrary(parseM3U(SAMPLE).entries));
}

test('los totales coinciden con los de la biblioteca', async () => {
  assert.deepEqual(await biblioteca().totales(), { canales: 3, peliculas: 1, series: 2, episodios: 4 });
});

test('los canales se filtran por grupo', async () => {
  const canales = await biblioteca().canalesDeGrupo('NOTICIAS');
  assert.deepEqual(
    canales.map((canal) => canal.nombre),
    ['24 Horas', 'Al Jazeera Arabic', 'Al Jazeera English'],
  );
});

test('las temporadas salen con su recuento', async () => {
  const b = biblioteca();
  const series = await b.series({ limite: 10, desde: 0 });
  const paQuererte = series.find((serie) => serie.titulo === 'Pa Quererte')!;

  assert.deepEqual(await b.temporadas(paQuererte.id), [
    { numero: 1, episodios: 2 },
    { numero: 2, episodios: 1 },
  ]);
});

test('los episodios reciben un identificador propio y estable', async () => {
  const b = biblioteca();
  const series = await b.series({ limite: 10, desde: 0 });
  const paQuererte = series.find((serie) => serie.titulo === 'Pa Quererte')!;

  const episodios = await b.episodios(paQuererte.id, 1);
  assert.deepEqual(
    episodios.map((episodio) => episodio.numero),
    [47, 48],
  );
  // Sin rowid de SQLite, el identificador lo pone el índice en memoria: lo
  // importante es que sirva luego para pedir las variantes.
  const variantes = await b.variantes('episodio', String(episodios[0]!.id));
  assert.equal(variantes.length, 2, 'el episodio 47 venía en 1080p y en 720p');
  assert.deepEqual(
    variantes.map((variante) => variante.calidad),
    ['1080p', '720p'],
  );
});

test('las variantes de un canal van de mejor a peor', async () => {
  const b = biblioteca();
  const canales = await b.canalesDeGrupo('NOTICIAS');
  const veinticuatro = canales.find((canal) => canal.nombre === '24 Horas')!;

  assert.deepEqual(
    (await b.variantes('canal', veinticuatro.id)).map((variante) => variante.calidad),
    ['FHD', 'SD'],
  );
});

test('la búsqueda encuentra en las tres secciones', async () => {
  const b = biblioteca();
  assert.deepEqual(await b.buscar('lola'), [{ tipo: 'pelicula', id: 'lola-pater-2017', titulo: 'Lola Pater' }]);
  assert.equal((await b.buscar('jazeera')).length, 2);
  assert.equal((await b.buscar('')).length, 0, 'sin texto no se busca');
});

test('el presentador navega sobre la biblioteca en memoria', async () => {
  // La misma interfaz que en escritorio, sin SQLite por debajo: es lo que
  // permite arrancar la app de Android TV antes de tener base de datos.
  const presentador = new Presentador(biblioteca());
  const inicio = await presentador.cargar();

  // El inicio son filas, no una rejilla.
  assert.ok((inicio.inicio?.filas.length ?? 0) > 0);
  assert.deepEqual(inicio.elementos, []);

  // TV en directo es otra pestaña del mismo inicio: una fila por grupo de
  // canales, con todos dentro.
  const directo = await presentador.elegirModo('directo');
  assert.ok((directo.inicio?.filas.length ?? 0) > 0);
  assert.deepEqual(directo.elementos, []);

  const { reproducir } = await presentador.aceptar();
  assert.equal(reproducir?.clase, 'canal');
});

test('las temporadas se piden solo la primera vez que se abre la serie', async () => {
  // Con un panel Xtream el catálogo llega sin episodios: cada serie los pide
  // al abrirse, y a partir de ahí ya los tiene.
  const library = buildLibrary(parseM3U(SAMPLE).entries);
  // Se vacían las temporadas para simular el catálogo que da la API.
  for (const serie of library.series) serie.seasons = [];

  let peticiones = 0;
  const b = bibliotecaEnMemoria(library, {
    async traerTemporadas(serie) {
      peticiones++;
      return [
        {
          number: 1,
          episodes: [
            {
              season: 1,
              episode: 1,
              title: 'Capítulo 1',
              logo: null,
              plot: null,
            rating: null,
            year: null,
            seconds: null,
            groups: [],
              variants: [{ quality: null, rank: 0, url: `http://host/${serie.id}/1.mkv`, raw: '' }],
            },
          ],
        },
      ];
    },
  });

  const serieId = (await b.series({ limite: 10, desde: 0 }))[0]!.id;

  assert.equal(peticiones, 0, 'listar series no dispara ninguna petición');

  assert.deepEqual(await b.temporadas(serieId), [{ numero: 1, episodios: 1 }]);
  assert.equal(peticiones, 1);

  // Segunda visita: ya está guardada.
  await b.temporadas(serieId);
  await b.episodios(serieId, 1);
  assert.equal(peticiones, 1, 'no se vuelve a pedir lo que ya se trajo');
});

test('un episodio traído bajo demanda queda listo para reproducir', async () => {
  const library = buildLibrary(parseM3U(SAMPLE).entries);
  for (const serie of library.series) serie.seasons = [];

  const b = bibliotecaEnMemoria(library, {
    async traerTemporadas() {
      return [
        {
          number: 3,
          episodes: [
            {
              season: 3,
              episode: 7,
              title: null,
              logo: null,
              plot: null,
            rating: null,
            year: null,
            seconds: null,
            groups: [],
              variants: [{ quality: '1080p', rank: 1080, url: 'http://host/ep.mkv', raw: '' }],
            },
          ],
        },
      ];
    },
  });

  const serieId = (await b.series({ limite: 10, desde: 0 }))[0]!.id;
  const episodios = await b.episodios(serieId, 3);
  assert.equal(episodios.length, 1);

  // El identificador que asigna el índice tiene que servir para las variantes.
  const variantes = await b.variantes('episodio', String(episodios[0]!.id));
  assert.deepEqual(variantes, [{ url: 'http://host/ep.mkv', calidad: '1080p' }]);
});
