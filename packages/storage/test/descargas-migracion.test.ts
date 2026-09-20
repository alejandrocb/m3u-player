/**
 * Que una base con la tabla `download` vieja siga pudiendo apuntar descargas.
 *
 * Esta es la que se escapó, y salió cara. `CREATE TABLE IF NOT EXISTS` **no
 * añade columnas a una tabla que ya existe**, así que en los aparatos donde
 * `download` se creó antes de que hubiera `seconds` —la duración, que es lo
 * que permite decir cuántas horas de vídeo hay bajadas— cada intento de
 * guardar reventaba con "table download has no column named seconds". Y el
 * fallo se lo tragaba un `catch` vacío: la descarga arrancaba, ponía su aviso,
 * bajaba sus gigas, y al cerrar la aplicación no existía. Ni reanudaba, ni se
 * podía borrar desde la lista, y el disco se llenaba solo.
 *
 * Se vio en la tele de casa: 4,8 GB ocupados y una cola vacía.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { LibraryStore } from '../src/index.ts';

/** `download` como era antes de que se contaran las horas bajadas. */
const DESCARGAS_VIEJAS = `
CREATE TABLE download (
  id       TEXT PRIMARY KEY,
  kind     TEXT NOT NULL,
  item_id  TEXT NOT NULL,
  title    TEXT NOT NULL,
  url      TEXT NOT NULL,
  file     TEXT NOT NULL,
  state    TEXT NOT NULL,
  bytes    INTEGER NOT NULL DEFAULT 0,
  total    INTEGER,
  created  TEXT NOT NULL
) WITHOUT ROWID;
`;

function columnas(db: DatabaseSync, tabla: string): string[] {
  return (db.prepare(`PRAGMA table_info(${tabla})`).all() as Array<{ name: string }>).map((fila) => fila.name);
}

test('a una tabla de descargas vieja se le añaden las columnas que faltan', () => {
  const carpeta = mkdtempSync(join(tmpdir(), 'm3u-descargas-'));
  const ruta = join(carpeta, 'biblioteca.sqlite');
  try {
    const vieja = new DatabaseSync(ruta);
    vieja.exec(DESCARGAS_VIEJAS);
    // Con una descarga dentro: migrar no puede llevarse por delante lo que hay.
    vieja
      .prepare(
        'INSERT INTO download (id, kind, item_id, title, url, file, state, bytes, total, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        'pelicula:lola-pater-2017',
        'pelicula',
        'lola-pater-2017',
        'Lola Pater',
        'http://panel/movie/1.mkv',
        'lola.mkv',
        'en cola',
        0,
        null,
        '2026-09-01T10:00:00.000Z',
      );
    vieja.close();

    LibraryStore.open(ruta).close();

    const db = new DatabaseSync(ruta);
    try {
      const tiene = columnas(db, 'download');
      for (const columna of ['series_id', 'seconds', 'tries', 'error']) {
        assert.ok(tiene.includes(columna), `falta la columna ${columna}`);
      }

      // Y lo que de verdad se rompía: guardar con todas las columnas.
      db.prepare(
        `INSERT INTO download
           (id, kind, item_id, title, series_id, url, file, state, bytes, total, created, seconds, tries, error)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET state = excluded.state, bytes = excluded.bytes`,
      ).run(
        'pelicula:el-aviso-2018',
        'pelicula',
        'el-aviso-2018',
        'El aviso',
        null,
        'http://panel/movie/2.mkv',
        'aviso.mkv',
        'bajando',
        1024,
        2048,
        '2026-09-02T10:00:00.000Z',
        5400,
        0,
        null,
      );

      assert.equal((db.prepare('SELECT COUNT(*) AS n FROM download').get() as { n: number }).n, 2);
      // La que ya estaba sigue ahí: migrar añade, no vacía.
      const antigua = db.prepare('SELECT title FROM download WHERE id = ?').get('pelicula:lola-pater-2017') as {
        title: string;
      };
      assert.equal(antigua.title, 'Lola Pater');
    } finally {
      db.close();
    }
  } finally {
    rmSync(carpeta, { recursive: true, force: true });
  }
});
