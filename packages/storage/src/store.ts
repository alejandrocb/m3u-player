/**
 * Biblioteca persistida en SQLite.
 *
 * Usa `node:sqlite`, que viene dentro de Node y de Electron recientes: sin
 * módulos nativos que compilar, sin `electron-rebuild`, sin Visual Studio.
 *
 * La lista real son 218.000 entradas y 67 MB de texto. Mantenerla en memoria
 * significa medio minuto de arranque y varios cientos de megas de RAM; en
 * SQLite el arranque es inmediato y las consultas van paginadas.
 */

import { DatabaseSync } from 'node:sqlite';

import type { Library, Variant } from '@m3u/core';
import { fold } from '@m3u/core';

import { CONTENT_TABLES, SCHEMA_SQL, SCHEMA_VERSION } from './schema.ts';

export type OwnerKind = 'channel' | 'movie' | 'episode';

export interface GroupRow {
  name: string;
  channels: number;
}

export interface ChannelRow {
  id: string;
  name: string;
  group: string;
  logo: string | null;
  tvgId: string | null;
}

export interface MovieRow {
  id: string;
  title: string;
  year: number | null;
  logo: string | null;
  tags: string[];
}

export interface SeriesRow {
  id: string;
  title: string;
  year: number | null;
  logo: string | null;
}

export interface EpisodeRow {
  id: number;
  seriesId: string;
  season: number;
  episode: number;
  title: string | null;
  logo: string | null;
}

export interface SearchHit {
  kind: 'channel' | 'movie' | 'series';
  id: string;
  title: string;
}

export interface ImportReport {
  channels: number;
  groups: number;
  movies: number;
  series: number;
  episodes: number;
  variants: number;
  /** Milisegundos que tardó la importación completa. */
  elapsedMs: number;
}

export interface PageOptions {
  limit?: number;
  offset?: number;
  /** Filtrar por categoría del proveedor. */
  group?: string;
}

export class LibraryStore {
  #db: DatabaseSync;

  private constructor(db: DatabaseSync) {
    this.#db = db;
  }

  /** Abre (o crea) la base de datos y aplica el esquema. */
  static open(path: string): LibraryStore {
    const db = new DatabaseSync(path);
    // WAL: permite leer mientras se importa, que es justo lo que hace la app
    // al refrescar la lista en segundo plano.
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA synchronous = NORMAL');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec(SCHEMA_SQL);

    const store = new LibraryStore(db);
    store.#setMeta('schema_version', String(SCHEMA_VERSION));
    return store;
  }

  close(): void {
    this.#db.close();
  }

