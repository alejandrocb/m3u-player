/**
 * El caso completo: tele y tablet compartiendo historial a través del VPS.
 *
 * Aquí no se simula nada por el medio. Se levanta el servidor de verdad, se
 * montan dos "aparatos" con su SQLite y su `ClienteSync`, y hablan por HTTP
 * como lo harán en casa. Es lo único que comprueba a la vez el emparejamiento,
 * las dos marcas de agua, la fusión y las lápidas.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import type { AlmacenSync, Cambio, EstadoSync } from '@m3u/ui';
import { ClienteSync } from '@m3u/ui';
import { SCHEMA_PERFILES_SQL } from '@m3u/storage/schema';
import type { BaseSQL } from '@m3u/storage/sincronizar';
import { aplicarCambios, cambiosDesde } from '@m3u/storage/sincronizar';

import { Panel } from '../src/panel.ts';
import { crearServidor } from '../src/servidor.ts';

/** Un aparato de la casa: su base, su llavero y su cliente. */
interface Aparato {
  nombre: string;
  base: BaseSQL;
  cliente: ClienteSync;
  cerrar: () => void;
}

/** El llavero, que aquí es una variable. En Android es el Keystore. */
function llavero(): AlmacenSync {
  let guardado: EstadoSync | null = null;
  return {
    leer: async () => guardado,
    guardar: async (estado) => {
      guardado = estado;
    },
    olvidar: async () => {
      guardado = null;
    },
  };
}

function aparato(nombre: string, url: string): Aparato {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA_PERFILES_SQL);
  db.exec(
    `INSERT INTO profile (id, name, color, created, updated, deleted, origin)
     VALUES ('ana', 'Ana', '#35d07f', '2026-03-01T10:00:00.000Z', '2026-03-01T10:00:00.000Z', 0, 'alta')`,
  );

  const base: BaseSQL = {
    filas: (sql, params = []) => db.prepare(sql).all(...(params as never[])) as Array<Record<string, unknown>>,
    ejecutar: (sql, params = []) => {
      if (params.length === 0) db.exec(sql);
      else db.prepare(sql).run(...(params as never[]));
    },
  };

  const cliente = new ClienteSync({
    almacen: llavero(),
    perfiles: {
      cambiosDesde: async (marca: string) => cambiosDesde(base, marca),
      aplicarCambios: async (cambios: Cambio[]) => {
        aplicarCambios(base, cambios);
      },
    },
    buscar: (direccion, opciones) => fetch(direccion, opciones),
  });

  void url;
  return { nombre, base, cliente, cerrar: () => db.close() };
}

interface Casa {
  url: string;
  panel: Panel;
  cerrar: () => Promise<void>;
}

async function montar(): Promise<Casa> {
  const carpeta = mkdtempSync(join(tmpdir(), 'm3u-e2e-'));
  const panel = new Panel(carpeta);
  const servidor = crearServidor(panel, () => 'ABCD-2345');

  await new Promise<void>((listo) => servidor.listen(0, '127.0.0.1', listo));
  const puerto = (servidor.address() as AddressInfo).port;

  return {
    url: `http://127.0.0.1:${puerto}`,
    panel,
    cerrar: async () => {
      await new Promise<void>((hecho) => servidor.close(() => hecho()));
      panel.cerrar();
      try {
        rmSync(carpeta, { recursive: true, force: true });
      } catch {
        // En Windows el fichero puede quedar bloqueado un instante.
      }
    },
  };
}

/** El alta completa, tal y como pasa en casa: código, aprobación y token. */
async function emparejar(casa: Casa, quien: Aparato, grupoId: string): Promise<void> {
  const alta = await quien.cliente.pedirAlta(casa.url, quien.nombre, `a-${quien.nombre}`);

  // Esto es lo que haces tú en la web.
  assert.ok(casa.panel.aprobar(alta.codigo, grupoId, quien.nombre));

  const resultado = await quien.cliente.comprobar(casa.url, alta.espera);
  assert.equal(resultado.estado, 'aprobado');

  /*
    Y queda pendiente adoptar los perfiles de la casa: los perfiles son del
    grupo, así que el que el aparato se hubiera creado por su cuenta sobra en
    cuanto entra en una. Lo hace la aplicación al abrir su almacén, que aquí
    no existe, pero la señal tiene que estar puesta.
  */
  assert.equal((await quien.cliente.estado())?.adoptar, true, 'recién emparejado, toca adoptar');
  await quien.cliente.adoptado();
  assert.equal((await quien.cliente.estado())?.adoptar, false, 'y solo se hace una vez');
}

