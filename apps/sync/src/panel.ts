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

-- La programación del directo, del EPG completo del panel (xmltv.php).
--
-- Aquí sí van columnas y no un JSON como en la tabla portada: lo que se
-- entrega no es la tabla entera sino "qué echan ahora", que cambia cada minuto
-- y hay que consultarlo por hora. Guardarlo en un JSON obligaría a leer y
-- analizar los 11.515 programas de la lista en cada petición.
--
-- El canal es el identificador del XMLTV, que es el tvg-id del aparato:
-- comprobado contra la lista real, casan 191 de 191.
CREATE TABLE IF NOT EXISTS programa (
  lista_id TEXT NOT NULL,
  canal    TEXT NOT NULL,
  -- En ISO y en UTC, que es como se comparan sin depender del huso de nadie.
  desde    TEXT NOT NULL,
  hasta    TEXT NOT NULL,
  titulo   TEXT NOT NULL,
  sinopsis TEXT
);
-- Por canal y hora, que es como se pregunta: "lo de este canal a partir de ahora".
CREATE INDEX IF NOT EXISTS programa_por_canal ON programa (lista_id, canal, desde);

-- La ficha larga de cada película y cada serie: género, sinopsis, reparto,
-- imagen apaisada y tráiler. El catálogo del panel no trae nada de esto —da
-- título, cartel, nota y año— y preguntarlo cuesta una petición por título,
-- así que se rellena poco a poco y se guarda para siempre.
--
-- Se apunta también lo que nadie supo contestar, con los campos vacíos: si no,
-- cada pasada volvería sobre las mismas y no avanzaría nunca. Eso es lo que
-- marca la columna completa, que quiere decir "ya se preguntó", no "salió
-- con datos".
--
-- El sello es la hora de la pasada en milisegundos: es por donde el aparato
-- pide "lo que no tengo", en vez de bajarse las 24.000 en cada arranque. Que
-- sea una hora y no un contador ahorra una tabla —de ahí sale también cuándo
-- fue la última pasada— y vale como marca de agua entre listas distintas,
-- porque el reloj es el mismo para todas.
CREATE TABLE IF NOT EXISTS ficha (
  lista_id TEXT NOT NULL,
  item_id  TEXT NOT NULL,
  clase    TEXT NOT NULL,
  genero   TEXT NOT NULL,
  sinopsis TEXT,
  reparto  TEXT,
  -- La imagen apaisada, ya como URL entera: el aparato no tiene por qué saber
  -- cómo monta TMDb las direcciones de sus imágenes.
  fondo    TEXT,
  -- El identificador de YouTube, que es lo que abre la aplicación por fuera.
  trailer  TEXT,
  completa INTEGER NOT NULL DEFAULT 0,
  sello    INTEGER NOT NULL,
  PRIMARY KEY (lista_id, item_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS ficha_por_sello ON ficha (lista_id, sello);

-- La tabla anterior, que solo guardaba el género. Se tira: lo que tenía hay
-- que volver a preguntarlo de todas formas —ahora se pide también la sinopsis,
-- el reparto y el fondo—, y dejarla ahí sería tener dos sitios donde mirar. Es
-- una caché: se vuelve a llenar sola.
DROP TABLE IF EXISTS genero;

-- Cuándo se trajo la parrilla de cada lista, para saber si toca rehacerla.
CREATE TABLE IF NOT EXISTS parrilla (
  lista_id TEXT PRIMARY KEY,
  generado TEXT NOT NULL,
  canales  INTEGER NOT NULL,
  programas INTEGER NOT NULL
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

/**
 * Un programa tal como se guarda y se entrega.
 *
 * Las horas van en texto ISO y no como `Date`: es lo que entra en SQLite, lo
 * que viaja por JSON y lo que el aparato vuelve a convertir con su propio
 * huso. Convertirlas aquí a hora local sería decidir por él.
 */
/**
 * La ficha larga de una película o una serie, tal como se guarda y se entrega.
 *
 * El género va como cadena —vacía si no se sabe— y lo demás como opcional: la
 * diferencia importa al guardar, porque lo que llega sin valor no pisa lo que
 * ya hubiera.
 */
export interface FichaGuardada {
  id: string;
  clase: 'pelicula' | 'serie';
  genero: string;
  sinopsis?: string;
  reparto?: string;
  fondo?: string;
  trailer?: string;
  /** La nota de TMDb, sus votos y su popularidad. La del panel está inflada. */
  nota?: number;
  votos?: number;
  popularidad?: number;
}

export interface ProgramaGuardado {
  canal: string;
  desde: string;
  hasta: string;
  titulo: string;
  sinopsis: string | null;
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
    this.#migrarFicha();
  }

  /**
   * Las columnas que se añadieron después de crear la tabla `ficha`.
   *
   * `CREATE TABLE IF NOT EXISTS` no toca una tabla que ya existe, así que en un
   * servidor que lleve días funcionando estas columnas no aparecerían y la
   * siguiente pasada reventaría con "no such column".
   *
   * Y al añadirlas se **borra la marca de preguntado**: todo lo que hubiera se
   * averiguó sin ellas, así que hay que volver a pasar. Va aquí dentro y no
   * fuera porque solo ocurre la vez que la columna se crea; puesto fuera, cada
   * arranque mandaría a repreguntar el catálogo entero.
   */
  #migrarFicha(): void {
    const existentes = new Set(
      this.#filas('PRAGMA table_info(ficha)').map((fila) => fila.name as string),
    );

    const nuevas = [
      { columna: 'nota', tipo: 'REAL' },
      { columna: 'votos', tipo: 'INTEGER' },
      { columna: 'popularidad', tipo: 'REAL' },
    ].filter(({ columna }) => !existentes.has(columna));

    if (nuevas.length === 0) return;

    for (const { columna, tipo } of nuevas) {
      this.#db.exec(`ALTER TABLE ficha ADD COLUMN ${columna} ${tipo}`);
      console.log(`[panel] columna añadida: ficha.${columna}`);
    }

    this.#ejecutar('UPDATE ficha SET completa = 0', []);
    console.log('[panel] las fichas se vuelven a preguntar: les falta la nota de TMDb');
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

  // --- Parrilla del directo -------------------------------------------------

  /**
   * Guarda la parrilla de una lista, reemplazando la que hubiera.
   *
   * Se borra y se vuelve a escribir entera en una transacción: no hay nada que
   * fusionar —el panel manda la verdad completa cada vez— y así no quedan
   * programas viejos de un canal que ya no venga. Esto **no** es el historial:
   * aquí no hay lápidas que valgan, es una copia de lo que dice el panel.
   */
  guardarParrilla(listaId: string, programas: ProgramaGuardado[]): void {
    // BEGIN y COMMIT no llevan parámetros y `prepare` los rechaza: van por
    // `exec`, como en `comoBaseSQL`.
    this.#db.exec('BEGIN');
    try {
      this.#ejecutar('DELETE FROM programa WHERE lista_id = ?', [listaId]);
      for (const uno of programas) {
        this.#ejecutar(
          'INSERT INTO programa (lista_id, canal, desde, hasta, titulo, sinopsis) VALUES (?, ?, ?, ?, ?, ?)',
          [listaId, uno.canal, uno.desde, uno.hasta, uno.titulo, uno.sinopsis],
        );
      }
      const canales = new Set(programas.map((uno) => uno.canal)).size;
      this.#ejecutar(
        `INSERT INTO parrilla (lista_id, generado, canales, programas) VALUES (?, ?, ?, ?)
         ON CONFLICT(lista_id) DO UPDATE SET generado = excluded.generado,
           canales = excluded.canales, programas = excluded.programas`,
        [listaId, ahora(), canales, programas.length],
      );
      this.#db.exec('COMMIT');
    } catch (fallo) {
      this.#db.exec('ROLLBACK');
      throw fallo;
    }
  }

  /** Cuándo se trajo la parrilla de una lista, o `null` si nunca. */
  parrillaDe(listaId: string): { generado: string; canales: number; programas: number } | null {
    const fila = this.#filas('SELECT generado, canales, programas FROM parrilla WHERE lista_id = ?', [
      listaId,
    ])[0];
    if (!fila) return null;
    return {
      generado: fila.generado as string,
      canales: Number(fila.canales),
      programas: Number(fila.programas),
    };
  }

  /**
   * Lo que echan ahora en cada canal de una lista, y lo que viene después.
   *
   * Dos filas por canal y no la parrilla entera: es lo que cabe en la ficha de
   * un canal, y lo que hace que la respuesta sean decenas de kilobytes en vez
   * de megas. Lo que ya terminó no se manda: para eso está la hora.
   */
  loQueEchan(listaId: string, desde: string, porCanal = 2): ProgramaGuardado[] {
    const filas = this.#filas(
      `SELECT canal, desde, hasta, titulo, sinopsis FROM programa
       WHERE lista_id = ? AND hasta > ?
       ORDER BY canal, desde`,
      [listaId, desde],
    );

    // El recorte por canal se hace aquí y no en SQL: SQLite no tiene funciones
    // de ventana en todas las compilaciones y esto son unos cientos de filas.
    const salida: ProgramaGuardado[] = [];
    let canal = '';
    let cuantos = 0;
    for (const fila of filas) {
      if (fila.canal !== canal) {
        canal = fila.canal as string;
        cuantos = 0;
      }
      if (cuantos >= porCanal) continue;
      cuantos += 1;
      salida.push({
        canal: fila.canal as string,
        desde: fila.desde as string,
        hasta: fila.hasta as string,
        titulo: fila.titulo as string,
        sinopsis: (fila.sinopsis ?? null) as string | null,
      });
    }
    return salida;
  }

  // --- Géneros ---------------------------------------------------------------

  /** Lo ya preguntado de una lista, con género o sin él. */
  fichasConocidas(listaId: string): Set<string> {
    return new Set(
      this.#filas('SELECT item_id FROM ficha WHERE lista_id = ? AND completa = 1', [listaId]).map(
        (fila) => fila.item_id as string,
      ),
    );
  }

  /**
   * Guarda lo averiguado. Todo lo de una pasada comparte sello.
   *
   * Al aparato le da igual el orden dentro de una tanda: lo que necesita es
   * poder decir "dame lo posterior a esto", y para eso basta un número por
   * pasada.
   */
  guardarFichas(listaId: string, fichas: FichaGuardada[], sello = Date.now()): void {
    if (fichas.length === 0) return;

    this.#db.exec('BEGIN');
    try {
      for (const ficha of fichas) {
        /*
          Lo que venga vacío **no borra lo que ya había**. Una fila puede traer
          el género del panel de una pasada anterior y que TMDb no conozca la
          película: quedarse sin género por haber preguntado otra vez sería ir
          para atrás.
        */
        this.#ejecutar(
          `INSERT INTO ficha
                (lista_id, item_id, clase, genero, sinopsis, reparto, fondo, trailer,
                 nota, votos, popularidad, completa, sello)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
           ON CONFLICT(lista_id, item_id) DO UPDATE SET
             clase    = excluded.clase,
             genero   = CASE WHEN excluded.genero <> '' THEN excluded.genero ELSE ficha.genero END,
             sinopsis = COALESCE(excluded.sinopsis, ficha.sinopsis),
             reparto  = COALESCE(excluded.reparto, ficha.reparto),
             fondo    = COALESCE(excluded.fondo, ficha.fondo),
             trailer  = COALESCE(excluded.trailer, ficha.trailer),
             nota     = COALESCE(excluded.nota, ficha.nota),
             votos    = COALESCE(excluded.votos, ficha.votos),
             popularidad = COALESCE(excluded.popularidad, ficha.popularidad),
             completa = 1,
             sello    = excluded.sello`,
          [
            listaId,
            ficha.id,
            ficha.clase,
            ficha.genero,
            ficha.sinopsis ?? null,
            ficha.reparto ?? null,
            ficha.fondo ?? null,
            ficha.trailer ?? null,
            ficha.nota ?? null,
            ficha.votos ?? null,
            ficha.popularidad ?? null,
            sello,
          ],
        );
      }
      this.#db.exec('COMMIT');
    } catch (fallo) {
      this.#db.exec('ROLLBACK');
      throw fallo;
    }
  }

  /**
   * Cuántas se han preguntado ya y cuándo fue la última pasada.
   *
   * Lo de "cuándo" sale del propio sello, que es la hora en milisegundos: por
   * eso no hace falta una tabla aparte para llevar la cuenta del trabajo.
   */
  cuantasFichas(listaId: string): { preguntadas: number; conGenero: number; ultima: number } {
    const fila = this.#filas(
      `SELECT SUM(completa) AS todas,
              SUM(CASE WHEN genero <> '' THEN 1 ELSE 0 END) AS llenas,
              MAX(sello) AS ultima
         FROM ficha WHERE lista_id = ?`,
      [listaId],
    )[0];
    return {
      preguntadas: Number(fila?.todas ?? 0),
      conGenero: Number(fila?.llenas ?? 0),
      ultima: Number(fila?.ultima ?? 0),
    };
  }

  /**
   * Lo averiguado después de un sello, para que el aparato pida solo lo nuevo.
   *
   * Solo lo que trae algo: lo que nadie supo contestar se guarda aquí para no
   * volver a preguntarlo, pero al aparato no le sirve de nada.
   */
  fichasDesde(listaId: string, desde: number, limite: number): { fichas: FichaGuardada[]; hasta: number } {
    const filas = this.#filas(
      `SELECT item_id, clase, genero, sinopsis, reparto, fondo, trailer, nota, votos, popularidad, sello
         FROM ficha
        WHERE lista_id = ? AND sello > ?
          AND (genero <> '' OR sinopsis IS NOT NULL OR fondo IS NOT NULL OR trailer IS NOT NULL
               OR nota IS NOT NULL)
        ORDER BY sello, item_id LIMIT ?`,
      [listaId, desde, limite],
    );

    return {
      fichas: filas.map((fila) => ({
        id: fila.item_id as string,
        clase: fila.clase as FichaGuardada['clase'],
        genero: fila.genero as string,
        sinopsis: (fila.sinopsis as string | null) ?? undefined,
        reparto: (fila.reparto as string | null) ?? undefined,
        fondo: (fila.fondo as string | null) ?? undefined,
        trailer: (fila.trailer as string | null) ?? undefined,
        nota: (fila.nota as number | null) ?? undefined,
        votos: (fila.votos as number | null) ?? undefined,
        popularidad: (fila.popularidad as number | null) ?? undefined,
      })),
      hasta: filas.reduce((alto, fila) => Math.max(alto, Number(fila.sello)), desde),
    };
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
