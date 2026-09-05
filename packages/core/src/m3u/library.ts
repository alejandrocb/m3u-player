/**
 * De lista plana a biblioteca navegable.
 *
 * La idea central es la misma en las tres secciones: **el proveedor manda una
 * entrada por cada calidad**, y mostrarlas tal cual llena la biblioteca de
 * duplicados. Canales, películas y episodios se fusionan por su identidad y
 * guardan las calidades como variantes.
 *
 * Identidades:
 *   - Canal:    tvg-id, o nombre sin sufijo de calidad + grupo.
 *   - Película: título limpio + año.
 *   - Serie:    título limpio + año, SIN el grupo (el proveedor reparte la
 *               misma serie entre "TV Series NETFLIX" y "TV Series OTROS").
 *   - Episodio: temporada + número, dentro de su serie.
 */

import { idDeCanalPorNombre, idDeCanalPorTvg } from '../canales.ts';
import { classify, parseEpisodeTag, parseSeriesHead } from '../classify.ts';
import { duplicadasSinAnio } from '../duplicados.ts';
import type {
  Channel,
  ChannelGroup,
  Episode,
  Library,
  LibraryStats,
  Movie,
  RawEntry,
  Season,
  Series,
  Variant,
} from '../models.ts';
import { cleanGroup, parseChannelName, parseName, qualityRank, slug } from '../normalize.ts';
import { ordenarPor } from '../ordenar.ts';

/** Acumuladores con Set para no repetir grupos ni etiquetas. */
interface MovieDraft {
  id: string;
  title: string;
  year: number | null;
  logo: string | null;
  groups: Set<string>;
  tags: Set<string>;
  variants: Variant[];
}

interface EpisodeDraft {
  season: number;
  episode: number;
  title: string | null;
  logo: string | null;
  groups: Set<string>;
  variants: Variant[];
}

interface SeriesDraft {
  id: string;
  title: string;
  year: number | null;
  logo: string | null;
  groups: Set<string>;
  episodes: Map<string, EpisodeDraft>;
}

export function buildLibrary(entries: RawEntry[]): Library {
  const channels = new Map<string, Channel>();
  const groups = new Map<string, Set<string>>();
  const movies = new Map<string, MovieDraft>();
  const seriesById = new Map<string, SeriesDraft>();
  const junk: RawEntry[] = [];
  const unclassified: RawEntry[] = [];

  let channelEntries = 0;
  let movieEntries = 0;
  let episodeEntries = 0;
  let unknown = 0;

  for (const entry of entries) {
    const { kind, guessed } = classify(entry);
    if (guessed) {
      unknown++;
      unclassified.push(entry);
    }

    const group = cleanGroup(entry.attrs['group-title'] ?? '') || 'Sin grupo';
    const logo = entry.attrs['tvg-logo'] || null;

    if (kind === 'junk') {
      junk.push(entry);
      continue;
    }

    if (kind === 'live') {
      channelEntries++;
      addChannel(channels, groups, entry, group, logo);
      continue;
    }

    if (kind === 'movie') {
      movieEntries++;
      addMovie(movies, entry, group, logo);
      continue;
    }

    // kind === 'series'
    const tag = parseEpisodeTag(entry.name);
    if (!tag) {
      // El grupo dice "series" pero el nombre no trae marca de episodio.
      // Puede ser una película colada en un grupo de series, o una
      // nomenclatura que no reconocemos. Va a películas para que siga siendo
      // visible y reproducible, en vez de desaparecer.
      movieEntries++;
      addMovie(movies, entry, group, logo);
      unknown++;
      unclassified.push(entry);
      continue;
    }

    episodeEntries++;
    addEpisode(seriesById, entry, tag, group, logo);
  }

  for (const channel of channels.values()) sortVariants(channel.variants);

  const channelList = ordenarPor([...channels.values()], (canal) => canal.name);

  const groupList: ChannelGroup[] = ordenarPor(
    [...groups.entries()].map(([name, ids]) => ({ name, channelIds: [...ids] })),
    (grupo) => grupo.name,
  );

  /*
    La misma película escrita con el año y sin él salía dos veces, con la misma
    carátula y una al lado de la otra. Se juntan antes de la lista, y solo
    cuando no hay duda de cuál es cuál.
  */
  for (const { suelta, destino } of duplicadasSinAnio(movies.values())) {
    if (!destino.logo && suelta.logo) destino.logo = suelta.logo;
    for (const grupo of suelta.groups) destino.groups.add(grupo);
    for (const etiqueta of suelta.tags) destino.tags.add(etiqueta);
    for (const variante of suelta.variants) {
      if (!destino.variants.some((otra) => otra.url === variante.url)) destino.variants.push(variante);
    }
    movies.delete(suelta.id);
  }

  const movieList: Movie[] = ordenarPor(
    [...movies.values()].map((draft) => ({
      id: draft.id,
      title: draft.title,
      year: draft.year,
      // El M3U no trae valoraciones ni fechas de alta: eso solo viene por la
      // API del panel.
      rating: null,
      added: null,
      logo: draft.logo,
      groups: [...draft.groups],
      tags: [...draft.tags],
      variants: sortVariants(draft.variants),
    })),
    (pelicula) => pelicula.title,
  );

  let episodes = 0;
  const seriesList: Series[] = ordenarPor(
    [...seriesById.values()].map((draft) => {
      const bySeason = new Map<number, Episode[]>();
      for (const episodeDraft of draft.episodes.values()) {
        episodes++;
        const episode: Episode = {
          season: episodeDraft.season,
          episode: episodeDraft.episode,
          title: episodeDraft.title,
          logo: episodeDraft.logo,
          // La ficha del episodio —sinopsis, nota, duración— la da
          // `get_series_info`; por M3U no llega nada de esto.
          plot: null,
          rating: null,
          year: null,
          seconds: null,
          groups: [...episodeDraft.groups],
          variants: sortVariants(episodeDraft.variants),
        };
        const bucket = bySeason.get(episode.season);
        if (bucket) bucket.push(episode);
        else bySeason.set(episode.season, [episode]);
      }

      const seasons: Season[] = [...bySeason.entries()]
        .map(([number, list]) => ({ number, episodes: list.sort((a, b) => a.episode - b.episode) }))
        .sort((a, b) => a.number - b.number);

      return {
        id: draft.id,
        title: draft.title,
        year: draft.year,
        rating: null,
        added: null,
        logo: draft.logo,
        // Del M3U no sale género: ahí no hay más que el nombre de la entrada.
        genre: null,
        groups: [...draft.groups],
        seasons,
      };
    }),
    (serie) => serie.title,
  );

  const stats: LibraryStats = {
    entries: entries.length,
    channels: channelList.length,
    channelEntries,
    groups: groupList.length,
    movies: movieList.length,
    movieEntries,
    series: seriesList.length,
    episodes,
    episodeEntries,
    junk: junk.length,
    unknown,
  };

  return {
    channels: channelList,
    groups: groupList,
    movies: movieList,
    series: seriesList,
    junk,
    unclassified,
    stats,
  };
}

