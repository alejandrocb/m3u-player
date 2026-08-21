/**
 * Cliente de Xtream Codes.
 *
 * Se intenta SIEMPRE antes que el parseo del M3U: el panel devuelve el
 * contenido ya clasificado y con temporadas y episodios estructurados, así
 * que ahorra toda la adivinación por nombres. Muchos revendedores capan
 * `player_api.php`, de ahí que todo esto sea opcional y con fallback.
 */

import type {
  XtreamCategory,
  XtreamCredentials,
  XtreamLiveStream,
  XtreamSeries,
  XtreamSeriesInfo,
  XtreamServerInfo,
  XtreamShortEpg,
  XtreamUserInfo,
  XtreamVodStream,
} from './types.ts';

/** Formato de salida del directo. Algunos paneles solo van bien con uno. */
export type LiveOutput = 'ts' | 'm3u8';

/**
 * Extrae credenciales de la URL que reparten los proveedores:
 *   http://servidor:8080/get.php?username=U&password=P&type=m3u_plus&output=m3u8
 *
 * Acepta también una URL de player_api.php o el origen a pelo con user/pass.
 */
export function credentialsFromUrl(raw: string): XtreamCredentials | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  const username = url.searchParams.get('username');
  const password = url.searchParams.get('password');
  if (!username || !password) return null;

  return { base: url.origin, username, password };
}

export class XtreamError extends Error {
  readonly status: number | undefined;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'XtreamError';
    this.status = status;
  }
}

export interface XtreamClientOptions {
  /** Inyectable para poder testear sin red y para usar el proxy de Electron. */
  fetch?: typeof globalThis.fetch;
  /** Milisegundos antes de abandonar una petición. */
  timeoutMs?: number;
  /** Algunos paneles rechazan peticiones sin User-Agent de reproductor. */
  userAgent?: string;
}

export class XtreamClient {
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly timeoutMs: number;
  private readonly userAgent: string;

  private readonly creds: XtreamCredentials;

  constructor(creds: XtreamCredentials, options: XtreamClientOptions = {}) {
    this.creds = creds;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.userAgent = options.userAgent ?? 'VLC/3.0.20 LibVLC/3.0.20';
  }

  private apiUrl(action?: string, params: Record<string, string | number> = {}): string {
    const url = new URL('/player_api.php', this.creds.base);
    url.searchParams.set('username', this.creds.username);
    url.searchParams.set('password', this.creds.password);
    if (action) url.searchParams.set('action', action);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    return url.toString();
  }

  private async request<T>(action?: string, params: Record<string, string | number> = {}): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(this.apiUrl(action, params), {
        signal: controller.signal,
        headers: { 'User-Agent': this.userAgent, Accept: 'application/json,*/*' },
      });
      if (!response.ok) throw new XtreamError(`HTTP ${response.status} en ${action ?? 'handshake'}`, response.status);

      const text = await response.text();
      // Un panel con la API capada suele devolver HTML o una cadena vacía
      // con estado 200, así que no basta con mirar response.ok.
      if (!text.trim()) throw new XtreamError(`respuesta vacía en ${action ?? 'handshake'}`);
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new XtreamError(`respuesta no JSON en ${action ?? 'handshake'}: ${text.slice(0, 80)}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  /** Handshake. Si esto falla, hay que tirar de M3U. */
  async info(): Promise<{ user_info: XtreamUserInfo; server_info: XtreamServerInfo }> {
    const data = await this.request<{ user_info?: XtreamUserInfo; server_info?: XtreamServerInfo }>();
    if (!data.user_info) throw new XtreamError('el panel no devolvió user_info');
    if (data.user_info.status && data.user_info.status.toLowerCase() !== 'active') {
      throw new XtreamError(`cuenta en estado "${data.user_info.status}"`);
    }
    return { user_info: data.user_info, server_info: data.server_info ?? ({} as XtreamServerInfo) };
  }

  liveCategories = () => this.request<XtreamCategory[]>('get_live_categories');
  vodCategories = () => this.request<XtreamCategory[]>('get_vod_categories');
  seriesCategories = () => this.request<XtreamCategory[]>('get_series_categories');

  liveStreams = (categoryId?: string) =>
    this.request<XtreamLiveStream[]>('get_live_streams', categoryId ? { category_id: categoryId } : {});
  vodStreams = (categoryId?: string) =>
    this.request<XtreamVodStream[]>('get_vod_streams', categoryId ? { category_id: categoryId } : {});
  series = (categoryId?: string) =>
    this.request<XtreamSeries[]>('get_series', categoryId ? { category_id: categoryId } : {});

  seriesInfo = (seriesId: number | string) => this.request<XtreamSeriesInfo>('get_series_info', { series_id: seriesId });

  /**
   * Programación de un canal: lo que echan ahora y lo que viene detrás.
   *
   * Se pide por canal y no de una vez porque el EPG entero es enorme: medido
   * contra el panel real, `get_short_epg` son 3,4 KB por canal y
   * `get_simple_data_table` 186 KB —314 programas, una semana— para el mismo
   * canal. Con la lista delante y el foco moviéndose, solo vale el primero.
   */
  shortEpg = (streamId: number | string, limit = 8) =>
    this.request<XtreamShortEpg>('get_short_epg', { stream_id: streamId, limit });

  /** URL del EPG completo en XMLTV. */
  epgUrl(): string {
    const url = new URL('/xmltv.php', this.creds.base);
    url.searchParams.set('username', this.creds.username);
    url.searchParams.set('password', this.creds.password);
    return url.toString();
  }

  streamUrl(kind: 'live' | 'movie' | 'series', id: number | string, extension = 'ts'): string {
    const { base, username, password } = this.creds;
    return `${base}/${kind}/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${id}.${extension}`;
  }

  liveUrl(streamId: number | string, output: LiveOutput = 'ts'): string {
    return this.streamUrl('live', streamId, output);
  }
}
