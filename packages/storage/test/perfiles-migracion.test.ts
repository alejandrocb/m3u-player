/**
 * Que una base creada antes de la sincronización siga abriendo.
 *
 * Es la parte del cambio que no se ve hasta que es tarde: en el aparato del
 * usuario las tablas de perfil **ya existen y tienen datos**, así que las
 * columnas nuevas llegan por `ALTER TABLE` y no por el `CREATE`. Esta suite
 * monta una base con el esquema viejo, la abre con el nuevo y comprueba que
 * ni se rompe ni pierde nada.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { LibraryStore } from '../src/index.ts';
import { ANTES_DE_SINCRONIZAR } from '../src/schema.ts';

/** El esquema de perfiles tal y como era antes de que hubiera que compartirlo. */
const ESQUEMA_VIEJO = `
CREATE TABLE profile (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL, created TEXT NOT NULL
);
CREATE TABLE progress (
  profile_id TEXT NOT NULL, kind TEXT NOT NULL, item_id TEXT NOT NULL,
  seconds REAL NOT NULL, duration REAL NOT NULL, title TEXT NOT NULL, updated TEXT NOT NULL,
  PRIMARY KEY (profile_id, kind, item_id)
) WITHOUT ROWID;
CREATE TABLE favorite (
  profile_id TEXT NOT NULL, kind TEXT NOT NULL, item_id TEXT NOT NULL,
  title TEXT NOT NULL, created TEXT NOT NULL,
  PRIMARY KEY (profile_id, kind, item_id)
) WITHOUT ROWID;
CREATE TABLE profile_setting (
  profile_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL,
  PRIMARY KEY (profile_id, key)
) WITHOUT ROWID;
`;

/** Deja en disco una base como la que tiene hoy el usuario, con datos dentro. */
function baseVieja(): { ruta: string; limpiar: () => void } {
  const carpeta = mkdtempSync(join(tmpdir(), 'm3u-perfiles-'));
  const ruta = join(carpeta, 'biblioteca.sqlite');

  const db = new DatabaseSync(ruta);
  db.exec(ESQUEMA_VIEJO);
  db.prepare('INSERT INTO profile (id, name, color, created) VALUES (?, ?, ?, ?)').run(
    'ana',
    'Ana',
    '#35d07f',
    '2026-03-01T10:00:00.000Z',
  );
  db.prepare(
    'INSERT INTO progress (profile_id, kind, item_id, seconds, duration, title, updated) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run('ana', 'pelicula', 'lola-pater-2017', 1800, 5400, 'Lola Pater', '2026-08-01T21:00:00.000Z');
  db.prepare('INSERT INTO favorite (profile_id, kind, item_id, title, created) VALUES (?, ?, ?, ?, ?)').run(
    'ana',
    'pelicula',
    'el-aviso-2018',
    'El aviso',
    '2026-07-15T18:00:00.000Z',
  );
  db.prepare('INSERT INTO profile_setting (profile_id, key, value) VALUES (?, ?, ?)').run('ana', 'columnas', '6');
  db.close();

  return { ruta, limpiar: () => rmSync(carpeta, { recursive: true, force: true }) };
}

function columnas(db: DatabaseSync, tabla: string): string[] {
  return (db.prepare(`PRAGMA table_info(${tabla})`).all() as Array<{ name: string }>).map((fila) => fila.name);
}

test('una base del esquema viejo abre y se le añaden las columnas', () => {
  const { ruta, limpiar } = baseVieja();
  try {
    LibraryStore.open(ruta).close();

    const db = new DatabaseSync(ruta);
    for (const tabla of ['profile', 'progress', 'favorite', 'profile_setting']) {
      const tiene = columnas(db, tabla);
      assert.ok(tiene.includes('updated'), `${tabla} sin updated`);
      assert.ok(tiene.includes('deleted'), `${tabla} sin deleted`);
      assert.ok(tiene.includes('origin'), `${tabla} sin origin`);
    }
    db.close();
  } finally {
    limpiar();
  }
});

test('los datos que ya estaban siguen ahí y en pie', () => {
  const { ruta, limpiar } = baseVieja();
  try {
    LibraryStore.open(ruta).close();

    const db = new DatabaseSync(ruta);
    const avance = db.prepare('SELECT seconds, deleted FROM progress WHERE item_id = ?').get('lola-pater-2017') as {
      seconds: number;
      deleted: number;
    };
    db.close();

    // Campo a campo y con la base ya cerrada: `node:sqlite` devuelve objetos
    // sin prototipo, que `deepEqual` no acepta, y una aserción que salta con
    // el fichero abierto deja el bloqueo puesto y esconde el fallo de verdad.
    assert.equal(avance.seconds, 1800);
    assert.equal(avance.deleted, 0);
  } finally {
    limpiar();
  }
});

test('lo que no tenía fecha de cambio se rellena, y con una que no gane', () => {
  const { ruta, limpiar } = baseVieja();
  try {
    LibraryStore.open(ruta).close();

    const db = new DatabaseSync(ruta);
    // Perfil y favorito tienen fecha propia de la que tirar.
    assert.equal(
      (db.prepare('SELECT updated FROM profile WHERE id = ?').get('ana') as { updated: string }).updated,
      '2026-03-01T10:00:00.000Z',
    );
    assert.equal(
      (db.prepare('SELECT updated FROM favorite WHERE item_id = ?').get('el-aviso-2018') as { updated: string })
        .updated,
      '2026-07-15T18:00:00.000Z',
    );
    // Los ajustes no la tienen: se fechan muy atrás para que cualquier cambio
    // de otro aparato les gane, en vez de pisarlo por parecer recientes.
    assert.equal(
      (db.prepare('SELECT updated FROM profile_setting WHERE key = ?').get('columnas') as { updated: string }).updated,
      ANTES_DE_SINCRONIZAR,
    );
    db.close();
  } finally {
    limpiar();
  }
});

test('abrirla dos veces no vuelve a rellenar ni duplica columnas', () => {
  const { ruta, limpiar } = baseVieja();
  try {
    LibraryStore.open(ruta).close();

    const db = new DatabaseSync(ruta);
    db.prepare('UPDATE profile_setting SET updated = ? WHERE key = ?').run('2026-08-22T09:00:00.000Z', 'columnas');
    db.close();

    LibraryStore.open(ruta).close();

    const otra = new DatabaseSync(ruta);
    assert.equal(
      (otra.prepare('SELECT updated FROM profile_setting WHERE key = ?').get('columnas') as { updated: string })
        .updated,
      '2026-08-22T09:00:00.000Z',
    );
    assert.equal(columnas(otra, 'profile').filter((nombre) => nombre === 'updated').length, 1);
    otra.close();
  } finally {
    limpiar();
  }
});

test('una base nueva nace ya con las columnas y sin nada que rellenar', () => {
  const carpeta = mkdtempSync(join(tmpdir(), 'm3u-perfiles-'));
  const ruta = join(carpeta, 'nueva.sqlite');
  try {
    LibraryStore.open(ruta).close();

    const db = new DatabaseSync(ruta);
    assert.ok(columnas(db, 'favorite').includes('origin'));
    // Y los índices por los que entra la sincronización existen.
    const indices = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as Array<{ name: string }>
    ).map((fila) => fila.name);
    assert.ok(indices.includes('progress_by_updated'));
    assert.ok(indices.includes('favorite_by_updated'));
    db.close();
  } finally {
    rmSync(carpeta, { recursive: true, force: true });
  }
});
