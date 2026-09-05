/**
 * TMDb: casar nuestra película con la suya.
 *
 * Lo que hay que dejar clavado es el sesgo, que aquí es el contrario del que
 * lleva el clasificador: **ante la duda, sin género**. Una película sin
 * género sale igual en su fila de novedades y no molesta a nadie; una con el
 * género de otra ensucia una fila entera del inicio, y nadie sabe por qué.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { crearTmdb } from '../src/tmdb.ts';
import type { Tmdb } from '../src/tmdb.ts';

/** El género de una película, que es lo que mira casi todo este fichero. */
async function genero(tmdb: Tmdb, titulo: string, anio: number | null): Promise<string> {
  return (await tmdb.fichaDe(titulo, anio, 'pelicula'))?.genero ?? '';
}

interface Peli {
  id?: number;
  overview?: string;
  backdrop_path?: string;
  title: string;
  original_title?: string;
  release_date: string;
  genre_ids: number[];
}

/** Un TMDb de mentira. Contesta a la búsqueda con lo que se le diga. */
function tmdbFalso(porConsulta: Record<string, Peli[]>, pedidas: string[] = []): typeof globalThis.fetch {
  return (async (entrada: string | URL | Request) => {
    const url = new URL(String(entrada));
    const responder = (datos: unknown): Response =>
      new Response(JSON.stringify(datos), { status: 200, headers: { 'Content-Type': 'application/json' } });

    // La ficha, que es la segunda petición: reparto y tráiler.
    if (/^\/3\/(movie|tv)\/\d+$/.test(url.pathname)) {
      return responder({
        credits: { cast: [{ name: 'Actriz Primera' }, { name: 'Actor Segundo' }] },
        aggregate_credits: { cast: [{ name: 'Actriz Primera' }] },
        videos: {
          results: [
            { site: 'Vimeo', type: 'Trailer', key: 'noesestaa' },
            { site: 'YouTube', type: 'Featurette', key: 'tampocoesta' },
            { site: 'YouTube', type: 'Trailer', key: 'dQw4w9WgXcQ' },
          ],
        },
      });
    }

    if (url.pathname === '/3/genre/movie/list' || url.pathname === '/3/genre/tv/list') {
      return responder({
        genres: [
          { id: 18, name: 'Drama' },
          { id: 35, name: 'Comedia' },
          { id: 878, name: 'Ciencia ficción' },
        ],
      });
    }

    // La clave del catálogo falso: el texto buscado y, si lo lleva, el año.
    const anio = url.searchParams.get('year');
    const clave = `${url.searchParams.get('query')}${anio ? `|${anio}` : ''}`;
    pedidas.push(clave);
    return responder({ results: porConsulta[clave] ?? [] });
  }) as typeof globalThis.fetch;
}

test('la ficha entera: género, sinopsis, fondo, reparto y tráiler', async () => {
  const tmdb = crearTmdb('t', {
    fetch: tmdbFalso({
      'El aviso|2018': [
        {
          id: 42,
          title: 'El aviso',
          release_date: '2018-03-23',
          genre_ids: [18, 878],
          overview: 'Un chico descubre un patrón.',
          backdrop_path: '/fondo.jpg',
        },
      ],
    }),
  });

  assert.deepEqual(await tmdb.fichaDe('El aviso', 2018, 'pelicula'), {
    genero: 'Drama, Ciencia ficción',
    sinopsis: 'Un chico descubre un patrón.',
    // La dirección entera, con el ancho ya elegido: el aparato no tiene por
    // qué saber cómo monta TMDb las suyas.
    fondo: 'https://image.tmdb.org/t/p/w1280/fondo.jpg',
    reparto: 'Actriz Primera, Actor Segundo',
    // Ni el de Vimeo ni el "detrás de las cámaras": el tráiler de YouTube.
    trailer: 'dQw4w9WgXcQ',
  });
});

