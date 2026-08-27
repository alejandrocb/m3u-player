/**
 * Perfiles, historial y favoritos.
 *
 * Cada perfil tiene su "seguir viendo" y sus favoritos, como en cualquier
 * servicio de estos: en una casa no ve lo mismo cada uno, y compartir el
 * historial hace que la lista de "continuar" no sirva para nadie.
 *
 * Los perfiles son **de la app, no de cada lista**: el mismo perfil vale
 * aunque cambies de lista, y el historial se guarda por pareja perfil-lista,
 * para que cada una mantenga el suyo.
 *
 * Ojo con no confundirlo con `max_connections`: eso son reproducciones a la
 * vez, un límite del panel. Puede haber cinco perfiles aunque solo tres
 * puedan ver algo simultáneamente.
 */

import type { Orden } from './puerto.ts';
import type { Cambio } from './sincronizacion.ts';

/** Qué se puede tener a medias o marcado como favorito. */
export type ClaseMedio = 'canal' | 'pelicula' | 'episodio' | 'serie';

export interface Perfil {
  id: string;
  nombre: string;
  /** Color de la ficha, para distinguirlos de un vistazo. */
  color: string;
  creado: string;
}

/** Una cosa empezada y sin terminar. */
export interface Avance {
  clase: ClaseMedio;
  itemId: string;
  titulo: string;
  segundos: number;
  duracion: number;
  visto: string;
}

/**
 * Lo que este perfil está viendo, y dónde.
 *
 * Un perfil es una persona, y una persona no ve dos cosas a la vez: cuando
 * empieza algo en un aparato, lo que estuviera sonando en otro se para. Para
 * eso hace falta que los aparatos sepan quién está reproduciendo, y viaja por
 * donde ya viaja todo lo del perfil.
 */
export interface Reproduccion {
  /** El nombre del aparato en la casa: "TV Salón". Es lo que se le enseña a quien mira. */
  aparato: string;
  titulo: string;
  /** Cuándo empezó, en ISO. Desempata dos anuncios casi simultáneos. */
  desde: string;
}

/** La clave con la que se guarda en los ajustes del perfil. */
export const CLAVE_REPRODUCCION = 'reproduciendo';

/** Lee un anuncio guardado, que puede venir de otro aparato o estar vacío. */
export function reproduccionDesde(valor: string | null | undefined): Reproduccion | null {
  if (!valor) return null;
  try {
    const leido = JSON.parse(valor) as Partial<Reproduccion>;
    if (!leido.aparato || !leido.desde) return null;
    return { aparato: leido.aparato, titulo: leido.titulo ?? '', desde: leido.desde };
  } catch {
    return null;
  }
}

export interface Favorito {
  clase: ClaseMedio;
  itemId: string;
  titulo: string;
  creado: string;
}

/**
 * Dónde se guardan los perfiles y lo suyo. Lo implementa cada plataforma
 * sobre su SQLite, igual que el puerto `Biblioteca`.
 */
export interface AlmacenPerfiles {
  perfiles(): Promise<Perfil[]>;
  /** Sin color, se reparte el siguiente libre. */
  crear(nombre: string, color?: string): Promise<Perfil>;
  renombrar(id: string, nombre: string): Promise<void>;
  /**
   * Cambia el color de la ficha del perfil.
   *
   * Es lo que hace de "foto" sin traerse un selector de imágenes, que en
   * Android es un módulo nativo. Un círculo con la inicial y un color propio
   * distingue a cuatro personas de un vistazo, que es para lo que sirve.
   */
  recolorear(id: string, color: string): Promise<void>;
  borrar(id: string): Promise<void>;
  /**
   * Tira lo local para adoptar lo de la casa. **Borra de verdad.**
   *
   * Es la única excepción a la regla de no borrar nunca, y por eso está
   * aparte de `borrar`: no es una baja que haya que contarle a nadie —eso
   * enterraría los perfiles de la casa, que llevan el mismo identificador—,
   * es este aparato olvidando lo suyo antes de traerse el estado del grupo.
   *
   * Se hace al emparejar, y solo entonces: los perfiles son de la casa, así
   * que el que se hubiera creado el aparato por su cuenta sobra en cuanto
   * entra en una.
   */
  vaciarLoLocal(): Promise<void>;

  /** Guarda por dónde va. Se llama cada pocos segundos mientras se reproduce. */
  anotarAvance(perfilId: string, avance: Avance): Promise<void>;
  /** Lo empezado y sin terminar, de lo más reciente a lo más viejo. */
  seguirViendo(perfilId: string, limite?: number): Promise<Avance[]>;
  /** Por dónde iba una cosa concreta, si es que se empezó. */
  avanceDe(perfilId: string, clase: ClaseMedio, itemId: string): Promise<Avance | null>;
  /**
   * Lo visto de varias fichas a la vez, para pintar la barrita de avance en
   * una rejilla entera. Devuelve proporciones (0 a 1) con clave `clase:id`;
   * lo que no se ha empezado no sale.
   *
   * De una en una serían sesenta consultas por pantalla.
   */
  avancesDe(perfilId: string, medios: Array<{ clase: ClaseMedio; id: string }>): Promise<Record<string, number>>;
  olvidarAvance(perfilId: string, clase: ClaseMedio, itemId: string): Promise<void>;

