/**
 * Decide si una entrada es TV en directo, película, episodio de serie o basura.
 *
 * Se combinan tres señales, en orden de fiabilidad:
 *   1. La ruta de la URL (/live/, /movie/, /series/ en paneles Xtream Codes).
 *   2. El group-title del proveedor.
 *   3. El patrón del nombre (marca de episodio, extensión de fichero).
 */

import type { Kind, RawEntry } from './models.ts';
import type { ParsedName } from './normalize.ts';
import { fold, parseName, tidy } from './normalize.ts';

/** Marca de episodio dentro del nombre. */
export interface EpisodeTag {
  season: number;
  episode: number;
  /** Posición donde empieza la marca: todo lo anterior es el título de la serie. */
  index: number;
  /** Longitud del texto que ocupa la marca. */
  length: number;
}

/**
 * Formatos aceptados, en un solo pasada:
 *   S1 E47 · S01E47 · S01 E47 · s1e47
 *   1x47 · 01x47
 *   T1 C47 · Temporada 1 Capitulo 47 · Temp 1 Cap 47
 */
const EPISODE_PATTERNS: RegExp[] = [
  // La temporada admite 4 cifras porque hay proveedores que usan el año como
  // temporada ("Formula 1 S2026 E24"), y el episodio hasta 6 porque a veces
  // cuelan el id del stream en su lugar ("Doctor Who S2 E43171").
  /\bs\s?(\d{1,4})\s*[ex]\s?(\d{1,6})\b/i,
  /\b(\d{1,3})\s?x\s?(\d{1,6})\b/,
  /\bt(?:emp(?:orada)?)?\.?\s?(\d{1,4})\s*[\s.-]*c(?:ap(?:itulo)?)?\.?\s?(\d{1,6})\b/i,
];

/** Busca la marca de episodio. Devuelve null si el nombre no la lleva. */
export function parseEpisodeTag(name: string): EpisodeTag | null {
  const normalized = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  let best: EpisodeTag | null = null;
  for (const pattern of EPISODE_PATTERNS) {
    const match = normalized.match(pattern);
    if (!match || match.index === undefined) continue;

    const candidate: EpisodeTag = {
      season: Number(match[1]),
      episode: Number(match[2]),
      index: match.index,
      length: match[0].length,
    };
    // Gana la marca más a la derecha: el título puede llevar números
    // ("Fórmula 1"), pero la marca de episodio siempre va al final.
    if (!best || candidate.index > best.index) best = candidate;
  }
  return best;
}

/**
 * Lo que precede a la marca de episodio: título de la serie, y su año si lo
 * lleva. Se devuelve el análisis completo porque el año forma parte de la
 * identidad de la serie y se perdería al limpiar el título dos veces.
 */
export function parseSeriesHead(name: string, tag: EpisodeTag): ParsedName {
  const parsed = parseName(name.slice(0, tag.index));
  return { ...parsed, title: tidy(parsed.title) };
}

/** Título de la serie a partir del nombre completo del episodio. */
export function seriesTitleFromEpisode(name: string, tag: EpisodeTag): string {
  return parseSeriesHead(name, tag).title;
}

/**
 * Entradas que el proveedor mete en la lista y no son contenido: anuncios,
 * separadores, avisos de caducidad. Se ocultan pero no se tiran, porque a
 * veces el aviso importa (cuentas a punto de expirar).
 *
 * Se exige DOBLE señal: una palabra de aviso y otra de contexto de servicio.
 * Por separado son títulos de películas reales — "El aviso", "Tres anuncios
 * en las afueras", "Contacto sangriento" — y ocultarlas es mucho peor que
 * dejar pasar un anuncio.
 */
const JUNK_HINT =
  /\b(?:anuncios?|avisos?|atencion|importante|informacion|info|contacta|contacto|soporte|renovar|renueva|caduca|expira|vence|actualiza)\b/i;

const JUNK_CONTEXT =
  /\b(?:server|servidor|panel|linea|lineas|cuenta|suscripcion|subscripcion|lista|admin|reseller|whatsapp|telegram|https?|www)\b/i;

