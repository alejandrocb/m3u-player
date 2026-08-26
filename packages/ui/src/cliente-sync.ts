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
      grupo?: { id: string; nombre: string } | null;
      listas?: ListaRemota[];
    };
    if (datos.estado !== 'aprobado' || !datos.token) return { estado: 'pendiente' };

    await this.#almacen.guardar({
      servidor: limpiar(servidor),
      token: datos.token,
      grupo: datos.grupo ?? null,
      // Desde cero las dos: un aparato recién emparejado se trae todo lo que
      // haya en su casa y sube todo lo que tuviera guardado.
      subida: '',
      bajada: '',
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

    const datos = (await respuesta.json()) as { cambios?: Cambio[]; marca?: string };
    const suyos = datos.cambios ?? [];
    if (suyos.length > 0) await this.#perfiles.aplicarCambios(suyos);

    await this.#almacen.guardar({
      ...estado,
      // La marca de subida se calcula con lo que se mandó, no con la
      // respuesta: son escalas distintas.
      subida: marcaTras(estado.subida, mios),
      bajada: datos.marca ?? marcaTras(estado.bajada, suyos),
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

  /** Deja de sincronizar. Lo guardado en el aparato se queda como está. */
  async olvidar(): Promise<void> {
    await this.#almacen.olvidar();
  }
}
