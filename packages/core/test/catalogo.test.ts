import assert from 'node:assert/strict';
import test from 'node:test';

import { construirCatalogo, temporadasDeSerie } from '../src/xtream/catalogo.ts';
import { XtreamClient } from '../src/xtream/client.ts';
import { cleanGroup } from '../src/normalize.ts';

/**
 * Un panel de mentira: responde a `player_api.php` con datos parecidos a los
 * reales, incluidas sus rarezas (números como cadenas, la misma serie en dos
 * categorías, el mismo canal en dos calidades).
 */
function panelFalso(fallar: string[] = []) {
  const respuestas: Record<string, unknown> = {
    get_live_categories: [
      { category_id: '1', category_name: '== NOTICIAS' },
      { category_id: '2', category_name: '▶ DEPORTES |' },
    ],
    get_vod_categories: [{ category_id: '10', category_name: 'Estrenos' }],
    get_series_categories: [
      { category_id: '20', category_name: 'TV Series NETFLIX' },
      { category_id: '21', category_name: 'TV Series OTROS' },
    ],
    'get_live_streams:1': [
      { stream_id: 101, name: '24 Horas FHD', epg_channel_id: '24h', stream_icon: 'http://cdn/24h.png' },
      { stream_id: 102, name: '24 Horas SD', epg_channel_id: '24h' },
      { stream_id: 103, name: 'Al Jazeera', epg_channel_id: '' },
    ],
    'get_live_streams:2': [{ stream_id: 201, name: 'Deportes 1', epg_channel_id: '' }],
    'get_vod_streams:10': [
      { stream_id: 3001, name: 'Lola Pater (2017) 1080p', container_extension: 'mkv', year: '2017' },
      { stream_id: 3002, name: 'Otra peli', container_extension: 'mp4' },
    ],
    'get_series:20': [{ series_id: 501, name: 'Pa Quererte', releaseDate: '2020-01-01', cover: 'http://cdn/pq.jpg' }],
    'get_series:21': [{ series_id: 502, name: 'Pa Quererte', releaseDate: '2020-01-01' }],
    // Sin episodios: obliga a probar el siguiente identificador.
    get_series_info: {},
  };

  const fetchFalso = (async (entrada: string | URL) => {
    const url = new URL(String(entrada));
    const accion = url.searchParams.get('action') ?? '';
    const categoria = url.searchParams.get('category_id');
    const clave = categoria ? `${accion}:${categoria}` : accion;

    if (fallar.includes(clave)) return new Response('vaya', { status: 500 });
    return new Response(JSON.stringify(respuestas[clave] ?? []), { status: 200 });
  }) as typeof globalThis.fetch;

  return new XtreamClient(
    { base: 'http://panel:8080', username: 'u', password: 'p' },
    { fetch: fetchFalso },
  );
}

/**
 * Panel que sí devuelve episodios, para la carga bajo demanda.
 *
 * Reproduce dos rarezas reales: los números llegan como cadenas y los
 * episodios no vienen ordenados.
 */
function panelConEpisodios() {
  const fetchFalso = (async (entrada: string | URL) => {
    const url = new URL(String(entrada));
    if (url.searchParams.get('action') !== 'get_series_info') {
      return new Response('[]', { status: 200 });
    }

    // Cualquier serie que no sea la 501 está sin episodios en el panel.
    if (url.searchParams.get('series_id') !== '501') {
      return new Response(JSON.stringify({ episodes: {} }), { status: 200 });
    }

    return new Response(
      JSON.stringify({
        info: { name: 'Pa Quererte' },
        episodes: {
          '1': [
            { id: '9002', episode_num: '48', title: 'Capítulo 48', container_extension: 'mkv' },
            { id: '9001', episode_num: '47', title: 'Capítulo 47', container_extension: 'mkv' },
          ],
          '2': [{ id: '9003', episode_num: 1, title: 'Capítulo 1', container_extension: 'mp4' }],
        },
      }),
      { status: 200 },
    );
  }) as typeof globalThis.fetch;

  return new XtreamClient({ base: 'http://panel:8080', username: 'u', password: 'p' }, { fetch: fetchFalso });
}

