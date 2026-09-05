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
import type { ClaseMedio } from './perfiles.ts';

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
  /**
   * Género del panel, si se sabe. Se pinta dentro de la carátula enfocada.
   *
   * En las películas **no viene con el catálogo**: hay que pedir la ficha
   * larga, una petición por título, así que lo normal es que sea `null` hasta
   * que el servidor de la casa lo rellene en su pasada diaria.
   */
  genero: string | null;
}

export interface SerieFicha {
  id: string;
  titulo: string;
  anio: number | null;
  valoracion: number | null;
  logo: string | null;
  /** Este sí viene con el catálogo: `get_series` trae el género. */
  genero: string | null;
}

/**
 * La ficha larga de una película o de una serie: lo que no cabe en la carátula.
 *
 * Es la misma forma para las dos porque el panel devuelve los mismos campos
 * —solo cambia la llamada, `get_vod_info` o `get_series_info`—, y la portada
 * del inicio las trata igual.
 *
 * Todo puede faltar. Cada panel rellena lo que quiere, y la interfaz omite lo
 * que no venga en vez de dejar huecos con etiquetas vacías.
 */
export interface FichaDelServidor {
  id: string;
  clase: 'pelicula' | 'serie';
  /** Vacío si no se sabe: es lo que distingue "no hay" de "no se preguntó". */
  genero: string;
  sinopsis?: string;
  reparto?: string;
  /** La imagen apaisada, ya como URL entera. */
  fondo?: string;
  /** El identificador de YouTube, para abrirlo fuera. */
  trailer?: string;
}

export interface FichaLarga {
  sinopsis: string | null;
  /** Reparto tal y como lo da el panel: nombres separados por comas. */
  reparto: string | null;
  /** Imagen apaisada. La de la carátula es vertical y no sirve de fondo. */
  fondo: string | null;
  /** Géneros tal y como los da el panel: "Comedia, Animación". */
  genero: string | null;
  /**
   * El tráiler, tal como lo da el panel: un identificador de YouTube.
   *
   * A veces es el identificador pelado —`dQw4w9WgXcQ`— y a veces la URL
   * entera; quien lo use tiene que aceptar las dos formas. No se reproduce
   * dentro: se abre en la aplicación de YouTube del aparato, que es la que
   * sabe hacerlo y no gasta una conexión del panel.
   */
  trailer: string | null;
}

export interface TemporadaFicha {
  numero: number;
  episodios: number;
}

/** Un episodio con lo justo de su serie para poder pintarlo fuera de ella. */
export interface EpisodioDeSerieFicha {
  /**
   * La clave con la que viaja entre aparatos: `serie:sTeN`.
   *
   * Y no el número de fila de la base, que cada aparato reparte a su manera
   * según en qué orden haya abierto series. Lo cuenta `claveDeEpisodio`.
   */
  clave: string;
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
   * Tema, si se quiere solo ese: "Drama", "Comedia", "Documental".
   *
   * No es lo mismo que el grupo. El grupo es dónde ha colocado el proveedor la
   * ficha en su lista y el tema es de qué va, que es lo que uno busca. Se
   * excluyen entre sí: pedir los dos no tendría sentido.
   */
  tema?: string;
  /**
   * Cómo ordenar. Por título es lo de siempre; por valoración pone arriba lo
   * mejor puntuado, dejando lo no valorado al final —que no es lo mismo que
   * tener un cero—; por novedades, lo último que entró en el catálogo.
   */
  orden?: Orden;
}

/**
 * Cómo se ordena una página del catálogo.
 *
 * `recomendada` no es solo un orden: **también filtra**. Deja fuera lo que no
 * merece recomendarse —sin nota, mal valorado, con un 10 de los que reparte
 * el proveedor a mansalva, o copias de pase de prensa— y ordena lo que queda
 * por año, por lo último que entró y por nota. El criterio vive en
 * `@m3u/core` porque el servidor de la casa usa exactamente el mismo.
 */
export type Orden = 'titulo' | 'valoracion' | 'reciente' | 'recomendada';

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
  /**
   * Lo que echan ahora y lo que viene, o vacío si el canal no tiene EPG.
   *
   * Puede acabar preguntándole al panel, así que se pide **para un canal**:
   * el que tenga el foco encima.
   */
  deCanal(canalId: string): Promise<Programa[]>;
  /**
   * Lo mismo para varios canales, pero **solo de lo ya preparado**.
   *
   * Es lo que permite pintar la programación en una fila entera: con la
   * parrilla del servidor en memoria, saber qué echan en veinte canales no
   * cuesta ninguna petición. Los que no estén salen sin nada, y no se le
   * pregunta al panel por ellos: veinte fichas a la vista serían veinte
   * peticiones.
   */
  deCanales(canalIds: string[]): Promise<Record<string, Programa[]>>;
}

