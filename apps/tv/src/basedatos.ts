/**
 * La biblioteca guardada en el aparato.
 *
 * Es el mismo esquema que usa el escritorio —se importa de `@m3u/storage`—,
 * sobre el SQLite de Android en vez de sobre `node:sqlite`. Así el catálogo se
 * importa del panel una vez cada varios días y los arranques siguientes son
 * inmediatos, en lugar de esperar el minuto que tarda la API.
 *
 * Implementa el puerto `Biblioteca`, así que la interfaz no nota de dónde
 * salen los datos.
 */

import { open } from '@op-engineering/op-sqlite';
import type { DB } from '@op-engineering/op-sqlite';

import type { Library } from '@m3u/core';
import { fold } from '@m3u/core';
import {
  COLUMNAS_MIGRADAS,
  CONTENT_TABLES,
  INDICES_TRAS_MIGRAR_SQL,
  RELLENOS_SQL,
  SCHEMA_FTS_SQL,
  SCHEMA_PERFILES_SQL,
  SCHEMA_SQL,
} from '@m3u/storage/schema';
import type { Biblioteca, Pagina, Variante } from '@m3u/ui';

const FICHERO = 'biblioteca.sqlite';

export interface Guardada {
  biblioteca: Biblioteca;
  /** Cuándo se importó, en ISO. */
  importada: string;
  cuentaId: string;
  totales: { canales: number; peliculas: number; series: number };
}

/** Abre la base, creando el esquema si hace falta. */
export function abrirBase(): { db: DB; conBusquedaRapida: boolean } {
  console.log('[base] abriendo');
  const db = open({ name: FICHERO });
  db.executeSync(SCHEMA_SQL);

  let conBusquedaRapida = true;
  try {
    db.executeSync(SCHEMA_FTS_SQL);
  } catch (error) {
    // Sin FTS5 se busca con LIKE: peor, pero la app abre igual.
    console.warn('[base] sin FTS5, la búsqueda irá por LIKE', error);
    conBusquedaRapida = false;
  }
  db.executeSync(
    'CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
  );
  // Perfiles, historial y favoritos: aparte del catálogo y a salvo de los
  // refrescos, que vacían las tablas de contenido.
  db.executeSync(SCHEMA_PERFILES_SQL);

  // Columnas añadidas después de la primera versión: en una base ya creada no
  // las pone `CREATE TABLE IF NOT EXISTS`. La lista está en el esquema, que es
  // lo único que comparten esta base y la del escritorio.
  for (const { tabla, columna, tipo } of COLUMNAS_MIGRADAS) asegurarColumna(db, tabla, columna, tipo);

  // Estos índices necesitan las columnas de arriba: por eso van los últimos.
  for (const indice of INDICES_TRAS_MIGRAR_SQL) db.executeSync(indice);

  // Y las filas de antes de que existiera la sincronización necesitan fecha.
  for (const relleno of RELLENOS_SQL) db.executeSync(relleno);

  return { db, conBusquedaRapida };
}

/**
 * Añade una columna si no está, mirando primero qué hay.
 *
 * SQLite no tiene `ADD COLUMN IF NOT EXISTS`, y envolver el `ALTER` en un
 * `try/catch` mudo esconde los fallos de verdad: si algo va mal, la columna no
 * aparece y lo que se ve después es un "no such column" a destiempo.
 */
function asegurarColumna(db: DB, tabla: string, columna: string, tipo: string): void {
  const respuesta = db.executeSync(`PRAGMA table_info(${tabla})`);
  const existentes = (respuesta.rows ?? []) as Array<{ name?: string }>;
  console.log(
    `[base] ${tabla}: ${existentes.length} columnas -> ${existentes.map((f) => f.name).join(', ')}`,
  );

  if (existentes.some((fila) => fila.name === columna)) return;

  db.executeSync(`ALTER TABLE ${tabla} ADD COLUMN ${columna} ${tipo}`);
  console.log(`[base] columna añadida: ${tabla}.${columna}`);
}

function meta(db: DB, clave: string): string | null {
  const filas = db.executeSync('SELECT value FROM meta WHERE key = ?', [clave]).rows ?? [];
  const valor = (filas[0] as { value?: string } | undefined)?.value;
  return valor ?? null;
}

function ponerMeta(db: DB, clave: string, valor: string): void {
  db.executeSync(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [clave, valor],
  );
}

