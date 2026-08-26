/**
 * Construye la biblioteca desde `player_api.php`, sin descargar el M3U.
 *
 * El M3U completo son ~71 MB de texto: en un portátil se traga, pero como
 * cadena de JavaScript ocupa el doble y en una tablet o un televisor —con 256
 * MB de montón— revienta antes de empezar a parsear. La API sirve lo mismo por
 * partes y ya clasificado, así que en esos aparatos no es una preferencia sino
 * la única vía.
 *
 * **Los episodios no se traen aquí.** `get_series_info` devuelve una serie por
 * petición, y son 6.598: pedirlas todas en la importación son 6.598 viajes.
 * Se importa el catálogo —canales, películas y fichas de serie— y las
 * temporadas se piden al abrir cada serie.
 */

import type {
  Channel,
  ChannelGroup,
  Episode,
  Library,
  LibraryStats,
  Movie,
  Season,
  Series,
  Variant,
} from '../models.ts';
import { cleanGroup, parseChannelName, parseName, qualityRank, slug } from '../normalize.ts';
import { anioDeFecha, epoch, segundosDeEpisodio, tituloDeEpisodio } from '../episodios.ts';
import { ordenarPor } from '../ordenar.ts';
import type { XtreamClient, LiveOutput } from './client.ts';
import type { XtreamCategory, XtreamLiveStream, XtreamSeries, XtreamVodStream } from './types.ts';

export interface OpcionesCatalogo {
  /** Formato del directo. Algunos paneles solo van bien con uno. */
  salidaDirecto?: LiveOutput;
  /** Se llama al terminar cada categoría, para poder pintar el avance. */
  avance?: (hecho: number, total: number, seccion: string) => void;
}

/**
 * La nota del panel, saneada.
 *
 * Llega como cadena y a veces vacía o a cero, que significa "sin valorar" y no
 * "malísima": conviene distinguirlo para no ordenar mal.
 */
function nota(valor: string | undefined): number | null {
  const numero = Number(valor);
  return Number.isFinite(numero) && numero > 0 ? Math.min(10, numero) : null;
}

/** Una variante única: la API da un solo enlace por contenido. */
function variante(url: string, calidad: string | null, raw: string): Variant[] {
  return [{ quality: calidad, rank: qualityRank(calidad), url, raw }];
}

export async function construirCatalogo(
  cliente: XtreamClient,
  opciones: OpcionesCatalogo = {},
): Promise<Library> {
  const salida = opciones.salidaDirecto ?? 'ts';
  const avisar = opciones.avance ?? (() => {});

  const [categoriasDirecto, categoriasVod, categoriasSeries] = await Promise.all([
    cliente.liveCategories(),
    cliente.vodCategories(),
    cliente.seriesCategories(),
  ]);

  const total = categoriasDirecto.length + categoriasVod.length + categoriasSeries.length;
  let hechas = 0;

  // ---- Directo ----------------------------------------------------------
  const canales = new Map<string, Channel>();
  const grupos = new Map<string, Set<string>>();
  let channelEntries = 0;

  for (const categoria of categoriasDirecto) {
    const streams = await pedir(() => cliente.liveStreams(categoria.category_id));
    for (const stream of streams) {
      channelEntries++;
      anadirCanal(canales, grupos, stream, categoria, cliente.liveUrl(stream.stream_id, salida));
    }
    avisar(++hechas, total, 'TV en directo');
  }

  // ---- Películas --------------------------------------------------------
  const peliculas = new Map<string, Movie>();
  let movieEntries = 0;

  for (const categoria of categoriasVod) {
    const streams = await pedir(() => cliente.vodStreams(categoria.category_id));
    for (const stream of streams) {
      movieEntries++;
      anadirPelicula(peliculas, stream, categoria, cliente);
    }
    avisar(++hechas, total, 'Películas');
  }

  // ---- Series (fichas, sin episodios) -----------------------------------
  const series = new Map<string, Series>();

  for (const categoria of categoriasSeries) {
    const fichas = await pedir(() => cliente.series(categoria.category_id));
    for (const ficha of fichas) {
      anadirSerie(series, ficha, categoria);
    }
    avisar(++hechas, total, 'Series');
  }

  // Ordenar 18.000 títulos es lo más caro de todo el proceso y va en el mismo
  // hilo que la interfaz. Se cede el turno antes para que la pantalla pinte el
  // último avance en lugar de quedarse congelada.
  avisar(total, total, 'Ordenando');
  await new Promise((listo) => setTimeout(listo, 0));

  const listaCanales = ordenarPor([...canales.values()], (canal) => canal.name);
  const listaGrupos: ChannelGroup[] = ordenarPor(
    [...grupos.entries()].map(([name, ids]) => ({ name, channelIds: [...ids] })),
    (grupo) => grupo.name,
  );
  const listaPeliculas = ordenarPor([...peliculas.values()], (pelicula) => pelicula.title);
  const listaSeries = ordenarPor([...series.values()], (serie) => serie.title);

  const stats: LibraryStats = {
    entries: channelEntries + movieEntries + listaSeries.length,
    channels: listaCanales.length,
    channelEntries,
    groups: listaGrupos.length,
    movies: listaPeliculas.length,
    movieEntries,
    series: listaSeries.length,
    // Los episodios llegan al abrir cada serie, no en la importación.
    episodes: 0,
    episodeEntries: 0,
    junk: 0,
    unknown: 0,
  };

  return {
    channels: listaCanales,
    groups: listaGrupos,
    movies: listaPeliculas,
    series: listaSeries,
    junk: [],
    unclassified: [],
    stats,
  };
}

