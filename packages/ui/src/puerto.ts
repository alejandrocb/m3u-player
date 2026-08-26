/**
 * Lo que la interfaz necesita saber de la biblioteca, sin saber quién se lo da.
 *
 * En escritorio lo sirve `packages/storage` con `node:sqlite` a través del
 * puente IPC de Electron; en Android será otro SQLite. La interfaz no debe
 * notar la diferencia, así que aquí solo hay tipos y firmas.
 *
 * **Todo devuelve promesas**, aunque hoy el almacén de escritorio sea síncrono:
 * en cuanto los datos cruzan un IPC o un puente nativo dejan de serlo, y una
 * interfaz escrita contra un puerto síncrono habría que reescribirla entera.
 */

import type { Programa } from '@m3u/core';

export interface GrupoFicha {
  nombre: string;
  canales: number;
}

export interface CanalFicha {
  id: string;
  nombre: string;
  grupo: string;
  logo: string | null;
}

export interface PeliculaFicha {
  id: string;
  titulo: string;
  anio: number | null;
  /** Nota del panel, de 0 a 10, o `null` si no la valoró. */
  valoracion: number | null;
  logo: string | null;
}

export interface SerieFicha {
  id: string;
  titulo: string;
  anio: number | null;
  valoracion: number | null;
  logo: string | null;
}

/**
 * La ficha larga de una película: lo que no cabe en una carátula.
 *
 * Todo puede faltar. Cada panel rellena lo que quiere, y la interfaz omite lo
 * que no venga en vez de dejar huecos con etiquetas vacías.
 */
export interface DetallePelicula {
  sinopsis: string | null;
  /** Reparto tal y como lo da el panel: nombres separados por comas. */
  reparto: string | null;
  /** Imagen apaisada. La de la carátula es vertical y no sirve de fondo. */
  fondo: string | null;
}

export interface TemporadaFicha {
  numero: number;
  episodios: number;
}

/** Un episodio con lo justo de su serie para poder pintarlo fuera de ella. */
export interface EpisodioDeSerieFicha {
  id: number;
  serieId: string;
  serieTitulo: string;
  /** Carátula de la serie: es la que se reconoce de un vistazo. */
  serieLogo: string | null;
  temporada: number;
  numero: number;
  titulo: string | null;
}

/**
 * Un episodio con su ficha entera.
 *
 * La pantalla de una serie no es una numeración: enseña el fotograma, la
 * sinopsis y la nota de cada episodio, como cualquier servicio de vídeo. Todo
 * esto viene en la misma respuesta del panel, así que no cuesta nada más.
 *
 * Medido en las categorías de ficción del panel real: imagen en el 85-100 %,
 * sinopsis en algo más de la mitad, nota en dos de cada tres y duración en
 * casi todos. Lo que falte, la vista lo omite.
 */
export interface EpisodioFicha {
  id: number;
  temporada: number;
  numero: number;
  /** Ya limpio: `null` cuando el panel solo repetía el nombre de la serie. */
  titulo: string | null;
  imagen: string | null;
  resumen: string | null;
  valoracion: number | null;
  anio: number | null;
  /** Duración en segundos, o `null`. */
  segundos: number | null;
}

export interface Resultado {
  tipo: 'canal' | 'pelicula' | 'serie';
  id: string;
  titulo: string;
}

/** Petición paginada. La biblioteca real tiene 18.000 películas: nunca se piden todas. */
export interface Pagina {
  limite: number;
  desde: number;
  /**
   * Categoría del proveedor, si se quiere solo esa. Sin ella salen todas, que
   * es la opción "Todas" de la barra lateral.
   */
  grupo?: string;
  /**
   * Cómo ordenar. Por título es lo de siempre; por valoración pone arriba lo
   * mejor puntuado, dejando lo no valorado al final —que no es lo mismo que
   * tener un cero—; por novedades, lo último que entró en el catálogo.
   */
  orden?: Orden;
}

export type Orden = 'titulo' | 'valoracion' | 'reciente';

