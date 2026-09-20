/**
 * Dos aparatos compartiendo historial.
 *
 * Se montan dos bases en memoria —"la tele" y "la tablet"— y se hace pasar
 * los cambios de una a otra como los pasaría el servidor. Es la única forma
 * de comprobar de verdad lo que se quiere: dejar algo a medias en un sitio y
 * encontrarlo por donde iba en el otro.
 */

import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import type { BaseSQL } from '../src/sincronizar.ts';
import { aplicarCambios, cambioValido, cambiosDesde } from '../src/sincronizar.ts';
import { SCHEMA_PERFILES_SQL, migrarTablasDePerfil } from '../src/schema.ts';

/** El principio de los tiempos: pedir "todo" es pedir lo posterior a esto. */
const DESDE_CERO = '';

interface Aparato {
  nombre: string;
  base: BaseSQL;
  db: DatabaseSync;
}

function aparato(nombre: string): Aparato {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA_PERFILES_SQL);
  // Al día, igual que la base de un aparato de verdad.
  migrarTablasDePerfil({
    columnas: (tabla) =>
      (db.prepare(`PRAGMA table_info(${tabla})`).all() as Array<{ name: string }>).map((fila) => fila.name),
    ejecutar: (sql) => db.exec(sql),
  });
  db.exec(
    `INSERT INTO profile (id, name, color, created, updated, deleted, origin)
     VALUES ('ana', 'Ana', '#35d07f', '2026-03-01T10:00:00.000Z', '2026-03-01T10:00:00.000Z', 0, 'alta')`,
  );

  const base: BaseSQL = {
    filas: (sql, params = []) => db.prepare(sql).all(...(params as never[])) as Array<Record<string, unknown>>,
    ejecutar: (sql, params = []) => {
      // BEGIN y COMMIT no admiten parámetros y `prepare` los rechaza.
      if (params.length === 0) db.exec(sql);
      else db.prepare(sql).run(...(params as never[]));
    },
  };
  return { nombre, base, db };
}

/** Anota por dónde va una película, como hace el reproductor al reproducir. */
function verHasta(quien: Aparato, segundos: number, cuando: string): void {
  quien.base.ejecutar(
    `INSERT INTO progress (profile_id, kind, item_id, seconds, duration, title, updated, deleted, origin)
     VALUES ('ana', 'pelicula', 'lola-pater-2017', ?, 5400, 'Lola Pater', ?, 0, ?)
     ON CONFLICT(profile_id, kind, item_id) DO UPDATE SET
       seconds = excluded.seconds, updated = excluded.updated, deleted = 0, origin = excluded.origin`,
    [segundos, cuando, quien.nombre],
  );
}

function porDondeIba(quien: Aparato): { seconds: number; deleted: number } | null {
  const fila = quien.base.filas(
    "SELECT seconds, deleted FROM progress WHERE profile_id = 'ana' AND item_id = 'lola-pater-2017'",
  )[0];
  return fila ? { seconds: Number(fila.seconds), deleted: Number(fila.deleted) } : null;
}

/** Lo que hace el servidor: llevar lo de uno al otro. */
function sincronizar(de: Aparato, a: Aparato, marca = DESDE_CERO): void {
  aplicarCambios(a.base, cambiosDesde(de.base, marca));
}

test('lo dejado a medias en la tele aparece por donde iba en la tablet', () => {
  const tele = aparato('tele');
  const tablet = aparato('tablet');

  verHasta(tele, 1800, '2026-08-21T21:00:00.000Z');
  sincronizar(tele, tablet);

  assert.deepEqual(porDondeIba(tablet), { seconds: 1800, deleted: 0 });
});

test('lo que se sigue viendo en la tablet vuelve actualizado a la tele', () => {
  const tele = aparato('tele');
  const tablet = aparato('tablet');

  verHasta(tele, 1800, '2026-08-21T21:00:00.000Z');
  sincronizar(tele, tablet);

  verHasta(tablet, 3600, '2026-08-22T10:00:00.000Z');
  sincronizar(tablet, tele);

  assert.equal(porDondeIba(tele)?.seconds, 3600);
});

test('la tele que lleva una semana apagada no pisa lo nuevo al encenderse', () => {
  const tele = aparato('tele');
  const tablet = aparato('tablet');

  verHasta(tele, 600, '2026-08-14T21:00:00.000Z');
  verHasta(tablet, 3600, '2026-08-22T10:00:00.000Z');

  sincronizar(tele, tablet);
  assert.equal(porDondeIba(tablet)?.seconds, 3600);

  // Y en la tele sí entra lo de la tablet, que es lo posterior.
  sincronizar(tablet, tele);
  assert.equal(porDondeIba(tele)?.seconds, 3600);
});

test('lo quitado de favoritos no lo resucita el otro aparato', () => {
  const tele = aparato('tele');
  const tablet = aparato('tablet');

  const marcar = (quien: Aparato, cuando: string): void => {
    quien.base.ejecutar(
      `INSERT INTO favorite (profile_id, kind, item_id, title, created, updated, deleted, origin)
       VALUES ('ana', 'pelicula', 'el-aviso-2018', 'El aviso', ?, ?, 0, ?)`,
      [cuando, cuando, quien.nombre],
    );
  };
  const cuantos = (quien: Aparato): number =>
    quien.base.filas("SELECT item_id FROM favorite WHERE profile_id = 'ana' AND deleted = 0").length;

  marcar(tele, '2026-08-01T12:00:00.000Z');
  sincronizar(tele, tablet);
  assert.equal(cuantos(tablet), 1);

  // Se quita en la tablet: la fila se queda de lápida, no se borra.
  tablet.base.ejecutar(
    `UPDATE favorite SET deleted = 1, updated = ?, origin = 'tablet'
      WHERE profile_id = 'ana' AND item_id = 'el-aviso-2018'`,
    ['2026-08-22T18:00:00.000Z'],
  );
  sincronizar(tablet, tele);
  assert.equal(cuantos(tele), 0);

  // Y ahora la vuelta: la tele manda lo suyo y no lo revive.
  sincronizar(tele, tablet);
  assert.equal(cuantos(tablet), 0);
});

