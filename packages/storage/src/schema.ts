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
 *
 * Esa misma propiedad es la que hace posible **compartir el historial entre
 * aparatos**: `lola-pater-2017` es la misma película en la tele y en la
 * tablet sin ponerse de acuerdo, así que sincronizar es mandar filas y no
 * traducir identificadores. Por eso las cuatro tablas llevan las tres
 * columnas de sincronización, que se explican en `SINCRONIZADAS`.
 */
export const SCHEMA_PERFILES_SQL = `
CREATE TABLE IF NOT EXISTS profile (
  id      TEXT PRIMARY KEY,
  name    TEXT NOT NULL,
  color   TEXT NOT NULL,
  created TEXT NOT NULL,
  updated TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  origin  TEXT
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
  deleted    INTEGER NOT NULL DEFAULT 0,
  origin     TEXT,
  PRIMARY KEY (profile_id, kind, item_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS progress_by_recent ON progress (profile_id, updated DESC);

CREATE TABLE IF NOT EXISTS favorite (
  profile_id TEXT NOT NULL,
  kind       TEXT NOT NULL,
  item_id    TEXT NOT NULL,
  title      TEXT NOT NULL,
  -- Cuándo se marcó, que es por donde se ordenan, y cuándo se tocó por última
  -- vez, que es lo que decide quién gana al sincronizar. No son lo mismo:
  -- desmarcar cambia el segundo y deja el primero quieto.
  created    TEXT NOT NULL,
  updated    TEXT NOT NULL,
  deleted    INTEGER NOT NULL DEFAULT 0,
  origin     TEXT,
  PRIMARY KEY (profile_id, kind, item_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS favorite_by_recent ON favorite (profile_id, created DESC);

-- Preferencias de cada perfil: cuántas carátulas por fila, cómo ordenar...
-- Clave y valor sueltos para no migrar la tabla cada vez que se añade una.
CREATE TABLE IF NOT EXISTS profile_setting (
  profile_id TEXT NOT NULL,
  key        TEXT NOT NULL,
  value      TEXT NOT NULL,
  updated    TEXT NOT NULL,
  deleted    INTEGER NOT NULL DEFAULT 0,
  origin     TEXT,
  PRIMARY KEY (profile_id, key)
) WITHOUT ROWID;

-- Cuánto usa cada perfil cada categoría, para poder subir al inicio lo que de
-- verdad ve. Se cuentan **reproducciones**: mirar una carátula no es verla.
--
-- Es del perfil, no del aparato, así que viaja como todo lo demás: lo que ves
-- en la tele ordena también el inicio de la tablet.
CREATE TABLE IF NOT EXISTS affinity (
  profile_id TEXT NOT NULL,
  clave      TEXT NOT NULL,
  veces      INTEGER NOT NULL DEFAULT 0,
  updated    TEXT NOT NULL,
  deleted    INTEGER NOT NULL DEFAULT 0,
  origin     TEXT,
  PRIMARY KEY (profile_id, clave)
) WITHOUT ROWID;

-- Dónde empieza y acaba la intro (o los créditos) de algo.
--
-- **No es de un perfil sino de la casa**: la careta de una serie es la misma
-- para todos, y marcarla una vez tiene que valer para quien la vea después, en
-- el aparato que sea. Por eso viaja con la sincronización aunque no cuelgue de
-- profile_id, que es lo único que la distingue del resto de estas tablas.
--
-- El ámbito es la clave de una temporada (doctor-who:s1) o la de un episodio
-- (doctor-who:s1e4). Con temporada basta en las series cuya careta empieza
-- siempre en el mismo minuto; las que arrancan con una escena y meten la
-- careta después la llevan en otro sitio en cada capítulo, y ahí hace falta
-- marcarlos uno a uno. Al buscar, **manda lo más concreto**.
--
-- start_s y end_s, y no start/end: END es palabra reservada de SQL, y eso ya
-- costó un rato una vez con la columna cast.
CREATE TABLE IF NOT EXISTS segment (
  ambito  TEXT NOT NULL,
  kind    TEXT NOT NULL,
  start_s REAL NOT NULL,
  end_s   REAL NOT NULL,
  updated TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  origin  TEXT,
  PRIMARY KEY (ambito, kind)
) WITHOUT ROWID;
`;

/**
 * Las tablas que viajan entre aparatos, con su clave.
 *
 * Sincronizar es "dame las filas con `updated` posterior a la última vez que
 * hablamos", así que no hace falta un registro de cambios aparte: las propias
 * tablas lo son. A cambio, **nada se borra de verdad**: un `DELETE` no deja
 * rastro que mandar, y el otro aparato volvería a subir la fila tan campante
 * —quitas una película de favoritos y al día siguiente ha vuelto—. Se marca
 * `deleted` y la fila se queda como lápida.
 *
 * `origin` es qué aparato hizo el último cambio. Sirve para desempatar cuando
 * dos coinciden al milisegundo, que es lo que garantiza que los dos lleguen a
 * la misma conclusión en vez de quedarse cada uno con lo suyo.
 */
