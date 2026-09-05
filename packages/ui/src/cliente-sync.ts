/**
 * El lado del aparato: emparejarse y sincronizar.
 *
 * Vive aquí, sin nada de plataforma, por lo de siempre: la tele, la tablet y
 * el escritorio hacen exactamente esto y solo cambia dónde se guarda el token
 * —el llavero de Android, `safeStorage` en Electron—, que entra por el puerto
 * `AlmacenSync`.
 *
 * Sincronizar **nunca bloquea la interfaz ni es imprescindible**: si el
 * servidor no contesta, la app funciona igual con lo que tiene y lo pendiente
 * sube la próxima vez. Es la misma decisión que con el catálogo.
 */

import type { Cambio } from './sincronizacion.ts';
import { marcaTras } from './sincronizacion.ts';

/** Lo que se guarda del emparejamiento. Va al llavero: lleva el token. */
export interface EstadoSync {
  servidor: string;
  token: string;
  grupo: { id: string; nombre: string } | null;
  /**
   * Cómo se llama este aparato en la casa: "TV Salón".
   *
   * Se lo pone quien lo aprueba en la web, y hace falta para poder decir en
   * los demás **dónde** ha empezado a ver algo esta persona.
   */
  aparato?: string;
  /**
   * Hasta dónde se ha subido, en fechas de cambio **de este aparato**.
   *
   * Son dos marcas y no una porque están en escalas distintas: lo que queda
   * por subir se mide con el reloj de aquí, y lo que queda por bajar con el
   * sello de recepción del servidor. Mezclarlas se traga cambios enteros —lo
   * cuenta `Cambio.sello`—.
   */
  subida: string;
  /** Hasta dónde se ha bajado, en sellos del servidor. */
  bajada: string;
  /**
   * Recién emparejado: este aparato todavía tiene que adoptar los perfiles
   * de la casa.
   *
   * Se pone al aprobar el alta y lo quita la aplicación cuando ya ha vaciado
   * los suyos. Va en el estado y no en una variable porque entre una cosa y
   * otra puede cerrarse la aplicación: emparejar se hace en la pantalla de
   * listas y los perfiles no se abren hasta conectar con una.
   */
  adoptar?: boolean;
}

export interface AlmacenSync {
  leer(): Promise<EstadoSync | null>;
  guardar(estado: EstadoSync): Promise<void>;
  olvidar(): Promise<void>;
}

/** Una lista que reparte el servidor, ya con sus credenciales dentro. */
export interface ListaRemota {
  id: string;
  nombre: string;
  url: string;
}

export interface Alta {
  /** El código corto que se enseña en pantalla para que lo apruebes. */
  codigo: string;
  /** El secreto largo con el que se pregunta. No se enseña nunca. */
  espera: string;
}

export type Espera =
  | { estado: 'pendiente' }
  | { estado: 'aprobado'; grupo: { id: string; nombre: string } | null; listas: ListaRemota[] }
  | { estado: 'desconocido' };