/** Anuncia que este aparato está reproduciendo, como hace la aplicación. */
function anuncia(quien: Aparato, aparato: string, cuando: string): void {
  quien.base.ejecutar(
    `INSERT INTO profile_setting (profile_id, key, value, updated, deleted, origin)
     VALUES ('ana', 'reproduciendo', ?, ?, 0, ?)
     ON CONFLICT(profile_id, key) DO UPDATE SET
       value = excluded.value, updated = excluded.updated, deleted = 0, origin = excluded.origin`,
    [
      JSON.stringify({ aparato: quien.nombre, nombre: aparato, titulo: 'Lola Pater', desde: cuando }),
      cuando,
      quien.nombre,
    ],
  );
}

/** Anota por dónde va una película, como hace el reproductor. */
function verHasta(quien: Aparato, segundos: number, cuando: string): void {
  quien.base.ejecutar(
    `INSERT INTO progress (profile_id, kind, item_id, seconds, duration, title, updated, deleted, origin)
     VALUES ('ana', 'pelicula', 'lola-pater-2017', ?, 5400, 'Lola Pater', ?, 0, ?)
     ON CONFLICT(profile_id, kind, item_id) DO UPDATE SET
       seconds = excluded.seconds, updated = excluded.updated, deleted = 0, origin = excluded.origin`,
    [segundos, cuando, quien.nombre],
  );
}

function porDondeIba(quien: Aparato): number | null {
  const fila = quien.base.filas(
    "SELECT seconds FROM progress WHERE profile_id = 'ana' AND item_id = 'lola-pater-2017' AND deleted = 0",
  )[0];
  return fila ? Number(fila.seconds) : null;
}

test('dejo la película a medias en la tele y la sigo en la tablet', async () => {
  const casa = await montar();
  const tele = aparato('tele', casa.url);
  const tablet = aparato('tablet', casa.url);
  try {
    const grupo = casa.panel.crearGrupo('Casa Triana');
    await emparejar(casa, tele, grupo.id);
    await emparejar(casa, tablet, grupo.id);

    // Media hora de película en la tele, y se sincroniza.
    verHasta(tele, 1800, '2026-08-23T21:00:00.000Z');
    assert.deepEqual(await tele.cliente.sincronizar(), { subidos: 2, bajados: 2 });

    // La tablet, que estaba en blanco, se la encuentra por donde iba.
    const bajada = await tablet.cliente.sincronizar();
    assert.ok((bajada?.bajados ?? 0) >= 1);
    assert.equal(porDondeIba(tablet), 1800);
  } finally {
    tele.cerrar();
    tablet.cerrar();
    await casa.cerrar();
  }
});

test('y lo que avanzo en la tablet vuelve a la tele', async () => {
  const casa = await montar();
  const tele = aparato('tele', casa.url);
  const tablet = aparato('tablet', casa.url);
  try {
    const grupo = casa.panel.crearGrupo('Casa Triana');
    await emparejar(casa, tele, grupo.id);
    await emparejar(casa, tablet, grupo.id);

    verHasta(tele, 1800, '2026-08-23T21:00:00.000Z');
    await tele.cliente.sincronizar();
    await tablet.cliente.sincronizar();

    // Se termina en la tablet.
    verHasta(tablet, 5100, '2026-08-24T10:00:00.000Z');
    await tablet.cliente.sincronizar();
    await tele.cliente.sincronizar();

    assert.equal(porDondeIba(tele), 5100);
  } finally {
    tele.cerrar();
    tablet.cerrar();
    await casa.cerrar();
  }
});

test('sincronizar sin novedades no mueve nada', async () => {
  const casa = await montar();
  const tele = aparato('tele', casa.url);
  try {
    const grupo = casa.panel.crearGrupo('Casa Triana');
    await emparejar(casa, tele, grupo.id);

    verHasta(tele, 1800, '2026-08-23T21:00:00.000Z');
    await tele.cliente.sincronizar();

    // La segunda vuelta ya no tiene nada que decir en ninguna dirección.
    assert.deepEqual(await tele.cliente.sincronizar(), { subidos: 0, bajados: 0 });
  } finally {
    tele.cerrar();
    await casa.cerrar();
  }
});