/**
 * Una petición fallida de una categoría no puede tumbar la importación entera:
 * se pierde esa categoría y se sigue. Es preferible una biblioteca incompleta
 * a ninguna.
 */
async function pedir<T>(peticion: () => Promise<T[]>): Promise<T[]> {
  try {
    return await peticion();
  } catch {
    return [];
  }
}

function anadirCanal(
  canales: Map<string, Channel>,
  grupos: Map<string, Set<string>>,
  stream: XtreamLiveStream,
  categoria: XtreamCategory,
  url: string,
): void {
  // Misma fusión de calidades que con el M3U: el proveedor manda "24 Horas
  // FHD" y "24 Horas SD" como canales distintos.
  const { name, quality } = parseChannelName(stream.name);
  const tvgId = stream.epg_channel_id?.trim() || null;
  // Las categorías del panel llevan la misma decoración que los grupos del
  // M3U ("== NOTICIAS"), puesta para forzar el orden alfabético.
  const grupo = cleanGroup(categoria.category_name);
  const id = tvgId ? `tvg:${tvgId}` : `name:${slug(name)}@${slug(grupo)}`;

  let canal = canales.get(id);
  if (!canal) {
    canal = {
      id,
      name: name || stream.name,
      group: grupo,
      logo: stream.stream_icon || null,
      tvgId,
      variants: [],
    };
    canales.set(id, canal);
  }
  if (!canal.logo && stream.stream_icon) canal.logo = stream.stream_icon;
  if (!canal.variants.some((v) => v.url === url)) {
    canal.variants.push(variante(url, quality, stream.name)[0]!);
    canal.variants.sort((a, b) => b.rank - a.rank);
  }

  let bucket = grupos.get(grupo);
  if (!bucket) {
    bucket = new Set();
    grupos.set(grupo, bucket);
  }
  bucket.add(id);
}

function anadirPelicula(
  peliculas: Map<string, Movie>,
  stream: XtreamVodStream,
  categoria: XtreamCategory,
  cliente: XtreamClient,
): void {
  const parsed = parseName(stream.name);
  const title = parsed.title || stream.name;
  // El año que da el panel manda sobre el que venga en el nombre.
  const year = Number(stream.year) || parsed.year;
  const id = slug(`${title}-${year ?? ''}`);
  // La extensión importa: la URL sin ella no responde.
  const url = cliente.streamUrl('movie', stream.stream_id, stream.container_extension || 'mp4');

  let pelicula = peliculas.get(id);
  if (!pelicula) {
    pelicula = {
      id,
      title,
      year: year ?? null,
      rating: nota(stream.rating),
      added: epoch(stream.added),
      logo: stream.stream_icon || null,
      groups: [],
      tags: parsed.tags,
      variants: [],
    };
    peliculas.set(id, pelicula);
  }
  if (!pelicula.logo && stream.stream_icon) pelicula.logo = stream.stream_icon;
  const grupo = cleanGroup(categoria.category_name);
  if (!pelicula.groups.includes(grupo)) pelicula.groups.push(grupo);
  if (!pelicula.variants.some((v) => v.url === url)) {
    pelicula.variants.push(variante(url, parsed.quality, stream.name)[0]!);
    pelicula.variants.sort((a, b) => b.rank - a.rank);
  }
}