export const SINCRONIZADAS: Array<{ tabla: string; clave: string[]; campos: string[] }> = [
  { tabla: 'profile', clave: ['id'], campos: ['name', 'color', 'avatar', 'created'] },
  { tabla: 'progress', clave: ['profile_id', 'kind', 'item_id'], campos: ['seconds', 'duration', 'title'] },
  { tabla: 'favorite', clave: ['profile_id', 'kind', 'item_id'], campos: ['title', 'created'] },
  /*
    La afinidad se sincroniza como el resto, con la misma regla: gana el cambio
    más reciente. Eso quiere decir que **no se suman las cuentas de los dos
    aparatos**, se queda la última contada. Es lo correcto aquí: cada aparato
    lleva su cuenta a partir de lo que ya sabía, así que la última es la que
    más historia tiene detrás, y confundir "sumar" con "fusionar" haría que
    ver una película en dos sitios contara doble.
  */
  { tabla: 'affinity', clave: ['profile_id', 'clave'], campos: ['veces'] },
  { tabla: 'profile_setting', clave: ['profile_id', 'key'], campos: ['value'] },
  /*
    Los segmentos son de la casa y no de un perfil: la careta de una serie es
    la misma para todos, y marcarla una vez vale para quien la vea después.
  */
  { tabla: 'segment', clave: ['ambito', 'kind'], campos: ['start_s', 'end_s'] },
];

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
  // Por aquí entra la sincronización: "lo cambiado desde tal fecha".
  'CREATE INDEX IF NOT EXISTS profile_by_updated ON profile (updated)',
  'CREATE INDEX IF NOT EXISTS progress_by_updated ON progress (updated)',
  'CREATE INDEX IF NOT EXISTS favorite_by_updated ON favorite (updated)',
  'CREATE INDEX IF NOT EXISTS setting_by_updated ON profile_setting (updated)',
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
  /*
    La ficha larga de una película. No viene con el catálogo —`get_vod_streams`
    solo da título, cartel, nota y año—: hay que pedirla con `get_vod_info`,
    que es una petición por película. Se guarda la primera vez que hace falta
    y ya no se vuelve a pedir.
  */
  { tabla: 'movie', columna: 'plot', tipo: 'TEXT' },
  /*
    `actors` y no `cast`: **CAST es palabra reservada de SQL**. La columna se
    deja crear, pero `SELECT plot, cast, backdrop` no se puede parsear y la
    consulta revienta. Costó un rato porque el error se lo tragaba el
    `try/catch` de arriba y la portada salía sin sinopsis, sin decir nada.

    En las bases donde ya se creó `cast` se queda ahí, vacía y sin usar:
    borrarla obligaría a rehacer la tabla y no molesta.
  */
  { tabla: 'movie', columna: 'actors', tipo: 'TEXT' },
  /** Imagen apaisada, la que luce en la portada. El cartel es vertical. */
  { tabla: 'movie', columna: 'backdrop', tipo: 'TEXT' },
  { tabla: 'movie', columna: 'genre', tipo: 'TEXT' },
  /** El tráiler de YouTube, que viene en la misma ficha larga. */
  { tabla: 'movie', columna: 'trailer', tipo: 'TEXT' },
  /** Marca de que ya se preguntó, aunque el panel no contestara nada. */
  { tabla: 'movie', columna: 'detalle_pedido', tipo: 'TEXT' },
  /*
    Y lo mismo para las series, que salen en la portada igual que las
    películas. Aquí la respuesta es `get_series_info`, la misma que trae los
    episodios, pero se pide aparte: la portada quiere la ficha de tres o
    cuatro series y no sus temporadas.
  */
  { tabla: 'series', columna: 'plot', tipo: 'TEXT' },
  { tabla: 'series', columna: 'actors', tipo: 'TEXT' },
  { tabla: 'series', columna: 'backdrop', tipo: 'TEXT' },
  { tabla: 'series', columna: 'genre', tipo: 'TEXT' },
  { tabla: 'series', columna: 'trailer', tipo: 'TEXT' },
  { tabla: 'series', columna: 'detalle_pedido', tipo: 'TEXT' },
  { tabla: 'episode', columna: 'rating', tipo: 'REAL' },
  { tabla: 'episode', columna: 'year', tipo: 'INTEGER' },
  { tabla: 'episode', columna: 'seconds', tipo: 'INTEGER' },
  // Sincronización. `updated` va sin NOT NULL a propósito: SQLite no admite
  // añadir una columna obligatoria sin valor por defecto, y el que tocaría
  // —la fecha de ahora— haría que todo lo viejo pareciera recién cambiado y
  // ganara la primera fusión. Se rellenan justo después, en RELLENOS_SQL.
  /*
    El retrato del perfil: el nombre de uno de los que trae la aplicación
    ("gato", "buho"…), no una imagen. Así viaja en una palabra y se pinta
    igual en los cuatro aparatos, sin subir nada a ninguna parte.
  */
  { tabla: 'profile', columna: 'avatar', tipo: 'TEXT' },
  { tabla: 'profile', columna: 'updated', tipo: 'TEXT' },
  { tabla: 'profile', columna: 'deleted', tipo: 'INTEGER NOT NULL DEFAULT 0' },
  { tabla: 'profile', columna: 'origin', tipo: 'TEXT' },
  { tabla: 'progress', columna: 'deleted', tipo: 'INTEGER NOT NULL DEFAULT 0' },
  { tabla: 'progress', columna: 'origin', tipo: 'TEXT' },
  { tabla: 'favorite', columna: 'updated', tipo: 'TEXT' },
  { tabla: 'favorite', columna: 'deleted', tipo: 'INTEGER NOT NULL DEFAULT 0' },
  { tabla: 'favorite', columna: 'origin', tipo: 'TEXT' },
  { tabla: 'profile_setting', columna: 'updated', tipo: 'TEXT' },
  { tabla: 'profile_setting', columna: 'deleted', tipo: 'INTEGER NOT NULL DEFAULT 0' },
  { tabla: 'profile_setting', columna: 'origin', tipo: 'TEXT' },
];