test('con el título y el año, el género', async () => {
  const tmdb = crearTmdb('t', {
    fetch: tmdbFalso({
      'El aviso|2018': [
        {
          id: 42,
          title: 'El aviso',
          release_date: '2018-03-23',
          genre_ids: [18, 878],
          overview: 'Un chico descubre un patrón.',
          backdrop_path: '/fondo.jpg',
        },
      ],
    }),
  });

  assert.equal(await genero(tmdb, 'El aviso', 2018), 'Drama, Ciencia ficción');
});

test('la búsqueda lleva el año, que es lo que separa dos películas del mismo título', async () => {
  const pedidas: string[] = [];
  const tmdb = crearTmdb('t', {
    fetch: tmdbFalso(
      { 'Robin Hood|2018': [{ title: 'Robin Hood', release_date: '2018-11-21', genre_ids: [18] }] },
      pedidas,
    ),
  });

  assert.equal(await genero(tmdb, 'Robin Hood', 2018), 'Drama');
  assert.deepEqual(pedidas, ['Robin Hood|2018'], 'no hace falta una segunda búsqueda');
});

test('si el título no cuadra y hay varios candidatos, sin género', async () => {
  /*
    Es el caso peligroso: el proveedor escribe el título a su manera, TMDb
    devuelve tres cosas parecidas y ninguna se llama igual. Ponerle el género
    de la primera sería inventárselo.
  */
  const tmdb = crearTmdb('t', {
    fetch: tmdbFalso({
      'Pelicula raruna|2020': [
        { title: 'Otra cosa', release_date: '2020-01-01', genre_ids: [35] },
        { title: 'Y otra más', release_date: '2020-06-01', genre_ids: [18] },
      ],
      'Pelicula raruna': [
        { title: 'Otra cosa', release_date: '2020-01-01', genre_ids: [35] },
        { title: 'Y otra más', release_date: '2020-06-01', genre_ids: [18] },
      ],
    }),
  });

  assert.equal(await genero(tmdb, 'Pelicula raruna', 2020), '');
});

test('con año y un solo candidato, se acepta aunque el título esté escrito de otra forma', async () => {
  // El año ya ha hecho de filtro: si con él solo queda una, es esa.
  const tmdb = crearTmdb('t', {
    fetch: tmdbFalso({
      'Amor es amor-Love is Love|2019': [
        { title: 'Amor es amor', release_date: '2019-05-01', genre_ids: [35] },
      ],
    }),
  });

  assert.equal(await genero(tmdb, 'Amor es amor-Love is Love', 2019), 'Comedia');
});

test('sin año, el título tiene que cuadrar exactamente', async () => {
  const tmdb = crearTmdb('t', {
    fetch: tmdbFalso({
      'El aviso': [
        { title: 'El aviso', release_date: '2018-03-23', genre_ids: [18] },
        { title: 'La advertencia', release_date: '2018-01-01', genre_ids: [35] },
      ],
    }),
  });

  assert.equal(await genero(tmdb, 'El aviso', null), 'Drama');
  assert.equal(await genero(tmdb, 'Otra que no está', null), '');
});

test('el título casa aunque cambien las tildes y las mayúsculas', async () => {
  const tmdb = crearTmdb('t', {
    fetch: tmdbFalso({
      'EL ULTIMO REDUCTO|2021': [
        { title: 'El último reducto', release_date: '2021-02-02', genre_ids: [18] },
      ],
      'EL ULTIMO REDUCTO': [
        { title: 'El último reducto', release_date: '2021-02-02', genre_ids: [18] },
        { title: 'Cualquier otra', release_date: '2021-03-03', genre_ids: [35] },
      ],
    }),
  });

  assert.equal(await genero(tmdb, 'EL ULTIMO REDUCTO', 2021), 'Drama');
});

test('un año que se va por veinte no es la misma película', async () => {
  // Buscando sin año aparecen homónimas de otra época: se descartan.
  const tmdb = crearTmdb('t', {
    fetch: tmdbFalso({
      'Los intocables|2018': [],
      'Los intocables': [{ title: 'Los intocables', release_date: '1987-06-03', genre_ids: [18] }],
    }),
  });

  assert.equal(await genero(tmdb, 'Los intocables', 2018), '');
});
