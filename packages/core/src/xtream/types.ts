/** Respuestas de player_api.php. Los paneles mandan números como cadenas casi siempre. */

export interface XtreamCredentials {
  /** Origen sin barra final: http://servidor:8080 */
  base: string;
  username: string;
  password: string;
}

export interface XtreamUserInfo {
  username: string;
  status: string;
  /** Epoch en segundos, como cadena. null en cuentas sin caducidad. */
  exp_date: string | null;
  is_trial: string;
  active_cons: string;
  /** Conexiones simultáneas permitidas. Manda en la cola de descargas. */
  max_connections: string;
  allowed_output_formats?: string[];
}

export interface XtreamServerInfo {
  url: string;
  port: string;
  https_port?: string;
  server_protocol?: string;
  timezone?: string;
}

export interface XtreamCategory {
  category_id: string;
  category_name: string;
  parent_id?: number;
}

export interface XtreamLiveStream {
  stream_id: number;
  name: string;
  stream_icon?: string;
  epg_channel_id?: string | null;
  category_id?: string;
  tv_archive?: number;
  tv_archive_duration?: number;
}

export interface XtreamVodStream {
  stream_id: number;
  name: string;
  stream_icon?: string;
  /** Extensión real del fichero: mkv, mp4... Hace falta para montar la URL. */
  container_extension?: string;
  category_id?: string;
  rating?: string;
  year?: string;
  /** Cuándo entró en el catálogo, en segundos de época y como cadena. */
  added?: string;
}

export interface XtreamSeries {
  series_id: number;
  name: string;
  cover?: string;
  plot?: string;
  genre?: string;
  releaseDate?: string;
  category_id?: string;
  rating?: string;
  /** En series no hay `added`: esto sube cada vez que le añaden episodios. */
  last_modified?: string;
}

export interface XtreamEpisode {
  id: string;
  episode_num: number | string;
  title: string;
  container_extension: string;
  season?: number | string;
  added?: string;
  info?: {
    duration?: string;
    /** Segundos, pero llega a 0 en bastantes episodios: hay que mirar `duration`. */
    duration_secs?: number | string;
    plot?: string;
    movie_image?: string;
    rating?: number | string;
    releaseDate?: string;
  };
}

export interface XtreamSeriesInfo {
  seasons?: unknown[];
  info?: { name?: string; cover?: string; plot?: string; releaseDate?: string };
  /** Clave = número de temporada. */
  episodes?: Record<string, XtreamEpisode[]>;
}

/**
 * Un programa del EPG, tal y como lo manda `get_short_epg`.
 *
 * `title` y `description` vienen en base64, y los tiempos **en UTC**: tanto
 * los sellos como las cadenas `start` y `end`, que parecen hora local y no lo
 * son. Fiarse de ellas pinta la programación con dos horas de desfase en
 * España.
 */
export interface XtreamEpgListing {
  id: string;
  epg_id: string;
  title: string;
  lang?: string;
  /** "2026-08-21 08:35:00", en UTC pese a las apariencias. */
  start: string;
  end: string;
  description: string;
  channel_id: string;
  /** Epoch en segundos, como cadena. Es lo que hay que usar. */
  start_timestamp: string;
  stop_timestamp: string;
  /** 1 en el que está emitiéndose ahora, según el reloj del servidor. */
  now_playing?: number;
  has_archive?: number;
}

export interface XtreamShortEpg {
  epg_listings?: XtreamEpgListing[];
}

/**
 * Lo que devuelve `get_vod_info` de una película.
 *
 * Todo opcional porque cada panel rellena lo que quiere: hay listas donde la
 * sinopsis viene siempre y otras donde no viene nunca. La interfaz omite lo
 * que falte en vez de dejar huecos.
 */
export interface XtreamVodInfo {
  info?: {
    plot?: string;
    cast?: string;
    director?: string;
    genre?: string;
    releasedate?: string;
    release_date?: string;
    rating?: string | number;
    /** La nota ya sobre cinco, si el panel la da. */
    rating_5based?: string | number;
    duration?: string;
    duration_secs?: number;
    /** Imagen apaisada, en una lista de una sola entrada. */
    backdrop_path?: string[];
    movie_image?: string;
    youtube_trailer?: string;
  };
  movie_data?: {
    stream_id?: number;
    name?: string;
    container_extension?: string;
  };
}
