/**
 * Los datos del servidor: grupos, aparatos, listas y el acceso al panel.
 *
 * **Cada grupo tiene su propio fichero SQLite** para el historial, con el
 * mismo esquema exacto que la tablet y la tele (`SCHEMA_PERFILES_SQL`). No es
 * un capricho de organización:
 *
 * - `cambiosDesde` y `aplicarCambios` funcionan aquí **sin tocar una línea**,
 *   porque las tablas son idénticas. Si en el servidor metiera una columna
 *   `grupo_id` en la clave, habría dos esquemas que mantener a la vez y el
 *   código dejaría de ser compartido, que es de donde sale la garantía de que
 *   los dos lados deciden igual.
 * - Casa Triana y Casa Fariones quedan separadas **por fichero**, no por un
 *   `WHERE`. Un filtro que se olvida en una consulta es el fallo típico que
 *   enseña el historial de una casa en la otra; aquí no hay consulta que
 *   pueda cruzarlos.
 * - La copia de seguridad de una casa es copiar un fichero.
 *
 * Aparte va `panel.sqlite`, con lo que administras tú.
 */

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  INDICES_TRAS_MIGRAR_SQL,
  RELLENOS_SQL,
  SCHEMA_PERFILES_SQL,
  SINCRONIZADAS,
  migrarTablasDePerfil,
} from '@m3u/storage/schema';
import type { BaseSQL } from '@m3u/storage/sincronizar';

import { aleatorio, cifrarContrasena, codigoCorto, compruebaContrasena, huella } from './claves.ts';

/** Cuánto vale un código de emparejamiento sin usar. */
const CADUCIDAD_CODIGO_MINUTOS = 60;
/** Cuánto dura la sesión de la web de administración. */
const CADUCIDAD_SESION_DIAS = 30;

const ESQUEMA_PANEL = `
CREATE TABLE IF NOT EXISTS grupo (
  id     TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  creado TEXT NOT NULL
);

-- Un aparato pasa por: pendiente (ha pedido alta) -> aprobado (le has dicho
-- que sí) -> activo (ya ha recogido su token) -> revocado.
CREATE TABLE IF NOT EXISTS aparato (
  id       TEXT PRIMARY KEY,
  grupo_id TEXT,
  nombre   TEXT,
  -- El identificador que se inventa el propio aparato y con el que firma sus
  -- filas (la columna origin). Aquí solo sirve para reconocerlo de un vistazo.
  aparato  TEXT,
  apodo    TEXT,
  codigo   TEXT,
  -- Huellas, nunca el valor: un volcado de esta tabla no da acceso a nada.
  espera   TEXT,
  token    TEXT,
  estado   TEXT NOT NULL,
  pedido   TEXT NOT NULL,
  caduca   TEXT,
  ultima   TEXT
);
CREATE INDEX IF NOT EXISTS aparato_por_token ON aparato (token);
CREATE INDEX IF NOT EXISTS aparato_por_espera ON aparato (espera);
CREATE INDEX IF NOT EXISTS aparato_por_grupo ON aparato (grupo_id);

-- Las listas cuelgan del grupo, no del aparato: en una casa todos ven lo
-- mismo, y así se dan de alta una vez y las reciben los tres aparatos.
CREATE TABLE IF NOT EXISTS lista (
  id       TEXT PRIMARY KEY,
  grupo_id TEXT NOT NULL,
  nombre   TEXT NOT NULL,
  url      TEXT NOT NULL,
  creado   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS lista_por_grupo ON lista (grupo_id);

-- Las portadas del inicio, preparadas una vez al día por lista. Es una
-- caché: se puede borrar entera y se vuelve a llenar sola.
CREATE TABLE IF NOT EXISTS portada (
  lista_id TEXT PRIMARY KEY,
  generado TEXT NOT NULL,
  -- La lista de sugerencias tal cual se le manda al aparato. Guardarla en JSON
  -- y no en columnas es a propósito: aquí no se consulta ni se filtra nada,
  -- se entrega entera, y así añadir un campo no toca el esquema.
  datos    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admin (
  usuario    TEXT PRIMARY KEY,
  contrasena TEXT NOT NULL,
  creado     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sesion (
  id      TEXT PRIMARY KEY,
  usuario TEXT NOT NULL,
  caduca  TEXT NOT NULL
);
`;

