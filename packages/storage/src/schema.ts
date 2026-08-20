/**
 * Esquema de la biblioteca.
 *
 * Decisiones que conviene entender antes de tocarlo:
 *
 * - **Una sola tabla de variantes** para canales, películas y episodios. Las
 *   tres tienen exactamente el mismo problema (el proveedor manda una entrada
 *   por calidad) y así hay un único camino de código para resolverlo.
 *
 * - **Claves de texto, no autonuméricas.** Los identificadores vienen del
 *   contenido (tvg-id, título+año), de forma que una reimportación reconoce lo
 *   que ya existía y los favoritos y el "seguir viendo" sobreviven.
 *
 * - **`sort_*` precalculado**, sin acentos y en minúsculas. Ordenar 18.000
 *   películas con localeCompare en cada consulta es tirar tiempo.
 */

export const SCHEMA_VERSION = 1;

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS channel_group (
  name     TEXT PRIMARY KEY,
  position INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS channel (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  sort_name  TEXT NOT NULL,
  group_name TEXT NOT NULL,
  logo       TEXT,
  tvg_id     TEXT
);
CREATE INDEX IF NOT EXISTS channel_by_group ON channel (group_name, sort_name);
CREATE INDEX IF NOT EXISTS channel_by_tvg ON channel (tvg_id);

CREATE TABLE IF NOT EXISTS movie (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  sort_title TEXT NOT NULL,
  year       INTEGER,
  logo       TEXT,
  tags       TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS movie_by_title ON movie (sort_title);
CREATE INDEX IF NOT EXISTS movie_by_year ON movie (year DESC, sort_title);

CREATE TABLE IF NOT EXISTS series (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  sort_title TEXT NOT NULL,
  year       INTEGER,
  logo       TEXT
);
CREATE INDEX IF NOT EXISTS series_by_title ON series (sort_title);

CREATE TABLE IF NOT EXISTS episode (
  id        INTEGER PRIMARY KEY,
  series_id TEXT NOT NULL,
  season    INTEGER NOT NULL,
  episode   INTEGER NOT NULL,
  title     TEXT,
  logo      TEXT,
  UNIQUE (series_id, season, episode)
);
CREATE INDEX IF NOT EXISTS episode_by_series ON episode (series_id, season, episode);

-- Pertenencia a categorías del proveedor. Una película o serie puede estar en
-- varias a la vez, así que no vale una columna en la tabla principal.
CREATE TABLE IF NOT EXISTS item_group (
  kind       TEXT NOT NULL,
  item_id    TEXT NOT NULL,
  group_name TEXT NOT NULL,
  PRIMARY KEY (kind, item_id, group_name)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS item_group_by_group ON item_group (kind, group_name);

CREATE TABLE IF NOT EXISTS variant (
  owner_kind TEXT NOT NULL,
  owner_id   TEXT NOT NULL,
  url        TEXT NOT NULL,
  quality    TEXT,
  rank       INTEGER NOT NULL,
  PRIMARY KEY (owner_kind, owner_id, url)
) WITHOUT ROWID;

-- Búsqueda global. unicode61 con remove_diacritics=2 hace que "senor"
-- encuentre "El señor de los cielos".
CREATE VIRTUAL TABLE IF NOT EXISTS search USING fts5 (
  title,
  kind UNINDEXED,
  ref  UNINDEXED,
  tokenize = 'unicode61 remove_diacritics 2'
);
`;

/** Tablas que se vacían en cada reimportación, en orden seguro. */
export const CONTENT_TABLES = [
  'search',
  'variant',
  'item_group',
  'episode',
  'series',
  'movie',
  'channel',
  'channel_group',
] as const;