function anadirSerie(series: Map<string, Series>, ficha: XtreamSeries, categoria: XtreamCategory): void {
  const parsed = parseName(ficha.name);
  const title = parsed.title || ficha.name;
  const year = Number((ficha.releaseDate ?? '').slice(0, 4)) || parsed.year;
  // La identidad de la serie no lleva el grupo: el proveedor reparte la misma
  // serie entre varias categorías y debe salir una sola ficha.
  const id = slug(`${title}-${year ?? ''}`);

  let serie = series.get(id);
  if (!serie) {
    serie = {
      id,
      title,
      year: year ?? null,
      rating: nota(ficha.rating),
      added: epoch(ficha.last_modified),
      logo: ficha.cover || null,
      groups: [],
      // Las temporadas se piden al abrir la serie.
      seasons: [],
      panelIds: [],
    };
    series.set(id, serie);
  }
  if (!serie.logo && ficha.cover) serie.logo = ficha.cover;
  // La misma serie viene en varias categorías con fechas distintas: manda la
  // más reciente, que es cuando de verdad se tocó por última vez.
  const tocada = epoch(ficha.last_modified);
  if (tocada && (!serie.added || tocada > serie.added)) serie.added = tocada;
  const grupo = cleanGroup(categoria.category_name);
  if (!serie.groups.includes(grupo)) serie.groups.push(grupo);
  if (!serie.panelIds!.includes(ficha.series_id)) serie.panelIds!.push(ficha.series_id);
}

/**
 * Temporadas y episodios de una serie, pedidos al abrirla.
 *
 * Esta es la otra mitad del reparto: la importación trae solo los títulos, y
 * el detalle de cada serie llega cuando el usuario entra en ella. Así se pasa
 * de 6.598 peticiones en la importación a una sola, y solo de lo que se mira.
 *
 * `panelIds` puede traer varios porque el proveedor repite la misma serie en
 * varias categorías: se prueban en orden hasta que uno responda con episodios.
 */
/**
 * La ficha larga de una serie: sinopsis, reparto, género e imagen apaisada.
 *
 * Sale de la misma respuesta que las temporadas, pero se pide aparte: la
 * portada del inicio quiere la ficha de tres o cuatro series y no sus
 * episodios, que es lo que pesa. Devuelve `null` si no hay nada que contar.
 *
 * `backdrop_path` es lo único que sirve de fondo. `cover` es el cartel
 * vertical, y estirarlo a lo ancho es justo lo que no queremos.
 */
export async function fichaDeSerie(
  cliente: XtreamClient,
  panelIds: number[],
): Promise<{ sinopsis: string | null; reparto: string | null; fondo: string | null; genero: string | null } | null> {
  for (const panelId of panelIds) {
    let info;
    try {
      info = (await cliente.seriesInfo(panelId))?.info;
    } catch {
      continue;
    }
    if (!info) continue;

    const sinopsis = info.plot?.trim() || null;
    const reparto = info.cast?.trim() || null;
    const fondo = info.backdrop_path?.find((una) => typeof una === 'string' && una.trim()) ?? null;
    const genero = info.genre?.trim() || null;

    if (sinopsis || reparto || fondo || genero) return { sinopsis, reparto, fondo, genero };
  }
  return null;
}

export async function temporadasDeSerie(
  cliente: XtreamClient,
  panelIds: number[],
  /** Para poder quitarlo del título de cada episodio, donde el panel lo repite. */
  tituloSerie = '',
): Promise<Season[]> {
  for (const panelId of panelIds) {
    let info;
    try {
      info = await cliente.seriesInfo(panelId);
    } catch {
      continue;
    }

    const porTemporada = info?.episodes;
    if (!porTemporada) continue;

    const temporadas: Season[] = [];
    for (const [clave, lista] of Object.entries(porTemporada)) {
      const numero = Number(clave);
      if (!Number.isFinite(numero) || !Array.isArray(lista)) continue;

      const episodios: Episode[] = lista.map((episodio) => {
        // El número de episodio llega como cadena en muchos paneles.
        const numeroEpisodio = Number(episodio.episode_num) || 0;
        const extension = episodio.container_extension || 'mkv';
        const url = cliente.streamUrl('series', episodio.id, extension);
        const info = episodio.info;
        return {
          season: numero,
          episode: numeroEpisodio,
          title: tituloDeEpisodio(episodio.title, tituloSerie),
          logo: info?.movie_image || null,
          plot: info?.plot?.trim() || null,
          rating: nota(info?.rating === undefined ? undefined : String(info.rating)),
          year: anioDeFecha(info?.releaseDate),
          seconds: segundosDeEpisodio(info?.duration_secs, info?.duration),
          groups: [],
          variants: [{ quality: null, rank: 0, url, raw: episodio.title ?? '' }],
        };
      });

      if (episodios.length === 0) continue;
      temporadas.push({
        number: numero,
        episodes: episodios.sort((a, b) => a.episode - b.episode),
      });
    }

    if (temporadas.length > 0) return temporadas.sort((a, b) => a.number - b.number);
  }

  return [];
}