test('el catálogo llega clasificado y con los grupos del panel', async () => {
  const library = await construirCatalogo(panelFalso());

  assert.deepEqual(
    library.groups.map((grupo) => grupo.name),
    ['DEPORTES', 'NOTICIAS'],
  );
  assert.equal(library.movies.length, 2);
  assert.equal(library.stats.channels, 3, 'las dos calidades de 24 Horas son un solo canal');
});

test('las calidades del mismo canal se fusionan, como con el M3U', async () => {
  const library = await construirCatalogo(panelFalso());
  const veinticuatro = library.channels.find((canal) => canal.name === '24 Horas');

  assert.ok(veinticuatro);
  assert.equal(veinticuatro.variants.length, 2);
  assert.deepEqual(
    veinticuatro.variants.map((variante) => variante.quality),
    ['FHD', 'SD'],
  );
  assert.equal(veinticuatro.logo, 'http://cdn/24h.png', 'el logo se toma de la variante que lo traiga');
});

test('la misma serie en dos categorías sale una sola vez', async () => {
  const library = await construirCatalogo(panelFalso());

  assert.equal(library.series.length, 1);
  const serie = library.series[0]!;
  assert.deepEqual(serie.groups, ['TV Series NETFLIX', 'TV Series OTROS']);
  // Los dos identificadores del panel se guardan: hacen falta para pedir los
  // episodios, y cualquiera de los dos sirve.
  assert.deepEqual(serie.panelIds, [501, 502]);
});

test('los episodios no se traen en la importación', async () => {
  const library = await construirCatalogo(panelFalso());
  assert.equal(library.stats.episodes, 0);
  assert.deepEqual(library.series[0]!.seasons, []);
});

test('las URLs llevan la extensión real del fichero', async () => {
  const library = await construirCatalogo(panelFalso());
  const lola = library.movies.find((pelicula) => pelicula.title === 'Lola Pater')!;

  assert.match(lola.variants[0]!.url, /\/movie\/u\/p\/3001\.mkv$/);
  assert.equal(lola.year, 2017);
});

test('una categoría que falla no tumba la importación entera', async () => {
  // Es preferible una biblioteca a la que le falte una categoría que ninguna.
  const library = await construirCatalogo(panelFalso(['get_live_streams:2']));

  assert.equal(library.channels.length, 2, 'los de NOTICIAS siguen ahí');
  assert.equal(library.movies.length, 2);
});

test('el avance se informa por categoría', async () => {
  const pasos: string[] = [];
  await construirCatalogo(panelFalso(), {
    avance: (hecho, total, seccion) => pasos.push(`${hecho}/${total} ${seccion}`),
  });

  assert.deepEqual(pasos, [
    '1/5 TV en directo',
    '2/5 TV en directo',
    '3/5 Películas',
    '4/5 Series',
    '5/5 Series',
    // El último paso es ordenar, que con miles de títulos se nota.
    '5/5 Ordenando',
  ]);
});

test('las temporadas se piden al abrir la serie, no antes', async () => {
  const cliente = panelConEpisodios();
  const temporadas = await temporadasDeSerie(cliente, [501]);

  assert.deepEqual(
    temporadas.map((temporada) => temporada.number),
    [1, 2],
  );
  assert.deepEqual(
    temporadas[0]!.episodes.map((episodio) => episodio.episode),
    [47, 48],
    'los episodios salen ordenados aunque el panel los mande al revés',
  );
  assert.match(temporadas[0]!.episodes[0]!.variants[0]!.url, /\/series\/u\/p\/9001\.mkv$/);
});

test('si un identificador no trae episodios, se prueba el siguiente', async () => {
  // El proveedor repite la serie en dos categorías y a veces solo una tiene
  // los episodios cargados.
  const cliente = panelConEpisodios();
  const temporadas = await temporadasDeSerie(cliente, [999, 501]);
  assert.equal(temporadas.length, 2);
});

test('una serie sin episodios devuelve una lista vacía, no un error', async () => {
  const cliente = panelConEpisodios();
  assert.deepEqual(await temporadasDeSerie(cliente, [999]), []);
});

test('la decoración de las categorías se limpia, como en el M3U', () => {
  // El proveedor las adorna para forzar el orden: "== NOTICIAS", "▶ DEPORTES |".
  assert.equal(cleanGroup('== NOTICIAS'), 'NOTICIAS');
  assert.equal(cleanGroup('▶ DEPORTES |'), 'DEPORTES');
});