/** Un separador puro: barras de igual, guiones, adornos y nada más. */
const SEPARATOR = /^[^\p{L}\p{N}]+$/u;

function looksLikeProviderNotice(name: string): boolean {
  if (SEPARATOR.test(name)) return true;
  const plain = name.normalize('NFD').replace(/[̀-ͯ]/g, '');
  return JUNK_HINT.test(plain) && JUNK_CONTEXT.test(plain);
}

const SERIES_GROUP = /\b(?:tv\s*series|series?|serie|temporadas?)\b/;
const MOVIE_GROUP = /\b(?:peliculas?|movies?|cine|vod|film(?:es|s)?|estrenos?|documentales?)\b/;
const LIVE_GROUP = /\b(?:canales?|tv|directo|live|deportes?|noticias?|infantil|musica|autonomic)/;

/** Extensiones de fichero típicas de VOD. En directo no aparecen. */
const VOD_EXTENSION = /\.(?:mkv|mp4|avi|mov|m4v|flv|wmv|mpg|mpeg)(?:$|\?)/i;

export interface Classification {
  kind: Kind;
  /** Qué señal lo decidió. Se muestra en el informe del `probe`. */
  reason: string;
  /** true si ninguna señal fue concluyente y se recurrió al valor por defecto. */
  guessed: boolean;
}

export function classify(entry: RawEntry): Classification {
  const name = entry.name ?? '';
  const group = entry.attrs['group-title'] ?? '';
  const foldedGroup = fold(group);

  const path = urlPath(entry.url);

  // Antes de mirar si es un aviso, comprobar si huele a VOD. Una película
  // nunca se oculta por lo que diga su título.
  const looksLikeVod =
    VOD_EXTENSION.test(path) ||
    /\/(?:movies?|series)\//i.test(path) ||
    MOVIE_GROUP.test(foldedGroup) ||
    SERIES_GROUP.test(foldedGroup);

  if (!looksLikeVod && looksLikeProviderNotice(name)) {
    return { kind: 'junk', reason: 'aviso del proveedor o separador', guessed: false };
  }

  // 1. Ruta de la URL: la señal más limpia, y la que da un panel Xtream.
  if (/\/series\//i.test(path)) return { kind: 'series', reason: 'url /series/', guessed: false };
  if (/\/movies?\//i.test(path)) return { kind: 'movie', reason: 'url /movie/', guessed: false };
  if (/\/live\//i.test(path)) return { kind: 'live', reason: 'url /live/', guessed: false };

  // 2. group-title. Series antes que películas: "TV Series" gana a cualquier
  //    grupo que además mencione cine.
  const hasEpisodeTag = parseEpisodeTag(name) !== null;
  if (SERIES_GROUP.test(foldedGroup)) {
    return hasEpisodeTag
      ? { kind: 'series', reason: 'grupo de series + marca de episodio', guessed: false }
      : { kind: 'series', reason: 'grupo de series', guessed: false };
  }
  if (MOVIE_GROUP.test(foldedGroup)) return { kind: 'movie', reason: 'grupo de peliculas', guessed: false };

  // 3. Red de seguridad: una marca de episodio manda por encima del grupo,
  //    porque hay proveedores que cuelan series dentro de grupos genéricos.
  if (hasEpisodeTag) return { kind: 'series', reason: 'marca de episodio en el nombre', guessed: false };

  // Un fichero de vídeo nunca es una emisión en directo.
  if (VOD_EXTENSION.test(path)) return { kind: 'movie', reason: 'extension de fichero de video', guessed: false };

  if (LIVE_GROUP.test(foldedGroup)) return { kind: 'live', reason: 'grupo de directo', guessed: false };

  // Por defecto, directo: es lo que domina en estas listas y lo que menos
  // daño hace si nos equivocamos (aparece en la sección de canales).
  return { kind: 'live', reason: 'por defecto', guessed: true };
}

function urlPath(url: string): string {
  const withoutScheme = url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  const slash = withoutScheme.indexOf('/');
  return slash === -1 ? '' : withoutScheme.slice(slash);
}