/** Lo justo de `fetch` que hace falta, para poder probarlo sin red. */
export interface RespuestaHttp {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type Buscar = (
  url: string,
  opciones: { method: string; headers: Record<string, string>; body?: string },
) => Promise<RespuestaHttp>;

/** Lo que el cliente necesita del almacén de perfiles, y nada más. */
export interface FuenteDeCambios {
  cambiosDesde(marca: string): Promise<Cambio[]>;
  aplicarCambios(cambios: Cambio[]): Promise<void>;
}

/** El servidor ya no reconoce a este aparato: lo has revocado, o se reinstaló. */
export class AparatoRevocado extends Error {
  constructor() {
    super('el servidor ya no reconoce este aparato');
    this.name = 'AparatoRevocado';
  }
}

/** Quita la barra final para no acabar pidiendo a `//api/sync`. */
function limpiar(servidor: string): string {
  return servidor.trim().replace(/\/+$/, '');
}

/**
 * Una sugerencia del inicio tal y como la manda el servidor.
 *
 * El identificador es el que calcula también el aparato al importar, así que
 * sirve para buscar la ficha en la base y reproducirla. Si no estuviera —una
 * lista distinta, un catálogo sin refrescar—, la sugerencia se descarta.
 */
export interface PortadaRemota {
  clase: 'pelicula' | 'serie';
  id: string;
  titulo: string;
  anio: number | null;
  valoracion: number | null;
  /** Apaisada y ya comprobada en el servidor. */
  imagen: string;
  sinopsis: string | null;
  reparto: string | null;
  genero: string | null;
}

/**
 * El género de una película, que el catálogo del panel no trae.
 *
 * Lo averigua el servidor en su pasada diaria, para las que llenan el inicio.
 * El aparato lo guarda en su base y desde entonces sale en la carátula.
 */
export interface GeneroRemoto {
  id: string;
  genero: string;
}

/** Todo lo que el servidor prepara para el inicio. */
export interface Preparado {
  portadas: PortadaRemota[];
  generos: GeneroRemoto[];
}

/**
 * La ficha larga que prepara el servidor, para el catálogo entero.
 *
 * Es lo mismo que da `get_vod_info` del panel, pero averiguado una vez por
 * casa y no una vez por aparato y arranque: género, sinopsis, reparto, la
 * imagen apaisada y el identificador del tráiler de YouTube.
 *
 * Todo puede faltar. Lo que llegue vacío no pisa lo que el aparato ya tuviera.
 */
export interface FichaRemota {
  id: string;
  clase: 'pelicula' | 'serie';
  genero: string;
  sinopsis?: string;
  reparto?: string;
  fondo?: string;
  trailer?: string;
}

/** Lo que el servidor lleva averiguado desde la última vez que se preguntó. */
export interface FichasNuevas {
  fichas: FichaRemota[];
  /** Hasta dónde se ha leído. Se guarda y se manda en la siguiente. */
  hasta: number;
}

/**
 * Un programa de la parrilla que prepara el servidor.
 *
 * El canal es el `tvg-id`, que es el identificador con el que el aparato tiene
 * guardado ese canal: comprobado contra la lista real, los del EPG del panel
 * casan 191 de 191. Las horas vienen en ISO y en UTC, y las convierte a la
 * hora local quien las pinta.
 */
export interface ProgramaRemoto {
  canal: string;
  desde: string;
  hasta: string;
  titulo: string;
  sinopsis: string | null;
}

export class ClienteSync {
  #almacen: AlmacenSync;
  #perfiles: FuenteDeCambios;
  #buscar: Buscar;

  constructor(opciones: { almacen: AlmacenSync; perfiles: FuenteDeCambios; buscar: Buscar }) {
    this.#almacen = opciones.almacen;
    this.#perfiles = opciones.perfiles;
    this.#buscar = opciones.buscar;
  }

  async #pedir(servidor: string, ruta: string, cuerpo: unknown, token?: string): Promise<RespuestaHttp> {
    const cabeceras: Record<string, string> = { 'content-type': 'application/json' };
    // En la cabecera, nunca en la dirección: lo que va en la URL acaba en los
    // registros del servidor y en cualquier intermediario.
    if (token) cabeceras.authorization = `Bearer ${token}`;