test('lo que sube la tele después de días apagada le llega a la tablet', async () => {
  const casa = await montar();
  const tele = aparato('tele', casa.url);
  const tablet = aparato('tablet', casa.url);
  try {
    const grupo = casa.panel.crearGrupo('Casa Triana');
    await emparejar(casa, tele, grupo.id);
    await emparejar(casa, tablet, grupo.id);

    // La tele anota algo el martes pero no se conecta.
    verHasta(tele, 600, '2026-08-18T21:00:00.000Z');

    // La tablet sigue con su vida y su marca de bajada avanza.
    tablet.base.ejecutar(
      `INSERT INTO favorite (profile_id, kind, item_id, title, created, updated, deleted, origin)
       VALUES ('ana', 'pelicula', 'el-aviso-2018', 'El aviso', ?, ?, 0, 'tablet')`,
      ['2026-08-23T10:00:00.000Z', '2026-08-23T10:00:00.000Z'],
    );
    await tablet.cliente.sincronizar();

    // Y por fin la tele se enciende y sube lo del martes.
    await tele.cliente.sincronizar();

    // La tablet tiene que verlo, aunque su fecha sea anterior a la marca.
    await tablet.cliente.sincronizar();
    assert.equal(porDondeIba(tablet), 600);
  } finally {
    tele.cerrar();
    tablet.cerrar();
    await casa.cerrar();
  }
});

test('lo quitado de favoritos no reaparece desde el otro aparato', async () => {
  const casa = await montar();
  const tele = aparato('tele', casa.url);
  const tablet = aparato('tablet', casa.url);
  try {
    const grupo = casa.panel.crearGrupo('Casa Triana');
    await emparejar(casa, tele, grupo.id);
    await emparejar(casa, tablet, grupo.id);

    const cuantos = (quien: Aparato): number =>
      quien.base.filas("SELECT item_id FROM favorite WHERE profile_id = 'ana' AND deleted = 0").length;

    tele.base.ejecutar(
      `INSERT INTO favorite (profile_id, kind, item_id, title, created, updated, deleted, origin)
       VALUES ('ana', 'pelicula', 'el-aviso-2018', 'El aviso', ?, ?, 0, 'tele')`,
      ['2026-08-20T12:00:00.000Z', '2026-08-20T12:00:00.000Z'],
    );
    await tele.cliente.sincronizar();
    await tablet.cliente.sincronizar();
    assert.equal(cuantos(tablet), 1);

    // Se quita en la tablet.
    tablet.base.ejecutar(
      `UPDATE favorite SET deleted = 1, updated = ?, origin = 'tablet'
        WHERE profile_id = 'ana' AND item_id = 'el-aviso-2018'`,
      ['2026-08-24T18:00:00.000Z'],
    );
    await tablet.cliente.sincronizar();
    await tele.cliente.sincronizar();
    assert.equal(cuantos(tele), 0);

    // Y la tele, al sincronizar otra vez, no lo resucita.
    await tele.cliente.sincronizar();
    await tablet.cliente.sincronizar();
    assert.equal(cuantos(tablet), 0);
  } finally {
    tele.cerrar();
    tablet.cerrar();
    await casa.cerrar();
  }
});

test('el aviso de "estoy reproduciendo" llega al otro aparato', async () => {
  /*
    Un perfil es una persona, y una persona no ve dos cosas a la vez: cuando
    empieza algo en la tablet, la tele tiene que enterarse para callarse. El
    aviso viaja por donde viaja todo lo del perfil, así que aquí se comprueba
    que llega y que dice **desde qué aparato**, que es lo que se le enseña a
    quien está mirando.
  */
  const casa = await montar();
  const tele = aparato('tele', casa.url);
  const tablet = aparato('tablet', casa.url);
  try {
    const grupo = casa.panel.crearGrupo('Casa Triana');
    await emparejar(casa, tele, grupo.id);
    await emparejar(casa, tablet, grupo.id);

    anuncia(tablet, 'Tablet del salón', '2026-08-27T21:00:00.000Z');
    await tablet.cliente.sincronizar();
    await tele.cliente.sincronizar();

    const puesto = tele.base.filas(
      "SELECT value FROM profile_setting WHERE profile_id = 'ana' AND key = 'reproduciendo'",
    )[0];
    assert.equal(JSON.parse(String(puesto?.value)).nombre, 'Tablet del salón');
    assert.equal(JSON.parse(String(puesto?.value)).aparato, 'tablet', 'el identificador, que es lo que compara');

    // Y al parar se borra: el valor vacío también viaja, porque una lápida
    // aquí significaría "este ajuste ya no existe" y no "no suena nada".
    anuncia(tablet, 'Tablet del salón', '2026-08-27T21:30:00.000Z');
    tablet.base.ejecutar(
      "UPDATE profile_setting SET value = '', updated = ? WHERE profile_id = 'ana' AND key = 'reproduciendo'",
      ['2026-08-27T21:31:00.000Z'],
    );
    await tablet.cliente.sincronizar();
    await tele.cliente.sincronizar();

    const vacio = tele.base.filas(
      "SELECT value FROM profile_setting WHERE profile_id = 'ana' AND key = 'reproduciendo'",
    )[0];
    assert.equal(vacio?.value, '');
  } finally {
    tele.cerrar();
    tablet.cerrar();
    await casa.cerrar();
  }
});