/** De mejor a peor calidad, en el sitio. */
function sortVariants(variants: Variant[]): Variant[] {
  return variants.sort((a, b) => b.rank - a.rank);
}

/** Añade una variante si esa URL no estaba ya (la lista repite entradas). */
function addVariant(variants: Variant[], quality: string | null, url: string, raw: string): void {
  if (variants.some((variant) => variant.url === url)) return;
  variants.push({ quality, rank: qualityRank(quality), url, raw });
}

function addChannel(
  channels: Map<string, Channel>,
  groups: Map<string, Set<string>>,
  entry: RawEntry,
  group: string,
  logo: string | null,
): void {
  const { name, quality } = parseChannelName(entry.name);
  const tvgId = entry.attrs['tvg-id']?.trim() || null;

  // La identidad del canal es su tvg-id cuando existe; si no, el nombre sin
  // calidad. Se incluye el grupo en la clave del fallback para no fusionar
  // dos canales distintos que casualmente se llamen igual en secciones
  // diferentes (un "Deportes 1" de fútbol y otro de motor).
  const id = tvgId ? idDeCanalPorTvg(tvgId) : idDeCanalPorNombre(name, group);

  let channel = channels.get(id);
  if (!channel) {
    channel = { id, name: name || entry.name, group, logo, tvgId, variants: [] };
    channels.set(id, channel);
  }
  if (!channel.logo && logo) channel.logo = logo;
  addVariant(channel.variants, quality, entry.url, entry.name);

  let bucket = groups.get(group);
  if (!bucket) {
    bucket = new Set();
    groups.set(group, bucket);
  }
  bucket.add(id);
}

function addMovie(movies: Map<string, MovieDraft>, entry: RawEntry, group: string, logo: string | null): void {
  const parsed = parseName(entry.name);
  const title = parsed.title || entry.name;
  const id = slug(`${title}-${parsed.year ?? ''}`);

  let movie = movies.get(id);
  if (!movie) {
    movie = { id, title, year: parsed.year, logo, groups: new Set(), tags: new Set(), variants: [] };
    movies.set(id, movie);
  }
  if (!movie.logo && logo) movie.logo = logo;
  movie.groups.add(group);
  for (const tag of parsed.tags) movie.tags.add(tag);
  addVariant(movie.variants, parsed.quality, entry.url, entry.name);
}

function addEpisode(
  seriesById: Map<string, SeriesDraft>,
  entry: RawEntry,
  tag: { season: number; episode: number; index: number; length: number },
  group: string,
  logo: string | null,
): void {
  const head = parseSeriesHead(entry.name, tag);
  const title = head.title || entry.name;
  const id = slug(`${title}-${head.year ?? ''}`);

  // Lo que sobra tras la marca de episodio suele ser calidad ("S1 E47 1080p"),
  // pero a veces es el título del episodio.
  const trailing = parseName(entry.name.slice(tag.index + tag.length));

  let series = seriesById.get(id);
  if (!series) {
    series = { id, title, year: head.year, logo, groups: new Set(), episodes: new Map() };
    seriesById.set(id, series);
  }
  if (!series.logo && logo) series.logo = logo;
  series.groups.add(group);

  const key = `${tag.season}:${tag.episode}`;
  let episode = series.episodes.get(key);
  if (!episode) {
    episode = {
      season: tag.season,
      episode: tag.episode,
      title: trailing.title || null,
      logo,
      groups: new Set(),
      variants: [],
    };
    series.episodes.set(key, episode);
  }
  if (!episode.logo && logo) episode.logo = logo;
  if (!episode.title && trailing.title) episode.title = trailing.title;
  episode.groups.add(group);
  addVariant(episode.variants, trailing.quality ?? head.quality, entry.url, entry.name);
}