/** ¿Hay catálogo guardado de esta cuenta, y desde cuándo? */
export function estadoGuardado(db: DB, cuentaId: string): { importada: string; dias: number } | null {
  if (meta(db, 'cuenta') !== cuentaId) return null;
  const importada = meta(db, 'importada');
  if (!importada) return null;

  const dias = (Date.now() - Date.parse(importada)) / 86_400_000;
  return { importada, dias: Number.isFinite(dias) ? dias : 0 };
}

/**
 * Vuelca el catálogo entero, reemplazando el anterior.
 *
 * Todo en una transacción: si algo falla a mitad, se queda el de antes en vez
 * de una biblioteca a medias.
 */
export function guardarCatalogo(
  db: DB,
  library: Library,
  cuentaId: string,
  conBusquedaRapida = true,
): void {
  const indexar = (titulo: string, clase: string, ref: string): void => {
    if (!conBusquedaRapida) return;
    db.executeSync('INSERT INTO search (title, kind, ref) VALUES (?, ?, ?)', [titulo, clase, ref]);
  };

  db.executeSync('BEGIN IMMEDIATE');
  try {
    for (const tabla of CONTENT_TABLES) {
      try {
        db.executeSync(`DELETE FROM ${tabla}`);
      } catch {
        // `search` no existe si no hubo FTS5.
      }
    }

    library.groups.forEach((grupo, indice) =>
      db.executeSync('INSERT INTO channel_group (name, position) VALUES (?, ?)', [grupo.name, indice]),
    );

    for (const canal of library.channels) {
      db.executeSync(
        'INSERT INTO channel (id, name, sort_name, group_name, logo, tvg_id) VALUES (?, ?, ?, ?, ?, ?)',
        [canal.id, canal.name, fold(canal.name), canal.group, canal.logo, canal.tvgId],
      );
      indexar(canal.name, 'channel', canal.id);
      guardarVariantes(db, 'channel', canal.id, canal.variants);
    }

    for (const pelicula of library.movies) {
      db.executeSync(
        `INSERT INTO movie (id, title, sort_title, year, rating, added, logo, tags)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          pelicula.id,
          pelicula.title,
          fold(pelicula.title),
          pelicula.year,
          pelicula.rating,
          pelicula.added,
          pelicula.logo,
          JSON.stringify(pelicula.tags),
        ],
      );
      for (const grupo of pelicula.groups) {
        db.executeSync('INSERT OR IGNORE INTO item_group (kind, item_id, group_name) VALUES (?, ?, ?)', [
          'movie',
          pelicula.id,
          grupo,
        ]);
      }
      indexar(pelicula.title, 'movie', pelicula.id);
      guardarVariantes(db, 'movie', pelicula.id, pelicula.variants);
    }

    for (const serie of library.series) {
      db.executeSync(
        `INSERT INTO series (id, title, sort_title, year, rating, added, logo)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [serie.id, serie.title, fold(serie.title), serie.year, serie.rating, serie.added, serie.logo],
      );
      for (const grupo of serie.groups) {
        db.executeSync('INSERT OR IGNORE INTO item_group (kind, item_id, group_name) VALUES (?, ?, ?)', [
          'series',
          serie.id,
          grupo,
        ]);
      }
      indexar(serie.title, 'series', serie.id);
      // Los identificadores del panel hacen falta para pedir los episodios.
      if (serie.panelIds?.length) {
        ponerMeta(db, `panel:${serie.id}`, JSON.stringify(serie.panelIds));
      }
    }

    ponerMeta(db, 'cuenta', cuentaId);
    ponerMeta(db, 'importada', new Date().toISOString());
    db.executeSync('COMMIT');
  } catch (error) {
    db.executeSync('ROLLBACK');
    throw error;
  }
}

function guardarVariantes(
  db: DB,
  clase: string,
  id: string,
  variantes: { url: string; quality: string | null; rank: number }[],
): void {
  for (const variante of variantes) {
    db.executeSync(
      'INSERT OR IGNORE INTO variant (owner_kind, owner_id, url, quality, rank) VALUES (?, ?, ?, ?, ?)',
      [clase, id, variante.url, variante.quality, variante.rank],
    );
  }
}

/** Identificadores de una serie en el panel, para pedirle sus temporadas. */
export function panelIdsDe(db: DB, serieId: string): number[] {
  const guardado = meta(db, `panel:${serieId}`);
  if (!guardado) return [];
  try {
    return JSON.parse(guardado) as number[];
  } catch {
    return [];
  }
}
