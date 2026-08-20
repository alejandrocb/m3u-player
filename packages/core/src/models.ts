/**
 * Modelo de dominio compartido por todas las plataformas.
 *
 * Nada de este fichero puede importar Node, Electron ni APIs de navegador:
 * `packages/core` tiene que poder ejecutarse tal cual en React Native.
 */

/** Clasificación de una entrada de la lista. */
export type Kind = 'live' | 'movie' | 'series' | 'junk';

/** Entrada cruda tal y como venía en el M3U, antes de interpretarla. */
export interface RawEntry {
  /** Texto que va detrás de la coma en el #EXTINF. */
  name: string;
  url: string;
  /** Todos los atributos tvg-*, group-title, etc. tal cual. */
  attrs: Record<string, string>;
  /** Línea original, útil para depurar listas raras. */
  line: number;
}

/**
 * Un mismo contenido servido a distinta calidad.
 *
 * El proveedor manda cada calidad como una entrada independiente — "24 Horas
 * FHD" y "24 Horas SD", o "El aviso (2018) 1080p" y "El aviso (2018) 720p" —
 * y sin fusionarlas la biblioteca sale llena de duplicados.
 */
export interface Variant {
  /** FHD, HD, SD, 1080p... o null si el nombre no lo dice. */
  quality: string | null;
  /** Peso para ordenar de mejor a peor. Mayor es mejor. */
  rank: number;
  url: string;
  /** Nombre original sin tocar, por si hay que enseñarlo. */
  raw: string;
}

export interface Channel {
  /** tvg-id si venía, si no un slug del nombre limpio. */
  id: string;
  /** Nombre sin el sufijo de calidad: "24 Horas". */
  name: string;
  /** Grupo ya limpio de decoración: "NOTICIAS". */
  group: string;
  logo: string | null;
  /** tvg-id original, o null. Necesario para casar el EPG. */
  tvgId: string | null;
  /** Ordenadas de mejor a peor calidad. Nunca vacío. */
  variants: Variant[];
}

export interface Movie {
  id: string;
  /** Título limpio, sin calidad, códec ni año. */
  title: string;
  year: number | null;
  /** Un mismo título puede estar en varias categorías del proveedor. */
  groups: string[];
  logo: string | null;
  /** Etiquetas sueltas encontradas en el nombre: x264, DUAL, VOSE... */
  tags: string[];
  variants: Variant[];
}

export interface Episode {
  season: number;
  episode: number;
  /** Título del episodio si el proveedor lo da aparte. Casi nunca. */
  title: string | null;
  logo: string | null;
  groups: string[];
  variants: Variant[];
}

export interface Season {
  number: number;
  episodes: Episode[];
}

export interface Series {
  id: string;
  title: string;
  year: number | null;
  logo: string | null;
  /**
   * Una misma serie puede aparecer en varios grupos del proveedor
   * ("TV Series NETFLIX" y "TV Series OTROS"), así que se guardan todos.
   */
  groups: string[];
  seasons: Season[];
}

/** Grupo de canales en directo, la jerarquía que se ve en la barra lateral. */
export interface ChannelGroup {
  name: string;
  channelIds: string[];
}

export interface Library {
  channels: Channel[];
  groups: ChannelGroup[];
  movies: Movie[];
  series: Series[];
  /** Entradas descartadas (anuncios del servidor, separadores). Se ocultan, no se borran. */
  junk: RawEntry[];
  /**
   * Entradas que no se pudieron clasificar con confianza. Se conservan para
   * poder revisarlas: son la lista de tareas para afinar el clasificador.
   */
  unclassified: RawEntry[];
  stats: LibraryStats;
}

export interface LibraryStats {
  entries: number;
  channels: number;
  /** Entradas de directo antes de fusionar variantes de calidad. */
  channelEntries: number;
  groups: number;
  movies: number;
  /** Entradas de película antes de fusionar variantes de calidad. */
  movieEntries: number;
  series: number;
  episodes: number;
  /** Entradas de episodio antes de fusionar variantes de calidad. */
  episodeEntries: number;
  junk: number;
  /** Entradas que no se pudieron clasificar con confianza. */
  unknown: number;
}