/** Dónde buscar: en todo, o solo dentro de una sección y su categoría. */
export interface Ambito {
  tipo?: 'canal' | 'pelicula' | 'serie';
  grupo?: string;
}

/**
 * Una calidad concreta de un contenido, con su URL.
 *
 * El proveedor manda una entrada por calidad y la biblioteca las fusiona, así
 * que al reproducir hay que elegir: la primera es la mejor.
 */
export interface Variante {
  url: string;
  calidad: string | null;
}

/**
 * La programación de los canales, que no está en la biblioteca.
 *
 * Va en su propio puerto porque no es catálogo: caduca cada pocos minutos, se
 * pide al panel canal a canal y no se guarda con el resto. Sin él, el directo
 * funciona igual pero sin parrilla.
 */
export interface Programacion {
  /** Lo que echan ahora y lo que viene, o vacío si el canal no tiene EPG. */
  deCanal(canalId: string): Promise<Programa[]>;
}

export interface Biblioteca {
  grupos(): Promise<GrupoFicha[]>;
  canalesDeGrupo(grupo: string): Promise<CanalFicha[]>;
  /**
   * Todos los canales, sin filtrar por grupo.
   *
   * Son 482 en la lista real —no 18.000 como las películas—, pero se pagina
   * igual: la rejilla los pide de sesenta en sesenta según se desplaza.
   */
  canales(pagina: Pagina): Promise<CanalFicha[]>;
  peliculas(pagina: Pagina): Promise<PeliculaFicha[]>;
  series(pagina: Pagina): Promise<SerieFicha[]>;
  temporadas(serieId: string): Promise<TemporadaFicha[]>;
  episodios(serieId: string, temporada: number): Promise<EpisodioFicha[]>;
  /**
   * Fichas concretas por identificador, en el orden que se pidan.
   *
   * Es lo que hace falta para el grupo de favoritos: los identificadores los
   * tiene el perfil, no la biblioteca, y hay que rellenarlos con carátula y
   * nota para que la ficha se pinte igual que en cualquier otro grupo.
   */
  peliculasPorId(ids: string[]): Promise<PeliculaFicha[]>;
  seriesPorId(ids: string[]): Promise<SerieFicha[]>;
  /**
   * Episodios sueltos por su identificador, **con los datos de su serie**.
   *
   * Lo pide "seguir viendo": el historial solo guarda el id del episodio, y
   * con eso no se puede pintar una ficha decente. Lo que uno reconoce es la
   * carátula de la serie y "S01E03", no el título del capítulo, así que hace
   * falta el salto a `series` que aquí ya viene hecho.
   */
  episodiosPorId(ids: string[]): Promise<EpisodioDeSerieFicha[]>;
  /**
   * La ficha larga de una película, pidiéndola al panel la primera vez.
   *
   * Es una petición por película, así que **no se pide en lote**: solo para la
   * que preside el inicio. Lo que se traiga se guarda, y la siguiente vez sale
   * de la base. Devuelve `null` si no hay nada que contar.
   */
  detalleDePelicula(id: string): Promise<DetallePelicula | null>;
  canalesPorId(ids: string[]): Promise<CanalFicha[]>;
  /**
   * Categorías del proveedor en una sección: "Estrenos", "TV Series NETFLIX".
   * Es lo que se enseña en la barra lateral de películas y series.
   */
  categorias(tipo: 'pelicula' | 'serie'): Promise<GrupoFicha[]>;
  /** Busca en todo, o solo dentro de la sección y categoría que se indique. */
  buscar(texto: string, ambito?: Ambito): Promise<Resultado[]>;
  /** Cuántas fichas hay en cada sección, para pintar los contadores del inicio. */
  totales(): Promise<{ canales: number; peliculas: number; series: number; episodios: number }>;
  /** Calidades disponibles, de mejor a peor. La primera es la que se reproduce. */
  variantes(clase: 'canal' | 'pelicula' | 'episodio', id: string): Promise<Variante[]>;
}
