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
}

export interface XtreamEpisode {
  id: string;
  episode_num: number | string;
  title: string;
  container_extension: string;
  info?: { duration?: string; plot?: string; movie_image?: string };
}

export interface XtreamSeriesInfo {
  seasons?: unknown[];
  info?: { name?: string; cover?: string; plot?: string; releaseDate?: string };
  /** Clave = número de temporada. */
  episodes?: Record<string, XtreamEpisode[]>;
}