export interface Grupo {
  id: string;
  nombre: string;
  creado: string;
}

export interface Aparato {
  id: string;
  grupoId: string | null;
  nombre: string | null;
  aparato: string | null;
  apodo: string | null;
  codigo: string | null;
  estado: 'pendiente' | 'aprobado' | 'activo' | 'revocado';
  pedido: string;
  ultima: string | null;
}

export interface Lista {
  id: string;
  grupoId: string;
  nombre: string;
  url: string;
}

function ahora(): string {
  return new Date().toISOString();
}

function enMinutos(minutos: number): string {
  return new Date(Date.now() + minutos * 60_000).toISOString();
}

/** Identificador legible a partir de un nombre: "Casa Triana" -> "casa-triana". */
export function idDesde(nombre: string): string {
  return (
    nombre
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'grupo'
  );
}

/** El SQLite de Node con la cara que espera `@m3u/storage/sincronizar`. */
export function comoBaseSQL(db: DatabaseSync): BaseSQL {
  return {
    filas: (sql, params = []) => db.prepare(sql).all(...(params as never[])) as Array<Record<string, unknown>>,
    ejecutar: (sql, params = []) => {
      // BEGIN y COMMIT no llevan parámetros y `prepare` los rechaza.
      if (params.length === 0) db.exec(sql);
      else db.prepare(sql).run(...(params as never[]));
    },
  };
}

export class Panel {
  #db: DatabaseSync;
  #carpeta: string;
  /** Las bases de cada grupo, abiertas según hacen falta. */
  #grupos = new Map<string, DatabaseSync>();

  constructor(carpeta: string) {
    mkdirSync(carpeta, { recursive: true });
    this.#carpeta = carpeta;
    this.#db = new DatabaseSync(join(carpeta, 'panel.sqlite'));
    this.#db.exec('PRAGMA journal_mode = WAL');
    this.#db.exec(ESQUEMA_PANEL);
  }

  cerrar(): void {
    for (const db of this.#grupos.values()) db.close();
    this.#grupos.clear();
    this.#db.close();
  }

  /** El último sello repartido, para que el siguiente sea siempre mayor. */
  #ultimoSello = '';

  /**
   * La hora de recepción con la que se sella una tanda.
   *
   * Tiene que ser **estrictamente creciente**. Dos tandas en el mismo
   * milisegundo llevarían el mismo sello, y un aparato que se quedara con esa
   * marca no volvería a ver la segunda: se pide "lo posterior", no "lo igual
   * o posterior". Adelantar un milisegundo cuando coinciden lo evita.
   */
  selloNuevo(): string {
    let sello = new Date().toISOString();
    if (sello <= this.#ultimoSello) {
      sello = new Date(new Date(this.#ultimoSello).getTime() + 1).toISOString();
    }
    this.#ultimoSello = sello;
    return sello;
  }

  #filas(sql: string, params: unknown[] = []): Array<Record<string, unknown>> {
    return this.#db.prepare(sql).all(...(params as never[])) as Array<Record<string, unknown>>;
  }

  #ejecutar(sql: string, params: unknown[] = []): void {
    this.#db.prepare(sql).run(...(params as never[]));
  }

  // --- La base de historial de cada grupo -----------------------------------

  /**
   * Abre —creándola si hace falta— la base de un grupo.
   *
   * Es el mismo esquema que el de los aparatos, punto por punto, para que el
   * código de sincronización sea literalmente el mismo a los dos lados.
   */
  baseDeGrupo(grupoId: string): BaseSQL {
    let db = this.#grupos.get(grupoId);
    if (!db) {
      db = new DatabaseSync(join(this.#carpeta, `grupo-${grupoId}.sqlite`));
      db.exec('PRAGMA journal_mode = WAL');
      db.exec(SCHEMA_PERFILES_SQL);

      // Las columnas añadidas después de la primera versión: en una base ya
      // creada no las pone `CREATE TABLE IF NOT EXISTS`.
      migrarTablasDePerfil({
        columnas: (tabla) =>
          (db!.prepare(`PRAGMA table_info(${tabla})`).all() as Array<{ name: string }>).map((fila) => fila.name),
        ejecutar: (sql) => db!.exec(sql),
      });

      for (const indice of INDICES_TRAS_MIGRAR_SQL) {
        // Los índices del catálogo no aplican aquí: solo existen las tablas de
        // perfil, así que se salta lo que hable de otras.
        if (/ON (profile|progress|favorite|profile_setting|affinity) /.test(indice)) db.exec(indice);
      }
      for (const relleno of RELLENOS_SQL) db.exec(relleno);

      // `recibido` es la única columna que el servidor tiene de más: cuándo
      // llegó cada fila, según su propio reloj. Los aparatos piden novedades
      // por aquí y no por la fecha del cambio, que es de quien lo hizo y
      // puede llegar con días de retraso. Está explicado en `Cambio.sello`.
      // La lista sale del esquema y no está escrita a mano: añadir una tabla
      // al reparto es una línea en `SINCRONIZADAS`, y aquí no hay que tocar.
      for (const { tabla } of SINCRONIZADAS) {
        const columnas = (db.prepare(`PRAGMA table_info(${tabla})`).all() as Array<{ name: string }>).map(
          (fila) => fila.name,
        );
        if (!columnas.includes('recibido')) db.exec(`ALTER TABLE ${tabla} ADD COLUMN recibido TEXT`);
        db.exec(`CREATE INDEX IF NOT EXISTS ${tabla}_por_recibido ON ${tabla} (recibido)`);
        // Lo que ya estuviera dentro se sella con su propia fecha de cambio,
        // que es lo más parecido que hay a cuándo llegó.
        db.exec(`UPDATE ${tabla} SET recibido = updated WHERE recibido IS NULL`);
      }

      this.#grupos.set(grupoId, db);
    }
    return comoBaseSQL(db);
  }

  // --- Grupos ---------------------------------------------------------------

  grupos(): Grupo[] {
    return this.#filas('SELECT id, nombre, creado FROM grupo ORDER BY nombre').map((fila) => ({
      id: fila.id as string,
      nombre: fila.nombre as string,
      creado: fila.creado as string,
    }));
  }