export interface Biblioteca {
  /**
   * El capítulo que va después de uno, por su clave.
   *
   * Hace falta para el "seguir viendo": cuando el último capítulo ya está
   * visto, lo que uno quiere ver no es ese sino el siguiente. Salta de
   * temporada si el que se acabó era el último de la suya, y devuelve `null`
   * cuando la serie se termina ahí.
   */
  episodioSiguiente(clave: string): Promise<EpisodioDeSerieFicha | null>;
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
   * Episodios sueltos por su clave, **con los datos de su serie**.
   *
   * Lo pide "seguir viendo": el historial solo guarda la clave del episodio, y
   * con eso no se puede pintar una ficha decente. Lo que uno reconoce es la
   * carátula de la serie y "S01E03", no el título del capítulo, así que hace
   * falta el salto a `series` que aquí ya viene hecho.
   *
   * Lo que el aparato no tenga —una serie que aún no ha abierto nunca— no
   * sale. Es lo mismo que hace con una película que el proveedor haya
   * quitado del catálogo.
   */
  episodiosPorClave(claves: string[]): Promise<EpisodioDeSerieFicha[]>;
  /**
   * La ficha larga de una película, pidiéndola al panel la primera vez.
   *
   * Es una petición por película, así que **no se pide en lote**: solo para la
   * que preside el inicio. Lo que se traiga se guarda, y la siguiente vez sale
   * de la base. Devuelve `null` si no hay nada que contar.
   */
  detalleDePelicula(id: string): Promise<FichaLarga | null>;
  /**
   * Lo mismo para una serie, con `get_series_info`.
   *
   * Va aparte de las temporadas aunque salga de la misma respuesta: la portada
   * necesita la ficha de cuatro series y no quiere sus episodios, que son la
   * parte gorda.
   */
  detalleDeSerie(id: string): Promise<FichaLarga | null>;
  /**
   * Anota las fichas largas que manda el servidor de la casa.
   *
   * Género, sinopsis, reparto, imagen apaisada y tráiler: nada de eso viene
   * con el catálogo del panel y averiguarlo cuesta una petición por título,
   * así que lo hace el servidor una vez para toda la casa. Aquí solo se
   * guarda, y **solo lo que falte**: si esta ficha ya se preguntó por su
   * cuenta —presidió el inicio—, lo suyo es más completo que esto.
   */
  guardarFichas(fichas: FichaDelServidor[]): Promise<void>;
  canalesPorId(ids: string[]): Promise<CanalFicha[]>;
  /**
   * Categorías del proveedor en una sección: "Estrenos", "TV Series NETFLIX".
   * Es lo que se enseña en la barra lateral de películas y series.
   */
  categorias(tipo: 'pelicula' | 'serie'): Promise<GrupoFicha[]>;
  /**
   * Los temas de una sección: drama, comedia, documental, con cuántas fichas
   * tiene cada uno.
   *
   * Es lo que ordena el inicio cuando hay géneros suficientes. De las series
   * los trae el catálogo del panel; de las películas los va averiguando el
   * servidor de la casa, poco a poco, así que al principio hay pocos y el
   * inicio tira de las categorías del proveedor mientras tanto.
   */
  temas(tipo: 'pelicula' | 'serie'): Promise<GrupoFicha[]>;
  /** Busca en todo, o solo dentro de la sección y categoría que se indique. */
  buscar(texto: string, ambito?: Ambito): Promise<Resultado[]>;
  /**
   * A qué categorías pertenece una ficha.
   *
   * Lo pide la afinidad al reproducir: es lo que se apunta para saber qué
   * filas subir. De un episodio valen las de su serie, que es lo que uno
   * elige.
   */
  gruposDe(clase: ClaseMedio, id: string): Promise<string[]>;
  /** Cuántas fichas hay en cada sección, para pintar los contadores del inicio. */
  totales(): Promise<{ canales: number; peliculas: number; series: number; episodios: number }>;
  /**
   * Calidades disponibles, de mejor a peor. La primera es la que se reproduce.
   *
   * En un episodio el identificador es su **clave** (`serie:sTeN`), no el
   * número de fila: es lo que guarda el historial y lo que viaja entre
   * aparatos.
   */
  variantes(clase: 'canal' | 'pelicula' | 'episodio', id: string): Promise<Variante[]>;
}