  #setMeta(key: string, value: string): void {
    this.#db
      .prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, value);
  }

  meta(key: string): string | null {
    const row = this.#db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  /**
   * Vuelca una biblioteca entera, reemplazando la anterior.
   *
   * Todo va en una única transacción: si algo falla a mitad, la biblioteca
   * previa sigue intacta en lugar de quedarse a medias.
   */
  import(library: Library): ImportReport {
    const started = performance.now();
    const db = this.#db;

    db.exec('BEGIN IMMEDIATE');
    try {
      for (const table of CONTENT_TABLES) db.exec(`DELETE FROM ${table}`);

      const insertGroup = db.prepare('INSERT INTO channel_group (name, position) VALUES (?, ?)');
      const insertChannel = db.prepare(
        'INSERT INTO channel (id, name, sort_name, group_name, logo, tvg_id) VALUES (?, ?, ?, ?, ?, ?)',
      );
      const insertMovie = db.prepare(
        'INSERT INTO movie (id, title, sort_title, year, logo, tags) VALUES (?, ?, ?, ?, ?, ?)',
      );
      const insertSeries = db.prepare('INSERT INTO series (id, title, sort_title, year, logo) VALUES (?, ?, ?, ?, ?)');
      const insertEpisode = db.prepare(
        'INSERT INTO episode (series_id, season, episode, title, logo) VALUES (?, ?, ?, ?, ?)',
      );
      const insertItemGroup = db.prepare(
        'INSERT OR IGNORE INTO item_group (kind, item_id, group_name) VALUES (?, ?, ?)',
      );
      const insertVariant = db.prepare(
        'INSERT OR IGNORE INTO variant (owner_kind, owner_id, url, quality, rank) VALUES (?, ?, ?, ?, ?)',
      );
      const insertSearch = db.prepare('INSERT INTO search (title, kind, ref) VALUES (?, ?, ?)');

      let variants = 0;
      const saveVariants = (kind: OwnerKind, id: string, list: Variant[]): void => {
        for (const variant of list) {
          insertVariant.run(kind, id, variant.url, variant.quality, variant.rank);
          variants++;
        }
      };

      library.groups.forEach((group, index) => insertGroup.run(group.name, index));

      for (const channel of library.channels) {
        insertChannel.run(channel.id, channel.name, fold(channel.name), channel.group, channel.logo, channel.tvgId);
        insertSearch.run(channel.name, 'channel', channel.id);
        saveVariants('channel', channel.id, channel.variants);
      }

      for (const movie of library.movies) {
        insertMovie.run(movie.id, movie.title, fold(movie.title), movie.year, movie.logo, JSON.stringify(movie.tags));
        insertSearch.run(movie.title, 'movie', movie.id);
        for (const group of movie.groups) insertItemGroup.run('movie', movie.id, group);
        saveVariants('movie', movie.id, movie.variants);
      }

      let episodes = 0;
      for (const series of library.series) {
        insertSeries.run(series.id, series.title, fold(series.title), series.year, series.logo);
        insertSearch.run(series.title, 'series', series.id);
        for (const group of series.groups) insertItemGroup.run('series', series.id, group);

        for (const season of series.seasons) {
          for (const episode of season.episodes) {
            const result = insertEpisode.run(
              series.id,
              episode.season,
              episode.episode,
              episode.title,
              episode.logo,
            );
            episodes++;
            saveVariants('episode', String(result.lastInsertRowid), episode.variants);
          }
        }
      }

      this.#setMeta('imported_at', new Date().toISOString());
      this.#setMeta('entries', String(library.stats.entries));

      db.exec('COMMIT');

      return {
        channels: library.channels.length,
        groups: library.groups.length,
        movies: library.movies.length,
        series: library.series.length,
        episodes,
        variants,
        elapsedMs: Math.round(performance.now() - started),
      };
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  // ---- Consultas ----------------------------------------------------------

  /** Grupos de canales para la barra lateral, en el orden del proveedor. */
  groups(): GroupRow[] {
    const rows = this.#db
      .prepare(
        `SELECT g.name AS name, COUNT(c.id) AS channels
           FROM channel_group g
           LEFT JOIN channel c ON c.group_name = g.name
          GROUP BY g.name
          ORDER BY g.position`,
      )
      .all() as unknown as Array<Record<string, unknown>>;
    return rows.map((row) => ({ name: row['name'] as string, channels: row['channels'] as number }));
  }

  channelsInGroup(group: string): ChannelRow[] {
    const rows = this.#db
      .prepare(
        `SELECT id, name, group_name, logo, tvg_id
           FROM channel WHERE group_name = ? ORDER BY sort_name`,
      )
      .all(group) as unknown as Array<Record<string, unknown>>;
    return rows.map(toChannel);
  }

  movies(options: PageOptions = {}): MovieRow[] {
    const { limit = 100, offset = 0, group } = options;
    const rows = group
      ? (this.#db
          .prepare(
            `SELECT m.id, m.title, m.year, m.logo, m.tags
               FROM movie m
               JOIN item_group g ON g.kind = 'movie' AND g.item_id = m.id
              WHERE g.group_name = ?
              ORDER BY m.sort_title LIMIT ? OFFSET ?`,
          )
          .all(group, limit, offset) as unknown as Array<Record<string, unknown>>)
      : (this.#db
          .prepare('SELECT id, title, year, logo, tags FROM movie ORDER BY sort_title LIMIT ? OFFSET ?')
          .all(limit, offset) as unknown as Array<Record<string, unknown>>);
    return rows.map(toMovie);
  }

  series(options: PageOptions = {}): SeriesRow[] {
    const { limit = 100, offset = 0, group } = options;
    const rows = group
      ? (this.#db
          .prepare(
            `SELECT s.id, s.title, s.year, s.logo
               FROM series s
               JOIN item_group g ON g.kind = 'series' AND g.item_id = s.id
              WHERE g.group_name = ?
              ORDER BY s.sort_title LIMIT ? OFFSET ?`,
          )
          .all(group, limit, offset) as unknown as Array<Record<string, unknown>>)
      : (this.#db
          .prepare('SELECT id, title, year, logo FROM series ORDER BY sort_title LIMIT ? OFFSET ?')
          .all(limit, offset) as unknown as Array<Record<string, unknown>>);
    return rows.map(toSeries);
  }

  /** Números de temporada de una serie, con cuántos episodios tiene cada una. */
  seasons(seriesId: string): Array<{ season: number; episodes: number }> {
    const rows = this.#db
      .prepare(
        `SELECT season, COUNT(*) AS episodes
           FROM episode WHERE series_id = ? GROUP BY season ORDER BY season`,
      )
      .all(seriesId) as unknown as Array<Record<string, unknown>>;
    return rows.map((row) => ({ season: row['season'] as number, episodes: row['episodes'] as number }));
  }

  episodes(seriesId: string, season: number): EpisodeRow[] {
    const rows = this.#db
      .prepare(
        `SELECT id, series_id, season, episode, title, logo
           FROM episode WHERE series_id = ? AND season = ? ORDER BY episode`,
      )
      .all(seriesId, season) as unknown as Array<Record<string, unknown>>;
    return rows.map(toEpisode);
  }

  /** Variantes de calidad, de mejor a peor. La primera es la que se reproduce. */
  variants(kind: OwnerKind, id: string): Variant[] {
    const rows = this.#db
      .prepare('SELECT url, quality, rank FROM variant WHERE owner_kind = ? AND owner_id = ? ORDER BY rank DESC')
      .all(kind, id) as unknown as Array<{ url: string; quality: string | null; rank: number }>;
    return rows.map((row) => ({ url: row.url, quality: row.quality, rank: row.rank, raw: '' }));
  }

  /** Búsqueda global sobre canales, películas y series a la vez. */
  search(text: string, limit = 50): SearchHit[] {
    const query = toMatchQuery(text);
    if (!query) return [];

    const rows = this.#db
      .prepare(
        `SELECT title, kind, ref FROM search WHERE search MATCH ? ORDER BY rank LIMIT ?`,
      )
      .all(query, limit) as unknown as Array<{ title: string; kind: string; ref: string }>;

    return rows.map((row) => ({ kind: row.kind as SearchHit['kind'], id: row.ref, title: row.title }));
  }

  counts(): { channels: number; movies: number; series: number; episodes: number } {
    const one = (sql: string): number => (this.#db.prepare(sql).get() as { n: number }).n;
    return {
      channels: one('SELECT COUNT(*) AS n FROM channel'),
      movies: one('SELECT COUNT(*) AS n FROM movie'),
      series: one('SELECT COUNT(*) AS n FROM series'),
      episodes: one('SELECT COUNT(*) AS n FROM episode'),
    };
  }
}

/**
 * Convierte lo que escribe el usuario en una consulta FTS5 segura.
 *
 * Sin esto, un apóstrofo o un guion sueltos hacen que FTS5 lance un error de
 * sintaxis en mitad de la búsqueda. Cada palabra se entrecomilla y la última
 * lleva `*` para que la búsqueda vaya encontrando según se teclea.
 */
export function toMatchQuery(text: string): string | null {
  const words = fold(text).split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  return words.map((word, index) => (index === words.length - 1 ? `"${word}"*` : `"${word}"`)).join(' ');
}

function toChannel(row: Record<string, unknown>): ChannelRow {
  return {
    id: row['id'] as string,
    name: row['name'] as string,
    group: row['group_name'] as string,
    logo: (row['logo'] as string | null) ?? null,
    tvgId: (row['tvg_id'] as string | null) ?? null,
  };
}

function toMovie(row: Record<string, unknown>): MovieRow {
  return {
    id: row['id'] as string,
    title: row['title'] as string,
    year: (row['year'] as number | null) ?? null,
    logo: (row['logo'] as string | null) ?? null,
    tags: JSON.parse((row['tags'] as string) || '[]') as string[],
  };
}

function toSeries(row: Record<string, unknown>): SeriesRow {
  return {
    id: row['id'] as string,
    title: row['title'] as string,
    year: (row['year'] as number | null) ?? null,
    logo: (row['logo'] as string | null) ?? null,
  };
}

function toEpisode(row: Record<string, unknown>): EpisodeRow {
  return {
    id: row['id'] as number,
    seriesId: row['series_id'] as string,
    season: row['season'] as number,
    episode: row['episode'] as number,
    title: (row['title'] as string | null) ?? null,
    logo: (row['logo'] as string | null) ?? null,
  };
}