  grupo(id: string): Grupo | null {
    return this.grupos().find((grupo) => grupo.id === id) ?? null;
  }

  crearGrupo(nombre: string): Grupo {
    const base = idDesde(nombre);
    let id = base;
    let sufijo = 2;
    while (this.grupo(id)) id = `${base}-${sufijo++}`;

    const grupo: Grupo = { id, nombre: nombre.trim() || 'Grupo', creado: ahora() };
    this.#ejecutar('INSERT INTO grupo (id, nombre, creado) VALUES (?, ?, ?)', [
      grupo.id,
      grupo.nombre,
      grupo.creado,
    ]);
    return grupo;
  }

  // --- Aparatos -------------------------------------------------------------

  /**
   * Un aparato pide darse de alta y recibe dos cosas muy distintas.
   *
   * El **código** es corto y se enseña en pantalla para que lo teclees en el
   * panel: identifica la petición, y no vale para nada más. El **secreto de
   * espera** es largo, no se enseña nunca, y es con lo que el aparato pregunta
   * si ya lo has aprobado.
   *
   * Separarlos es lo que evita el agujero evidente: si el aparato preguntara
   * con el código corto, cualquiera que lo adivinara se llevaría el token.
   */
  pedirAlta(datos: { aparato?: string; apodo?: string }): { codigo: string; espera: string } {
    const codigo = codigoCorto();
    const espera = aleatorio();

    this.#ejecutar(
      `INSERT INTO aparato (id, grupo_id, nombre, aparato, apodo, codigo, espera, token, estado, pedido, caduca, ultima)
       VALUES (?, NULL, NULL, ?, ?, ?, ?, NULL, 'pendiente', ?, ?, NULL)`,
      [
        aleatorio(16),
        datos.aparato ?? null,
        datos.apodo ?? null,
        codigo,
        huella(espera),
        ahora(),
        enMinutos(CADUCIDAD_CODIGO_MINUTOS),
      ],
    );
    return { codigo, espera };
  }

  /** Los que están esperando tu visto bueno, sin contar los caducados. */
  pendientes(): Aparato[] {
    return this.#filas(
      "SELECT * FROM aparato WHERE estado = 'pendiente' AND caduca > ? ORDER BY pedido DESC",
      [ahora()],
    ).map(aAparato);
  }

  aparatosDe(grupoId: string): Aparato[] {
    return this.#filas(
      "SELECT * FROM aparato WHERE grupo_id = ? AND estado <> 'pendiente' ORDER BY nombre",
      [grupoId],
    ).map(aAparato);
  }

  /**
   * Le dices que sí a un aparato pendiente.
   *
   * Aquí **no se genera el token todavía**: se genera cuando el aparato venga
   * a recogerlo. Así el token en claro no llega a descansar en la base ni un
   * minuto, que es donde no debe estar.
   */
  aprobar(codigo: string, grupoId: string, nombre: string): boolean {
    const fila = this.#filas("SELECT id FROM aparato WHERE codigo = ? AND estado = 'pendiente' AND caduca > ?", [
      codigo.trim().toUpperCase(),
      ahora(),
    ])[0];
    if (!fila) return false;

    this.#ejecutar("UPDATE aparato SET estado = 'aprobado', grupo_id = ?, nombre = ? WHERE id = ?", [
      grupoId,
      nombre.trim() || 'Aparato',
      fila.id as string,
    ]);
    return true;
  }

  /**
   * El aparato pregunta si ya está, y si lo está se lleva su token.
   *
   * El token se devuelve **una sola vez**: de él solo queda la huella. Si el
   * aparato lo pierde —borrar datos, reinstalar— se vuelve a emparejar, que
   * es medio minuto, en vez de tener el servidor guardando tokens en claro
   * por si acaso.
   */
  recoger(espera: string): { token: string; aparato: Aparato } | 'pendiente' | null {
    const fila = this.#filas('SELECT * FROM aparato WHERE espera = ?', [huella(espera)])[0];
    if (!fila) return null;

    const aparato = aAparato(fila);
    if (aparato.estado === 'pendiente') return 'pendiente';
    if (aparato.estado !== 'aprobado') return null;

    const token = aleatorio();
    this.#ejecutar("UPDATE aparato SET estado = 'activo', token = ?, codigo = NULL, espera = NULL WHERE id = ?", [
      huella(token),
      aparato.id,
    ]);
    return { token, aparato: { ...aparato, estado: 'activo', codigo: null } };
  }

  /** Quién es el que trae este token, si es que sigue valiendo. */
  porToken(token: string): Aparato | null {
    const fila = this.#filas("SELECT * FROM aparato WHERE token = ? AND estado = 'activo'", [huella(token)])[0];
    return fila ? aAparato(fila) : null;
  }

  anotarSincronizacion(id: string): void {
    this.#ejecutar('UPDATE aparato SET ultima = ? WHERE id = ?', [ahora(), id]);
  }

  /**
   * Da de baja un aparato.
   *
   * No se borra la fila: queda con su nombre y su última sincronización, para
   * que dentro de tres meses sepas qué era "el que revoqué en agosto". Y sin
   * token, no vuelve a entrar.
   */
  /**
   * Le cambia el nombre a un aparato.
   *
   * El nombre no es decoración: es lo que ve la gente cuando la aplicación
   * dice "se ha parado porque has empezado a ver algo en TV Salón". Sin poder
   * cambiarlo, un aparato aprobado con prisa se queda para siempre llamándose
   * como su código de emparejamiento.
   */
  renombrarAparato(id: string, nombre: string): void {
    this.#ejecutar('UPDATE aparato SET nombre = ? WHERE id = ?', [nombre.trim() || 'Aparato', id]);
  }

  revocar(id: string): void {
    this.#ejecutar("UPDATE aparato SET estado = 'revocado', token = NULL, espera = NULL WHERE id = ?", [id]);
  }

  // --- Portadas -------------------------------------------------------------

  /** Guarda las sugerencias preparadas de una lista. */
  guardarPortadas(listaId: string, datos: unknown): void {
    this.#ejecutar(
      `INSERT INTO portada (lista_id, generado, datos) VALUES (?, ?, ?)
       ON CONFLICT(lista_id) DO UPDATE SET generado = excluded.generado, datos = excluded.datos`,
      [listaId, ahora(), JSON.stringify(datos)],
    );
  }

  /** Lo preparado para una lista, o `null` si aún no se ha preparado nada. */
  portadasDe(listaId: string): { generado: string; datos: unknown } | null {
    const fila = this.#filas('SELECT generado, datos FROM portada WHERE lista_id = ?', [listaId])[0];
    if (!fila) return null;
    try {
      return { generado: fila.generado as string, datos: JSON.parse(fila.datos as string) };
    } catch {
      return null;
    }
  }

  /** Todas las listas del servidor, para el trabajo diario. */
  listasTodas(): Lista[] {
    return this.#filas('SELECT id, grupo_id, nombre, url FROM lista ORDER BY id').map((fila) => ({
      id: fila.id as string,
      grupoId: fila.grupo_id as string,
      nombre: fila.nombre as string,
      url: fila.url as string,
    }));
  }

  // --- Listas ---------------------------------------------------------------

  listasDe(grupoId: string): Lista[] {
    return this.#filas('SELECT id, grupo_id, nombre, url FROM lista WHERE grupo_id = ? ORDER BY nombre', [
      grupoId,
    ]).map((fila) => ({
      id: fila.id as string,
      grupoId: fila.grupo_id as string,
      nombre: fila.nombre as string,
      url: fila.url as string,
    }));
  }

  guardarLista(grupoId: string, nombre: string, url: string, id?: string): void {
    if (id) {
      this.#ejecutar('UPDATE lista SET nombre = ?, url = ? WHERE id = ? AND grupo_id = ?', [
        nombre.trim(),
        url.trim(),
        id,
        grupoId,
      ]);
      return;
    }
    this.#ejecutar('INSERT INTO lista (id, grupo_id, nombre, url, creado) VALUES (?, ?, ?, ?, ?)', [
      aleatorio(16),
      grupoId,
      nombre.trim() || 'Lista',
      url.trim(),
      ahora(),
    ]);
  }

  borrarLista(id: string): void {
    this.#ejecutar('DELETE FROM lista WHERE id = ?', [id]);
  }

  // --- Tu acceso a la web ---------------------------------------------------

  hayAdmin(): boolean {
    return this.#filas('SELECT usuario FROM admin LIMIT 1').length > 0;
  }

  crearAdmin(usuario: string, contrasena: string): void {
    this.#ejecutar(
      `INSERT INTO admin (usuario, contrasena, creado) VALUES (?, ?, ?)
       ON CONFLICT(usuario) DO UPDATE SET contrasena = excluded.contrasena`,
      [usuario.trim().toLowerCase(), cifrarContrasena(contrasena), ahora()],
    );
  }

  /** Comprueba usuario y contraseña y devuelve la cookie de sesión. */
  entrar(usuario: string, contrasena: string): string | null {
    const fila = this.#filas('SELECT contrasena FROM admin WHERE usuario = ?', [usuario.trim().toLowerCase()])[0];
    // Se comprueba igualmente contra un resumen inventado cuando el usuario no
    // existe: si no, el "no existe" responde al instante y el "contraseña mal"
    // tarda, y esa diferencia ya dice qué usuarios hay.
    const guardado = (fila?.contrasena as string) ?? cifrarContrasena(aleatorio());
    if (!compruebaContrasena(contrasena, guardado) || !fila) return null;

    const cookie = aleatorio();
    this.#ejecutar('INSERT INTO sesion (id, usuario, caduca) VALUES (?, ?, ?)', [
      huella(cookie),
      usuario.trim().toLowerCase(),
      enMinutos(CADUCIDAD_SESION_DIAS * 24 * 60),
    ]);
    return cookie;
  }

  sesion(cookie: string): string | null {
    const fila = this.#filas('SELECT usuario FROM sesion WHERE id = ? AND caduca > ?', [huella(cookie), ahora()])[0];
    return fila ? (fila.usuario as string) : null;
  }

  salir(cookie: string): void {
    this.#ejecutar('DELETE FROM sesion WHERE id = ?', [huella(cookie)]);
  }
}

function aAparato(fila: Record<string, unknown>): Aparato {
  return {
    id: fila.id as string,
    grupoId: (fila.grupo_id ?? null) as string | null,
    nombre: (fila.nombre ?? null) as string | null,
    aparato: (fila.aparato ?? null) as string | null,
    apodo: (fila.apodo ?? null) as string | null,
    codigo: (fila.codigo ?? null) as string | null,
    estado: fila.estado as Aparato['estado'],
    pedido: fila.pedido as string,
    ultima: (fila.ultima ?? null) as string | null,
  };
}
