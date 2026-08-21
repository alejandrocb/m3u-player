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
  -- Nota del panel, de 0 a 10. NULL es "sin valorar", que no es lo mismo que
  -- un cero: ordenando por nota, lo no valorado va al final, no delante.
  rating     REAL,
  -- Cuándo lo metió el proveedor, en segundos de época: el campo added de
  -- la API. Es lo que permite ordenar por novedades.
  added      INTEGER,
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
  rating     REAL,
  -- En series el panel no da added sino last_modified, que sube al añadir
  -- episodios: para "lo último que ha entrado" viene incluso mejor.
  added      INTEGER,
  logo       TEXT
);

CREATE INDEX IF NOT EXISTS series_by_title ON series (sort_title);

-- El episodio guarda su ficha entera porque la pantalla de una serie los
-- enseña en lista con fotograma, sinopsis y nota, no como una simple
-- numeración. Todo esto llega en la misma respuesta de get_series_info, así
-- que no guardarlo obligaría a volver a pedirla.
CREATE TABLE IF NOT EXISTS episode (
  id        INTEGER PRIMARY KEY,
  series_id TEXT NOT NULL,
  season    INTEGER NOT NULL,
  episode   INTEGER NOT NULL,
  title     TEXT,
  logo      TEXT,
  plot      TEXT,
  rating    REAL,
  year      INTEGER,
  seconds   INTEGER,
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

`;

/**
 * Búsqueda global, aparte del resto del esquema.
 *
 * FTS5 es opcional en SQLite y no viene en todas las compilaciones: la de Node
 * lo trae, pero la de un móvil puede no hacerlo. Se crea por separado para que
 * su ausencia no impida abrir la biblioteca —se busca peor, pero se busca—.
 *
 * `unicode61` con `remove_diacritics=2` hace que "senor" encuentre "El señor
 * de los cielos".
 */
export const SCHEMA_FTS_SQL = `
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

/**
 * Perfiles, historial y favoritos.
 *
 * Va aparte del catálogo por una razón concreta: **esto no se borra al
 * reimportar**. `CONTENT_TABLES` se vacía en cada refresco de la lista, y el
 * "seguir viendo" de cada uno no puede irse por delante porque el proveedor
 * haya cambiado tres películas de sitio.
 *
 * Las claves apuntan al contenido (`movie:lola-pater-2017`), no a números de
 * fila, para que el progreso sobreviva a las reimportaciones.
 */
export const SCHEMA_PERFILES_SQL = `
CREATE TABLE IF NOT EXISTS profile (
  id      TEXT PRIMARY KEY,
  name    TEXT NOT NULL,
  color   TEXT NOT NULL,
  created TEXT NOT NULL
);

-- Dónde se quedó cada perfil en cada cosa que ha visto.
CREATE TABLE IF NOT EXISTS progress (
  profile_id TEXT NOT NULL,
  kind       TEXT NOT NULL,
  item_id    TEXT NOT NULL,
  -- Segundo por el que iba y duración total, para pintar la barra de avance.
  seconds    REAL NOT NULL,
  duration   REAL NOT NULL,
  title      TEXT NOT NULL,
  updated    TEXT NOT NULL,
  PRIMARY KEY (profile_id, kind, item_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS progress_by_recent ON progress (profile_id, updated DESC);

CREATE TABLE IF NOT EXISTS favorite (
  profile_id TEXT NOT NULL,
  kind       TEXT NOT NULL,
  item_id    TEXT NOT NULL,
  title      TEXT NOT NULL,
  created    TEXT NOT NULL,
  PRIMARY KEY (profile_id, kind, item_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS favorite_by_recent ON favorite (profile_id, created DESC);

-- Preferencias de cada perfil: cuántas carátulas por fila, cómo ordenar...
-- Clave y valor sueltos para no migrar la tabla cada vez que se añade una.
CREATE TABLE IF NOT EXISTS profile_setting (
  profile_id TEXT NOT NULL,
  key        TEXT NOT NULL,
  value      TEXT NOT NULL,
  PRIMARY KEY (profile_id, key)
) WITHOUT ROWID;
`;

/**
 * Índices que dependen de columnas añadidas después.
 *
 * **Van después de las migraciones, no en el esquema base.** En una base
 * creada antes, la columna todavía no existe cuando se ejecuta `SCHEMA_SQL`, y
 * crear un índice sobre ella falla con "no such column" —cortando la apertura
 * entera de la base, que es justo lo que pasó—.
 */
export const INDICES_TRAS_MIGRAR_SQL = [
  'CREATE INDEX IF NOT EXISTS movie_by_rating ON movie (rating DESC, sort_title)',
  'CREATE INDEX IF NOT EXISTS series_by_rating ON series (rating DESC, sort_title)',
  'CREATE INDEX IF NOT EXISTS movie_by_added ON movie (added DESC, sort_title)',
  'CREATE INDEX IF NOT EXISTS series_by_added ON series (added DESC, sort_title)',
];

/**
 * Columnas añadidas después de la primera versión del esquema.
 *
 * Se aplican con `ALTER TABLE ... ADD COLUMN` sobre bases ya creadas, mirando
 * antes `PRAGMA table_info`: intentarlo a ciegas y tragarse el error esconde
 * fallos de verdad, que es como se coló el "no such column: rating".
 */
export const COLUMNAS_MIGRADAS: Array<{ tabla: string; columna: string; tipo: string }> = [
  { tabla: 'movie', columna: 'rating', tipo: 'REAL' },
  { tabla: 'series', columna: 'rating', tipo: 'REAL' },
  { tabla: 'movie', columna: 'added', tipo: 'INTEGER' },
  { tabla: 'series', columna: 'added', tipo: 'INTEGER' },
  { tabla: 'episode', columna: 'plot', tipo: 'TEXT' },
  { tabla: 'episode', columna: 'rating', tipo: 'REAL' },
  { tabla: 'episode', columna: 'year', tipo: 'INTEGER' },
  { tabla: 'episode', columna: 'seconds', tipo: 'INTEGER' },
];