  /**
   * Anuncia lo que este perfil está viendo aquí, o lo borra al parar.
   *
   * Se guarda como un ajuste más del perfil, así que **viaja con la
   * sincronización** sin ninguna tubería nueva: el aparato que reciba un
   * anuncio de otro sabrá que le toca callarse.
   */
  anunciarReproduccion(perfilId: string, reproduccion: Reproduccion | null): Promise<void>;
  /** Lo último que se anunció para este perfil, venga de donde venga. */
  reproduccion(perfilId: string): Promise<Reproduccion | null>;

  /** Preferencias del perfil: columnas de la rejilla, orden... */
  ajustes(perfilId: string): Promise<Ajustes>;
  guardarAjuste(perfilId: string, clave: keyof Ajustes, valor: string): Promise<void>;

  favoritos(perfilId: string): Promise<Favorito[]>;
  marcarFavorito(perfilId: string, favorito: Favorito): Promise<void>;
  desmarcarFavorito(perfilId: string, clase: ClaseMedio, itemId: string): Promise<void>;
  esFavorito(perfilId: string, clase: ClaseMedio, itemId: string): Promise<boolean>;

  /**
   * Lo cambiado desde la última vez que se habló con el servidor, lápidas
   * incluidas. No hace falta un registro de cambios aparte: las propias filas
   * llevan la fecha de su último cambio.
   */
  cambiosDesde(marca: string): Promise<Cambio[]>;
  /**
   * Mete lo que llega de otro aparato, descartando lo que pierda contra lo de
   * aquí. Aplica `fusionar`, así que recibir un cambio no es aplicarlo.
   */
  aplicarCambios(cambios: Cambio[]): Promise<void>;
}

/**
 * Lo que cada uno puede ajustar a su gusto.
 *
 * Va por perfil y no por aparato: en la misma tablet, a uno le caben seis
 * carátulas por fila y otro las quiere grandes.
 */
export interface Ajustes {
  /** Carátulas por fila en Películas y Series. */
  columnas: number;
  /** Cómo se ordenan: alfabéticamente, por nota o por lo último que entró. */
  orden: Orden;
}

/** Los criterios de orden admitidos, para descartar lo que venga guardado mal. */
const ORDENES: Orden[] = ['titulo', 'valoracion', 'reciente'];

/** Cuántas columnas se admiten: menos de tres no aprovecha, más de ocho no se lee. */
export const COLUMNAS_POSIBLES = [3, 4, 5, 6, 8] as const;

export const AJUSTES_POR_DEFECTO: Ajustes = { columnas: 4, orden: 'titulo' };

/** Interpreta lo guardado, que siempre es texto, y descarta lo que no vale. */
export function ajustesDesde(guardado: Record<string, string>): Ajustes {
  const columnas = Number(guardado.columnas);
  return {
    columnas: COLUMNAS_POSIBLES.includes(columnas as (typeof COLUMNAS_POSIBLES)[number])
      ? columnas
      : AJUSTES_POR_DEFECTO.columnas,
    orden: ORDENES.includes(guardado.orden as Orden) ? (guardado.orden as Orden) : AJUSTES_POR_DEFECTO.orden,
  };
}

/** Colores por defecto de las fichas de perfil, en el orden en que se reparten. */
export const COLORES_PERFIL = ['#35d07f', '#4aa3f0', '#f0a24a', '#c86cf0', '#f05a5a'] as const;

/**
 * Se considera terminado a partir del 95 %: los últimos minutos son títulos de
 * crédito, y dejarlo en "seguir viendo" al 98 % es molesto.
 */
export const FIN_PROPORCION = 0.95;

/** Lo que falta por ver, entre 0 y 1. Sirve para pintar la barrita de avance. */
export function proporcionVista(avance: Avance): number {
  if (!Number.isFinite(avance.duracion) || avance.duracion <= 0) return 0;
  return Math.max(0, Math.min(1, avance.segundos / avance.duracion));
}

/** ¿Se puede dar por visto? */
export function estaTerminado(avance: Avance): boolean {
  return proporcionVista(avance) >= FIN_PROPORCION;
}

/**
 * ¿Merece la pena recordar este avance?
 *
 * Los primeros segundos no cuentan: abrir algo para ver qué es y salir no
 * debería llenar el "seguir viendo". Y lo terminado tampoco se guarda.
 */
export function vaAnotado(avance: Avance, minimoSegundos = 30): boolean {
  return avance.segundos >= minimoSegundos && !estaTerminado(avance);
}

/** Clave con la que viajan los avances de una tacada. */
export function claveDeMedio(clase: ClaseMedio, id: string): string {
  return `${clase}:${id}`;
}

/** Identificador legible y único para un perfil nuevo. */
export function idDePerfil(nombre: string, existentes: Perfil[]): string {
  const base =
    nombre
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'perfil';

  if (!existentes.some((perfil) => perfil.id === base)) return base;
  let sufijo = 2;
  while (existentes.some((perfil) => perfil.id === `${base}-${sufijo}`)) sufijo++;
  return `${base}-${sufijo}`;
}

/** Color que toca al siguiente perfil, evitando repetir mientras haya libres. */
export function colorLibre(existentes: Perfil[]): string {
  const usados = new Set(existentes.map((perfil) => perfil.color));
  return COLORES_PERFIL.find((color) => !usados.has(color)) ?? COLORES_PERFIL[0];
}
