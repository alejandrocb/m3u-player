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
  /**
   * Nota del panel, de 0 a 10. `null` si no la da: la mayoría la trae, pero no
   * todas —en la lista de referencia, 33 de cada 34 películas—.
   */
  rating: number | null;
  /**
   * Cuándo entró en el catálogo del proveedor, en segundos de época.
   *
   * Es el campo `added` de `player_api.php`. Sirve para ordenar por novedades,
   * que es lo que uno quiere al abrir la aplicación: ver qué han metido.
   */
  added: number | null;
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
  /**
   * Título del episodio, ya limpio de la decoración del proveedor.
   *
   * Llega como "True Detective - S01E01 - La larga y clara oscuridad" o como
   * "Outer Banks 1080P S01E01", que no es un título sino el nombre de la serie
   * otra vez. `null` cuando no queda nada después de quitar esa parte.
   */
  title: string | null;
  /** Fotograma del episodio. Medido: lo trae el 85-100 % de la ficción. */
  logo: string | null;
  /** Sinopsis del episodio. Alrededor de la mitad la traen. */
  plot: string | null;
  /** Nota del episodio, de 0 a 10, o `null`. */
  rating: number | null;
  /** Año de emisión, sacado de la fecha que da el panel. */
  year: number | null;
  /** Duración en segundos, para pintar "48 min". */
  seconds: number | null;
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
  /** Nota del panel, de 0 a 10, o `null`. */
  rating: number | null;
  /**
   * Última vez que el proveedor la tocó, en segundos de época.
   *
   * En series no hay `added`: la API da `last_modified`, que sube al añadir
   * episodios. Para "lo último que ha entrado" es incluso mejor, porque una
   * serie en emisión se mueve cada semana.
   */
  added: number | null;
  logo: string | null;
  /**
   * Identificadores de la serie en el panel Xtream, si vino por ahí.
   *
   * Hacen falta para pedir sus temporadas con `get_series_info`, que es una
   * petición por serie y por eso no se hace en la importación. Van en plural
   * porque el proveedor repite la misma serie en varias categorías.
   */
  panelIds?: number[];
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