    return this.#buscar(`${limpiar(servidor)}${ruta}`, {
      method: 'POST',
      headers: cabeceras,
      body: JSON.stringify(cuerpo),
    });
  }

  /** ¿Está este aparato emparejado? */
  async estado(): Promise<EstadoSync | null> {
    return this.#almacen.leer();
  }

  /** Pide un código para que lo apruebes en la web. */
  async pedirAlta(servidor: string, apodo?: string, aparato?: string): Promise<Alta> {
    const respuesta = await this.#pedir(servidor, '/api/alta', { apodo, aparato });
    if (!respuesta.ok) throw new Error(`el servidor respondió ${respuesta.status}`);

    const datos = (await respuesta.json()) as Partial<Alta>;
    if (!datos.codigo || !datos.espera) throw new Error('el servidor no devolvió un código');
    return { codigo: datos.codigo, espera: datos.espera };
  }

  /**
   * Pregunta si ya lo has aprobado y, si es que sí, guarda el token.
   *
   * Se llama en bucle mientras se enseña el código. La primera vez que
   * responde "aprobado" es la única que trae el token: de ahí en adelante el
   * servidor solo guarda su huella.
   */
  async comprobar(servidor: string, espera: string): Promise<Espera> {
    const respuesta = await this.#pedir(servidor, '/api/espera', { espera });
    if (respuesta.status === 404) return { estado: 'desconocido' };
    if (!respuesta.ok) throw new Error(`el servidor respondió ${respuesta.status}`);

    const datos = (await respuesta.json()) as {
      estado?: string;
      token?: string;
      aparato?: { id: string; nombre: string | null };
      grupo?: { id: string; nombre: string } | null;
      listas?: ListaRemota[];
    };
    if (datos.estado !== 'aprobado' || !datos.token) return { estado: 'pendiente' };

    await this.#almacen.guardar({
      servidor: limpiar(servidor),
      token: datos.token,
      grupo: datos.grupo ?? null,
      aparato: datos.aparato?.nombre ?? undefined,
      // Desde cero las dos: un aparato recién emparejado se trae todo lo que
      // haya en su casa.
      subida: '',
      bajada: '',
      // Y lo suyo lo tira: los perfiles son de la casa.
      adoptar: true,
    });

    return { estado: 'aprobado', grupo: datos.grupo ?? null, listas: datos.listas ?? [] };
  }

  /**
   * Sube lo que se ha cambiado aquí y baja lo que hayan cambiado los demás.
   *
   * Devuelve `null` si el aparato no está emparejado, que no es un fallo:
   * simplemente esta casa no usa servidor.
   */
  async sincronizar(): Promise<{ subidos: number; bajados: number } | null> {
    const estado = await this.#almacen.leer();
    if (!estado) return null;

    const mios = await this.#perfiles.cambiosDesde(estado.subida);
    const respuesta = await this.#pedir(estado.servidor, '/api/sync', {
      desde: estado.bajada,
      cambios: mios,
    }, estado.token);

    // Un 401 aquí significa que el token ya no vale. No tiene arreglo
    // reintentando: se olvida el emparejamiento y la app volverá a pedir uno.
    if (respuesta.status === 401) {
      await this.#almacen.olvidar();
      throw new AparatoRevocado();
    }
    if (!respuesta.ok) throw new Error(`el servidor respondió ${respuesta.status}`);

    const datos = (await respuesta.json()) as { cambios?: Cambio[]; marca?: string; aparato?: string | null };
    const suyos = datos.cambios ?? [];
    if (suyos.length > 0) await this.#perfiles.aplicarCambios(suyos);

    await this.#almacen.guardar({
      ...estado,
      // La marca de subida se calcula con lo que se mandó, no con la
      // respuesta: son escalas distintas.
      subida: marcaTras(estado.subida, mios),
      bajada: datos.marca ?? marcaTras(estado.bajada, suyos),
      // El servidor recuerda en cada vuelta cómo se llama este aparato: así
      // lo aprenden también los que se emparejaron antes de que hiciera falta.
      aparato: datos.aparato ?? estado.aparato,
    });

    return { subidos: mios.length, bajados: suyos.length };
  }

  /** Las listas del grupo, por si han cambiado desde el emparejamiento. */
  async listas(): Promise<ListaRemota[]> {
    const estado = await this.#almacen.leer();
    if (!estado) return [];

    const respuesta = await this.#buscar(`${estado.servidor}/api/listas`, {
      method: 'GET',
      headers: { authorization: `Bearer ${estado.token}` },
    });
    if (respuesta.status === 401) {
      await this.#almacen.olvidar();
      throw new AparatoRevocado();
    }
    if (!respuesta.ok) return [];

    const datos = (await respuesta.json()) as { listas?: ListaRemota[] };
    return datos.listas ?? [];
  }

  /**
   * Las sugerencias del inicio, preparadas por el servidor.
   *
   * Es un acelerador, no un requisito: si el servidor no contesta o no ha
   * preparado nada todavía, se devuelve la lista vacía y el aparato saca las
   * suyas preguntando al panel, como cuando no hay servidor ninguno.
   */
  async portadas(): Promise<Preparado> {
    const vacio: Preparado = { portadas: [], generos: [] };
    const estado = await this.#almacen.leer();
    if (!estado) return vacio;

    try {
      const respuesta = await this.#buscar(`${estado.servidor}/api/portadas`, {
        method: 'GET',
        headers: { authorization: `Bearer ${estado.token}` },
      });
      if (!respuesta.ok) return vacio;

      const datos = (await respuesta.json()) as Partial<Preparado>;
      return {
        portadas: Array.isArray(datos.portadas) ? datos.portadas : [],
        generos: Array.isArray(datos.generos) ? datos.generos : [],
      };
    } catch {
      // Sin red, el inicio sale igual. Que esto no impida arrancar.
      return vacio;
    }
  }

  /**
   * Las fichas que el servidor ha ido averiguando, desde una marca de agua.
   *
   * El catálogo del panel no trae ni el género ni la sinopsis, y preguntarlo
   * es una petición por título: el servidor lo va rellenando y aquí se recoge.
   * Por eso se pide "lo posterior a esto" y no todo, y por eso quien llama
   * vuelve a pedir mientras las respuestas lleguen llenas: con la sinopsis
   * dentro, las 24.000 no caben en una.
   *
   * Como el resto de lo que prepara el servidor, esto acelera y no sostiene:
   * sin respuesta, las fichas salen con lo que traiga el catálogo y ya está.
   */
  async fichas(desde: number): Promise<FichasNuevas> {
    const vacio: FichasNuevas = { fichas: [], hasta: desde };
    const estado = await this.#almacen.leer();
    if (!estado) return vacio;

    try {
      const respuesta = await this.#buscar(`${estado.servidor}/api/fichas?desde=${desde}`, {
        method: 'GET',
        headers: { authorization: `Bearer ${estado.token}` },
      });
      if (!respuesta.ok) return vacio;

      const datos = (await respuesta.json()) as Partial<FichasNuevas>;
      return {
        fichas: Array.isArray(datos.fichas) ? datos.fichas : [],
        hasta: Number(datos.hasta) || desde,
      };
    } catch {
      return vacio;
    }
  }

  /**
   * Lo que echan ahora en el directo, según la parrilla del servidor.
   *
   * El servidor se trae el EPG entero del panel —5,5 MB, una petición al
   * día— y de ahí manda solo el resumen: dos programas por canal, el de ahora
   * y el siguiente. Al aparato le llegan decenas de kilobytes en una sola
   * petición, en vez de una por canal cada vez que el foco se para.
   *
   * Como todo lo que prepara el servidor, es un acelerador y no un requisito:
   * sin respuesta se devuelve vacío y la programación se pide al panel canal a
   * canal, que es lo que se hacía antes de que existiera esto.
   */
  async epg(): Promise<ProgramaRemoto[]> {
    const estado = await this.#almacen.leer();
    if (!estado) return [];

    try {
      const respuesta = await this.#buscar(`${estado.servidor}/api/epg`, {
        method: 'GET',
        headers: { authorization: `Bearer ${estado.token}` },
      });
      if (!respuesta.ok) return [];

      const datos = (await respuesta.json()) as { programas?: ProgramaRemoto[] };
      return Array.isArray(datos.programas) ? datos.programas : [];
    } catch {
      // Sin red, el directo sigue funcionando: solo se queda sin parrilla.
      return [];
    }
  }

  /** Ya se han vaciado los perfiles locales: no hay que volver a hacerlo. */
  async adoptado(): Promise<void> {
    const estado = await this.#almacen.leer();
    if (!estado?.adoptar) return;
    await this.#almacen.guardar({ ...estado, adoptar: false });
  }

  /** Deja de sincronizar. Lo guardado en el aparato se queda como está. */
  async olvidar(): Promise<void> {
    await this.#almacen.olvidar();
  }
}