test('el servidor le recuerda a cada aparato cómo se llama en la casa', async () => {
  // Hace falta para poder decir "ha empezado a ver algo en TV Salón", y viaja
  // en cada sincronización y no solo en el alta: los aparatos emparejados
  // antes de que esto existiera no van a volver a darse de alta.
  const casa = await montar();
  const tele = aparato('tele', casa.url);
  try {
    const grupo = casa.panel.crearGrupo('Casa Triana');
    await emparejar(casa, tele, grupo.id);

    await tele.cliente.sincronizar();
    assert.equal((await tele.cliente.estado())?.aparato, 'tele');
  } finally {
    tele.cerrar();
    await casa.cerrar();
  }
});

test('un aparato revocado se entera y se olvida del emparejamiento', async () => {
  const casa = await montar();
  const tele = aparato('tele', casa.url);
  try {
    const grupo = casa.panel.crearGrupo('Casa Triana');
    await emparejar(casa, tele, grupo.id);
    assert.ok(await tele.cliente.estado());

    casa.panel.revocar(casa.panel.aparatosDe(grupo.id)[0]!.id);

    await assert.rejects(() => tele.cliente.sincronizar(), { name: 'AparatoRevocado' });
    // Y se ha limpiado solo: la app volverá a enseñar el código de alta.
    assert.equal(await tele.cliente.estado(), null);
  } finally {
    tele.cerrar();
    await casa.cerrar();
  }
});

test('sin emparejar, sincronizar no es un fallo: simplemente no hay servidor', async () => {
  const casa = await montar();
  const suelto = aparato('suelto', casa.url);
  try {
    assert.equal(await suelto.cliente.sincronizar(), null);
  } finally {
    suelto.cerrar();
    await casa.cerrar();
  }
});

test('al emparejarse recibe las listas de su casa, sin teclear ninguna URL', async () => {
  const casa = await montar();
  const tele = aparato('tele', casa.url);
  try {
    const grupo = casa.panel.crearGrupo('Casa Triana');
    casa.panel.guardarLista(grupo.id, 'Principal', 'http://panel.example:8080/get.php?username=u&password=p');

    const alta = await tele.cliente.pedirAlta(casa.url, 'Philips 50PUS');
    casa.panel.aprobar(alta.codigo, grupo.id, 'TV Salón');
    const resultado = await tele.cliente.comprobar(casa.url, alta.espera);

    assert.equal(resultado.estado, 'aprobado');
    if (resultado.estado !== 'aprobado') return;
    assert.equal(resultado.listas.length, 1);
    assert.equal(resultado.listas[0]?.nombre, 'Principal');
    assert.equal(resultado.grupo?.nombre, 'Casa Triana');
  } finally {
    tele.cerrar();
    await casa.cerrar();
  }
});

test('la casa de al lado no ve nada de esta', async () => {
  const casa = await montar();
  const enTriana = aparato('tele-triana', casa.url);
  const enFariones = aparato('tele-fariones', casa.url);
  try {
    const triana = casa.panel.crearGrupo('Casa Triana');
    const fariones = casa.panel.crearGrupo('Casa Fariones');
    await emparejar(casa, enTriana, triana.id);
    await emparejar(casa, enFariones, fariones.id);

    verHasta(enTriana, 1800, '2026-08-23T21:00:00.000Z');
    await enTriana.cliente.sincronizar();
    await enFariones.cliente.sincronizar();

    assert.equal(porDondeIba(enFariones), null);
  } finally {
    enTriana.cerrar();
    enFariones.cerrar();
    await casa.cerrar();
  }
});