/**
 * Pone al día las tablas de perfil de una base que ya existía.
 *
 * Lo usan el servidor, para la base de cada casa, y los tests. El aparato
 * tiene su propio recorrido porque además migra las tablas del catálogo.
 *
 * Sin esto, añadir una columna a un perfil —el retrato, por ejemplo— tumbaba
 * la sincronización con un "no such column": quien reparte pide todas las
 * columnas de la tabla, y de un lado no existían.
 */
export function migrarTablasDePerfil(base: {
  columnas(tabla: string): string[];
  ejecutar(sql: string): void;
}): void {
  const dePerfil = new Set(SINCRONIZADAS.map(({ tabla }) => tabla));
  for (const { tabla, columna, tipo } of COLUMNAS_MIGRADAS) {
    if (!dePerfil.has(tabla)) continue;
    if (base.columnas(tabla).includes(columna)) continue;
    base.ejecutar(`ALTER TABLE ${tabla} ADD COLUMN ${columna} ${tipo}`);
  }
}

/**
 * Fecha de las filas que existían antes de que hubiera sincronización.
 *
 * Muy antigua a propósito: son datos sin fecha de cambio conocida, y lo que
 * no se puede fechar tiene que perder contra cualquier cosa que sí. Al revés
 * —sellarlas con la fecha de hoy— un aparato que estrena la actualización
 * pisaría lo que el otro llevaba días guardando.
 */
export const ANTES_DE_SINCRONIZAR = '1970-01-01T00:00:00.000Z';

/**
 * Lo que hay que rellenar después de añadir las columnas.
 *
 * Se ejecuta siempre: son idempotentes —solo tocan lo que está a NULL— y en
 * una base nueva no encuentran nada que hacer.
 */
export const RELLENOS_SQL = [
  // Estas dos sí tienen fecha propia de la que tirar, que es mejor que la de
  // relleno: si el perfil se creó en marzo, marzo es su último cambio.
  'UPDATE profile SET updated = created WHERE updated IS NULL',
  'UPDATE favorite SET updated = created WHERE updated IS NULL',
  `UPDATE profile_setting SET updated = '${ANTES_DE_SINCRONIZAR}' WHERE updated IS NULL`,
];

/**
 * Rellenos que solo valen donde hay catálogo.
 *
 * Van aparte de `RELLENOS_SQL` porque **el servidor de sincronización también
 * ejecuta aquello** sobre las bases de cada casa, y ahí solo existen las
 * tablas de perfil: un `UPDATE movie` revienta la apertura entera. Se rompió
 * así la primera vez.
 */
export const RELLENOS_CATALOGO_SQL = [
  /*
    Lo que se pidió al panel antes de que existiera la columna del género se
    marca como no preguntado, para que vuelva a pedirse una vez y la traiga.

    Solo afecta a las películas cuya ficha ya se había traído, que son las que
    han presidido el inicio: un puñado.
  */
  'UPDATE movie SET detalle_pedido = NULL WHERE detalle_pedido IS NOT NULL AND genre IS NULL',
];