test('la marca de agua evita volver a mandar lo ya sincronizado', () => {
  const tele = aparato('tele');

  verHasta(tele, 1800, '2026-08-21T21:00:00.000Z');
  const primera = cambiosDesde(tele.base, DESDE_CERO);
  assert.equal(primera.filter((cambio) => cambio.tabla === 'progress').length, 1);

  // Con la marca puesta en ese momento ya no hay nada pendiente...
  assert.deepEqual(cambiosDesde(tele.base, '2026-08-21T21:00:00.000Z'), []);

  // ...hasta que se sigue viendo.
  verHasta(tele, 3600, '2026-08-22T10:00:00.000Z');
  assert.equal(cambiosDesde(tele.base, '2026-08-21T21:00:00.000Z').length, 1);
});

test('sincronizar dos veces lo mismo no cambia nada', () => {
  const tele = aparato('tele');
  const tablet = aparato('tablet');

  verHasta(tele, 1800, '2026-08-21T21:00:00.000Z');
  sincronizar(tele, tablet);
  const despues = porDondeIba(tablet);

  sincronizar(tele, tablet);
  assert.deepEqual(porDondeIba(tablet), despues);
});

test('los ajustes y los perfiles viajan igual que el historial', () => {
  const tele = aparato('tele');
  const tablet = aparato('tablet');

  tele.base.ejecutar(
    `INSERT INTO profile_setting (profile_id, key, value, updated, deleted, origin)
     VALUES ('ana', 'columnas', '6', '2026-08-22T09:00:00.000Z', 0, 'tele')`,
  );
  tele.base.ejecutar(
    `INSERT INTO profile (id, name, color, created, updated, deleted, origin)
     VALUES ('luis', 'Luis', '#4aa3f0', '2026-08-22T09:30:00.000Z', '2026-08-22T09:30:00.000Z', 0, 'tele')`,
  );
  sincronizar(tele, tablet);

  assert.equal(
    tablet.base.filas("SELECT value FROM profile_setting WHERE profile_id = 'ana' AND key = 'columnas'")[0]?.value,
    '6',
  );
  assert.equal(tablet.base.filas('SELECT id FROM profile WHERE deleted = 0 ORDER BY id').length, 2);
});

test('una tabla que este aparato no conoce se ignora sin tirar el resto', () => {
  const tablet = aparato('tablet');

  aplicarCambios(tablet.base, [
    {
      tabla: 'invento_futuro',
      clave: ['ana', 'algo'],
      campos: { value: 'x' },
      actualizado: '2026-08-22T09:00:00.000Z',
      borrado: false,
      origen: 'tele',
    },
    {
      tabla: 'progress',
      clave: ['ana', 'pelicula', 'lola-pater-2017'],
      campos: { seconds: 1800, duration: 5400, title: 'Lola Pater' },
      actualizado: '2026-08-22T09:00:00.000Z',
      borrado: false,
      origen: 'tele',
    },
  ]);

  assert.equal(porDondeIba(tablet)?.seconds, 1800);
});

test('un cambio bien formado se reconoce como tal', () => {
  assert.equal(
    cambioValido({
      tabla: 'progress',
      clave: ['ana', 'pelicula', 'lola-pater-2017'],
      campos: { seconds: 1800, duration: 5400, title: 'Lola Pater' },
      actualizado: '2026-08-22T21:00:00.000Z',
      borrado: false,
      origen: 'tele',
    }),
    true,
  );
});

test('lo que no tiene forma de cambio se rechaza', () => {
  const bueno = {
    tabla: 'progress',
    clave: ['ana', 'pelicula', 'lola-pater-2017'],
    campos: { seconds: 1800, duration: 5400, title: 'Lola Pater' },
    actualizado: '2026-08-22T21:00:00.000Z',
    borrado: false,
    origen: 'tele',
  };

  assert.equal(cambioValido(null), false);
  assert.equal(cambioValido('progress'), false);
  // Una tabla que no está en el reparto.
  assert.equal(cambioValido({ ...bueno, tabla: 'sqlite_master' }), false);
  // La clave con menos partes de las que lleva la tabla: es lo que
  // descuadraría los parámetros del INSERT.
  assert.equal(cambioValido({ ...bueno, clave: ['ana'] }), false);
  assert.equal(cambioValido({ ...bueno, clave: ['ana', 'pelicula', 7] }), false);
  assert.equal(cambioValido({ ...bueno, actualizado: '' }), false);
  assert.equal(cambioValido({ ...bueno, borrado: 'si' }), false);
  // Un campo que no es ni texto ni número: un objeto no sabe escribirlo SQLite.
  assert.equal(cambioValido({ ...bueno, campos: { seconds: { raro: true } } }), false);
});

test('los campos que faltan no invalidan el cambio', () => {
  // Una versión más vieja de la app puede no mandarlos todos; se escriben a
  // NULL y ya. Rechazar la fila entera por eso sería peor.
  assert.equal(
    cambioValido({
      tabla: 'favorite',
      clave: ['ana', 'pelicula', 'el-aviso-2018'],
      campos: { title: 'El aviso' },
      actualizado: '2026-08-22T21:00:00.000Z',
      borrado: false,
      origen: null,
    }),
    true,
  );
});
