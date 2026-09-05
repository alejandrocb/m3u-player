/**
 * El comportamiento de la interfaz, sin pintarla.
 *
 * Junta la pila de navegación, el foco y el puerto de datos, y produce el
 * estado de la pantalla actual. La vista se limita a dibujar ese estado y a
 * mandar las cuatro señales de un mando: arriba, abajo, aceptar y atrás.
 *
 * Es lo que permite tener la misma interfaz en Electron y en Android TV sin
 * escribirla dos veces: aquí está el qué, y en cada plataforma solo el cómo.
 */

import { mover } from './foco.ts';
import { cantidad, duracion } from './texto.ts';
import type { Direccion } from './foco.ts';
import { Navegador } from './navegacion.ts';
import type { Pantalla, ResultadoAtras } from './navegacion.ts';
import type { PortadaRemota } from './cliente-sync.ts';
import type { Biblioteca, CanalFicha, FichaLarga, GrupoFicha, Orden, Resultado } from './puerto.ts';
import { claveDeMedio, estaTerminado, proporcionVista } from './perfiles.ts';
import type { Avance, ClaseMedio } from './perfiles.ts';
import { claveDeEpisodio, esRecomendable, leerClaveDeEpisodio, programaActual } from '@m3u/core';
import type { Programa } from '@m3u/core';

/** Qué reproducir cuando el usuario acepta sobre una ficha. */
export interface Reproducible {
  clase: 'canal' | 'pelicula' | 'episodio';
  id: string;
  titulo: string;
}

/**
 * Lo que se puede marcar en Mi Lista.
 *
 * No es lo mismo que `Reproducible`: una serie **se marca pero no se
 * reproduce** —lo que se ve es un episodio— y un episodio suelto no se marca,
 * porque lo que uno guarda es la serie entera.
 */
export interface Marcable {
  clase: ClaseMedio;
  id: string;
  titulo: string;
}

export type Accion =
  | { tipo: 'entrar'; pantalla: Pantalla }
  | { tipo: 'reproducir'; medio: Reproducible }
  | { tipo: 'filtrar'; filtro: FiltroLista }
  /** Marcar o desmarcar en Mi Lista, desde el botón de la ficha. */
  | { tipo: 'marcar'; medio: Marcable }
  | { tipo: 'descargar'; medio: Reproducible }
  /**
   * Abrir algo fuera de la aplicación: hoy solo el tráiler.
   *
   * El tráiler es de YouTube y lo reproduce YouTube: montar un reproductor de
   * vídeo de otra plataforma dentro sería mucho trabajo para un minuto y
   * medio, y además no gasta conexión del panel.
   */
  | { tipo: 'enlace'; url: string };

/** Una celda de la rejilla, ya lista para pintar. */
export interface Elemento {
  id: string;
  titulo: string;
  /** Número de canales, episodios de la temporada... o nada. */
  detalle: string | null;
  /**
   * Nota del panel y año, que la vista incrusta en las esquinas de la
   * carátula en vez de escribirlos debajo. Una línea de texto menos por
   * ficha es una carátula más grande, que es lo que se mira de lejos.
   */
  valoracion: number | null;
  anio: number | null;
  /** Sinopsis, solo en los episodios. El resto de fichas no tienen sitio. */
  resumen: string | null;
  logo: string | null;
  accion: Accion;
  /**
   * Parte ya vista, de 0 a 1, para pintar la barrita bajo la carátula. `null`
   * en lo que no se ha empezado o no se puede seguir (grupos, categorías).
   */
  avance: number | null;
  /** Marcado por este perfil. Se pinta el corazón y entra en su grupo. */
  favorito: boolean;
  /**
   * Géneros, solo en la portada del inicio.
   *
   * Es opcional porque ninguna otra ficha tiene sitio para pintarlos: en una
   * carátula de la rejilla no cabe una línea más.
   */
  genero?: string | null;
}

/** Una entrada de la barra lateral de categorías. */
export interface OpcionLateral {
  /** null es "Todas". */
  grupo: string | null;
  nombre: string;
  cuantos: number | null;
  /**
   * El grupo propio del perfil, que no viene del proveedor.
   *
   * Va aparte de `grupo` porque no es una categoría con nombre: es "lo que
   * este perfil ha marcado", y coincidiría con una categoría del panel que se
   * llamara igual.
   */
}

/**
 * La barra de la izquierda: categorías en las tres secciones y temporadas
 * dentro de una serie.
 *
 * El proveedor ya reparte el catálogo en categorías y esconderlas obliga a
 * recorrer 18.000 fichas en una sola rejilla. La barra las enseña y deja
 * acotar tanto el listado como la búsqueda. En una serie hace el mismo papel
 * con las temporadas, que es como se navegan en cualquier servicio de vídeo:
 * la temporada a un lado y sus episodios al otro.
 */
export interface Lateral {
  opciones: OpcionLateral[];
  /** Categoría en uso; `null` es "Todas". */
  activa: string | null;
  foco: number;
  /** true cuando el foco está en la barra y no en la rejilla. */
  dentro: boolean;
}

/**
 * Cómo hay que dibujar las fichas de esta pantalla.
 *
 * No es lo mismo un cartel vertical que el logotipo apaisado de un canal o la
 * fila de un episodio con su fotograma y su sinopsis. La vista no puede
 * deducirlo del contenido, así que se lo dice el presentador.
 */
export type Formato = 'lista' | 'carteles' | 'canales' | 'episodios' | 'ficha';

/**
 * Una banda de la pantalla de inicio.
 *
 * El inicio no es una rejilla: es una sucesión de filas de distinta forma —el
 * destacado ocupa el ancho, los carruseles se recorren de lado, las secciones
 * son tres fichas grandes—. Modelarlo así es lo que permite que **todo baje
 * junto en un solo desplazamiento**. Cuando eran bloques independientes, cada
 * uno con su scroll, en una tele se disimulaba y en un teléfono la primera
 * fila se comía la pantalla y escondía el resto.
 */
export type FilaInicio =
  | { tipo: 'destacado'; elementos: Elemento[] }
  | { tipo: 'carrusel'; titulo: string; elementos: Elemento[]; formato?: FormatoFila }
  /**
   * Los filtros de Mi Lista, que son una fila más.
   *
   * Van dentro de la lista y no en la barra de arriba a propósito: así se
   * recorren con el mando exactamente igual que las carátulas —arriba, abajo,
   * izquierda, derecha— sin inventar otro sitio donde puede estar el foco.
   */
  | { tipo: 'filtros'; elementos: Elemento[] };

/** Cómo se pintan las fichas de una fila: la carátula manda o el logotipo. */
export type FormatoFila = 'cartel' | 'canal';

/**
 * La pantalla de inicio entera, con el foco en dos ejes.
 *
 * Arriba y abajo cambian de fila; izquierda y derecha recorren la de dentro.
 * Es el recorrido de cualquier servicio de vídeo, y con un mando es el único
 * que no obliga a adivinar dónde va a saltar el foco.
 */
/**
 * Qué se está mirando en el inicio.
 *
 * No son pantallas distintas: es **la misma pantalla filtrada**. Cambiar de
 * pestaña cambia la portada y los carruseles, pero la forma es la misma, así
 * que uno no se pierde. TV en directo no está aquí porque no se filtra: es
 * otra pantalla, con su parrilla y su vista previa.
 */
export type ModoInicio = 'todo' | 'peliculas' | 'series' | 'directo' | 'lista';

export const MODOS_INICIO: Array<{ modo: ModoInicio; nombre: string }> = [
  { modo: 'todo', nombre: 'Todo' },
  { modo: 'peliculas', nombre: 'Películas' },
  { modo: 'series', nombre: 'Series' },
  { modo: 'directo', nombre: 'TV en directo' },
  { modo: 'lista', nombre: 'Mi Lista' },
];

/**
 * Dentro de Mi Lista, con qué se queda uno.
 *
 * Es un filtro y no otra pantalla: lo marcado es lo mismo, solo que a veces
 * uno viene a por una película y no quiere ver los canales de por medio.
 */
export type FiltroLista = 'todo' | 'pelicula' | 'serie' | 'canal';

export const FILTROS_LISTA: Array<{ filtro: FiltroLista; nombre: string }> = [
  { filtro: 'todo', nombre: 'Todo' },
  { filtro: 'pelicula', nombre: 'Películas' },
  { filtro: 'serie', nombre: 'Series' },
  { filtro: 'canal', nombre: 'TV en directo' },
];

export interface Inicio {
  filas: FilaInicio[];
  fila: number;
  columna: number;
  /** La pestaña activa del selector de arriba. */
  modo: ModoInicio;
  /**
   * Cuál de las sugerencias se está enseñando en la portada.
   *
   * Va aparte de `columna` porque la portada se turna sola, con su propio
   * reloj, esté donde esté el foco. `columna` es dónde está el mando; esto es
   * qué se está viendo arriba.
   */
  destacado: number;
  /** Con qué parte de Mi Lista se está quedando uno. Solo pinta ahí. */
  filtro: FiltroLista;
}

/** Los elementos de una fila, sea del tipo que sea. */
export function elementosDeFila(fila: FilaInicio): Elemento[] {
  return fila.elementos;
}

/**
 * El identificador del canal de una ficha, o `null` si no es un canal.
 *
 * Sale de su acción y **no de `Elemento.id`**, que lleva delante la clase
 * —`canal:tvg:24 Horas`— para que dos fichas distintas de la misma fila no
 * compartan clave. Preguntar la parrilla con ese identificador compuesto es
 * preguntar por un canal que no existe: la fila salía entera sin programación
 * y sin ningún error por ninguna parte.
 */
/**
 * Qué contenido hay detrás de una ficha, para el menú de mantener pulsado.
 *
 * Una carátula de película lleva su acción de reproducir; una de serie, la de
 * entrar en ella. En los dos casos lo que hace falta es lo mismo —qué es y
 * cuál es—, y sacarlo de `Elemento.id` no vale: lleva la clase delante y, en
 * los episodios, el número de fila.
 */
export function medioDeElemento(elemento: Elemento): Marcable | null {
  if (elemento.accion.tipo === 'reproducir') {
    const medio = elemento.accion.medio;
    return { clase: medio.clase, id: medio.id, titulo: elemento.titulo };
  }
  if (elemento.accion.tipo === 'entrar' && elemento.accion.pantalla.tipo === 'serie') {
    return { clase: 'serie', id: elemento.accion.pantalla.serieId, titulo: elemento.titulo };
  }
  return null;
}

export function canalDeElemento(elemento: Elemento): string | null {
  const accion = elemento.accion;
  if (accion?.tipo !== 'reproducir' || accion.medio.clase !== 'canal') return null;
  return accion.medio.id;
}

/** Cuántas sugerencias se turnan en la portada. */
export const DESTACADAS = 4;

/**
 * De cuántas se pide la ficha larga para sacar esas cuatro.
 *
 * La portada exige imagen apaisada y no todas la tienen, así que se pregunta
 * por más de las que hacen falta y se van cogiendo las que sirvan. Las
 * peticiones van en paralelo y solo la primera vez: después están guardadas.
 */
const CANDIDATAS = 8;

/**
 * Cuánto vale un canal en "seguir viendo" cuando no hay programación.
 *
 * Dos horas: lo que dura una película o un partido largo. Con EPG no hace
 * falta —se sabe cuándo termina lo que estabas viendo—, pero 272 de los 463
 * canales de la lista real no tienen, y son justo los de eventos.
 */
const CADUCA_DIRECTO_MS = 2 * 60 * 60 * 1000;

/** Cuántas fichas lleva cada carrusel del inicio. */
const CARRUSEL = 20;

/**
 * Cuántas categorías del proveedor se enseñan como filas.
 *
 * Hay decenas y no caben: pasado un punto, bajar deja de ser mirar y pasa a
 * ser buscar, que para eso está la sección con su barra de categorías.
 */
const CATEGORIAS_EN_INICIO = 8;

/**
 * Cuántas caben en "seguir viendo" **después** de dejar una por serie.
 *
 * Quien llama pide unas cuantas más de la cuenta, porque el recorte por serie
 * se hace aquí: si se pidieran doce y cinco fueran capítulos de la misma,
 * quedarían ocho.
 */
const EN_CONTINUAR = 12;

/** Cuántos nombres del reparto caben en una línea sin cansar. */
const REPARTO_VISIBLE = 3;

/** Cuántos géneros se enseñan: el panel llega a poner cinco. */
const GENEROS_VISIBLES = 3;

/**
 * Los géneros de una película, recortados y limpios.
 *
 * El panel los da separados por comas y a veces son cinco. Tres bastan para
 * saber si te apetece, que es para lo que sirven.
 */
/**
 * La dirección del tráiler a partir de lo que da el panel.
 *
 * Unas veces manda el identificador pelado —`dQw4w9WgXcQ`— y otras la URL
 * entera. Con el identificador se monta la de YouTube; con una URL se deja
 * como está, que puede no ser de YouTube.
 */
export function urlDeTrailer(trailer: string): string {
  const limpio = trailer.trim();
  if (/^https?:\/\//i.test(limpio)) return limpio;
  return `https://www.youtube.com/watch?v=${limpio}`;
}

export function primerosGeneros(genero: string | null): string | null {
  if (!genero) return null;

  const generos = genero
    .split(/[,/]/)
    .map((uno) => uno.trim())
    .filter(Boolean);
  if (generos.length === 0) return null;

  return generos.slice(0, GENEROS_VISIBLES).join(' · ');
}

/**
 * Los primeros nombres del reparto, como los da el panel.
 *
 * Vienen separados por comas y a veces son doce. En la portada caben tres:
 * los que encabezan el cartel, que es lo que sirve para reconocer una película.
 */
export function primerosDelReparto(reparto: string | null): string | null {
  if (!reparto) return null;

  const nombres = reparto
    .split(',')
    .map((nombre) => nombre.trim())
    .filter(Boolean);
  if (nombres.length === 0) return null;

  return nombres.slice(0, REPARTO_VISIBLE).join(' · ');
}

/**
 * Elige las que presiden el inicio.
 *
 * El criterio es el de `@m3u/core`: reciente, con nota creíble y sin ser una
 * copia de pase de prensa. Aquí se le añade lo único que depende de la
 * interfaz —que tenga cartel, porque sin imagen no hay nada que enseñar— y el
 * año, que en la portada sí se exige: lo viejo no es novedad.
 *
 * **Se ordena por año y se respeta el orden de entrada**, que es el de lo
 * último añadido: quien llama pide la página por `reciente`. `sort` de
 * JavaScript conserva el orden de los empates, así que dentro del mismo año
 * manda lo que entró antes en el catálogo. La nota ya ha hecho su trabajo al
 * filtrar; ordenar por ella pondría arriba los dieces del proveedor.
 *
 * Si nada cumple, se devuelve la lista vacía y el inicio arranca sin portada
 * en vez de presidirlo con lo primero que haya, que es peor que no tener.
 */
export function destacarVarias<
  T extends { titulo: string; anio: number | null; valoracion: number | null; logo: string | null },
>(candidatas: T[], cuantas: number, ahora = new Date()): T[] {
  const desde = ahora.getFullYear() - 1;
  const buenas = candidatas.filter(
    (ficha) =>
      ficha.logo &&
      ficha.anio !== null &&
      ficha.anio >= desde &&
      esRecomendable(ficha.titulo, ficha.valoracion),
  );

  return [...buenas].sort((a, b) => (b.anio ?? 0) - (a.anio ?? 0)).slice(0, cuantas);
}

/** La mejor de todas, para cuando solo hace falta una. */
export function destacar<
  T extends { titulo: string; anio: number | null; valoracion: number | null; logo: string | null },
>(candidatas: T[], ahora = new Date()): T | null {
  return destacarVarias(candidatas, 1, ahora)[0] ?? null;
}

export interface EstadoPantalla {
  titulo: string;
  elementos: Elemento[];
  formato: Formato;
  /** 1 para listas verticales; más para las rejillas de carátulas. */
  columnas: number;
  foco: number;
  /** true mientras queden más páginas por pedir. */
  hayMas: boolean;
  /** Categorías, solo en las pantallas que las tienen. */
  lateral: Lateral | null;
  /** Lo tecleado en el buscador, si estamos en él. */
  busqueda: string | null;
  /** La pantalla de inicio con sus filas. `null` en el resto de pantallas. */
  inicio: Inicio | null;
  /**
   * La ficha de una película o serie. `null` en el resto de pantallas.
   *
   * Va aparte de `elementos` por lo mismo que `inicio`: lo que se pinta no es
   * una rejilla. En `elementos` quedan solo los botones, que así se recorren
   * con el mando sin inventar otro sitio donde pueda estar el foco.
   */
  ficha: Ficha | null;
}

/** Lo que se enseña de una película o de una serie en su pantalla. */
export interface Ficha {
  clase: 'pelicula' | 'serie';
  id: string;
  titulo: string;
  anio: number | null;
  valoracion: number | null;
  /** Géneros del panel, ya en limpio: "Comedia · Animación". */
  genero: string | null;
  sinopsis: string | null;
  reparto: string | null;
  /** El cartel vertical, que es el que identifica la película. */
  cartel: string | null;
  /** La imagen apaisada, para el fondo. Puede no haberla. */
  fondo: string | null;
  favorito: boolean;
}

export interface OpcionesPresentador {
  /** Cuántas carátulas por fila. La vista lo sabe mejor: depende del ancho. */
  columnasRejilla?: number;
  /** Tamaño de página. La lista real tiene 18.000 películas: nunca se piden todas. */
  tamanoPagina?: number;
  /**
   * Cuánto se ha visto de cada ficha, para la barrita de avance. Se pide de
   * una tacada por pantalla, no ficha a ficha.
   */
  avances?: (medios: Array<{ clase: ClaseMedio; id: string }>) => Promise<Record<string, number>>;
  /**
   * Lo que este perfil tiene empezado y sin terminar, de lo más reciente a lo
   * más viejo. Es lo que llena la fila de "seguir viendo" del inicio.
   *
   * Va como opción y no dentro de `Biblioteca` por lo mismo que los favoritos:
   * el catálogo es de toda la casa y esto es de cada uno. Sin ello la interfaz
   * funciona igual, solo que sin la fila.
   */
  seguirViendo?: () => Promise<Avance[]>;
  /** Cómo ordenar películas y series. Por título si no se dice otra cosa. */
  orden?: Orden;
  /**
   * Qué echan en unos cuantos canales, **de lo ya preparado**.
   *
   * Solo se usa para decidir si un canal sigue teniendo sitio en "seguir
   * viendo": mientras no termine el programa que se estaba viendo. Es el
   * `deCanales` del puerto de programación, que nunca pregunta al panel: aquí
   * no puede costar una petición por canal.
   */
  parrilla?: (canalIds: string[]) => Promise<Record<string, Programa[]>>;
  /**
   * Cuánto ha visto este perfil de cada categoría.
   *
   * Va como opción, igual que el historial: sin perfil detrás no hay
   * afinidad, y el inicio se ordena entonces por lo que más contenido tiene.
   */
  afinidad?: () => Promise<Record<string, number>>;
  /**
   * Los favoritos del perfil que esté viendo.
   *
   * Va como puerto aparte y no dentro de `Biblioteca` porque no son datos del
   * catálogo: la biblioteca es la misma para toda la casa y esto es de cada
   * uno. Sin esto la interfaz funciona igual, solo que sin corazones.
   */
  favoritos?: PuertoFavoritos;
}

/** Lo que el presentador necesita de los favoritos del perfil. */
export interface PuertoFavoritos {
  /** Identificadores marcados de una clase, del más reciente al más viejo. */
  listar(clase: ClaseMedio): Promise<string[]>;
  /** Marca o desmarca, y devuelve cómo queda. */
  alternar(clase: ClaseMedio, id: string, titulo: string): Promise<boolean>;
}

export class Presentador {
  #biblioteca: Biblioteca;
  #navegador: Navegador;
  #columnasRejilla: number;
  #tamanoPagina: number;

  #elementos: Elemento[] = [];
  #foco = 0;
  #hayMas = false;
  #titulo = '';
  /** Evita que el desplazamiento pida la misma página dos veces seguidas. */
  #cargandoMas = false;
  #lateral: Lateral | null = null;
  #inicio: Inicio | null = null;
  /** La ficha abierta, si la pantalla de arriba es una ficha. */
  #ficha: Ficha | null = null;
  /**
   * El tráiler de la ficha abierta.
   *
   * Va aparte de `Ficha` porque no es algo que se pinte: es la URL del botón,
   * y la vista no tiene que saber de dónde sale.
   */
  #trailer: string | null = null;
  /**
   * Dónde estaba el foco del inicio la última vez.
   *
   * Se guarda aparte de `#inicio` porque ese se desmonta al entrar en
   * cualquier sección, y al volver hay que dejar el foco donde estaba —igual
   * que hace el navegador con la rejilla—. Sin esto, salir de Películas
   * devolvía siempre a la primera ficha de la primera fila.
   */
  #focoInicio = { fila: 0, columna: 0 };
  /** La pestaña del inicio. Se conserva al entrar y salir de una sección. */
  #modoInicio: ModoInicio = 'todo';
  /** Y con qué parte de Mi Lista se queda uno. */
  #filtroLista: FiltroLista = 'todo';
  #avances: OpcionesPresentador['avances'];
  #seguirViendo: OpcionesPresentador['seguirViendo'];
  #parrilla: OpcionesPresentador['parrilla'];
  #favoritos: PuertoFavoritos | undefined;
  #afinidad: OpcionesPresentador['afinidad'];
  #orden: Orden;
  /**
   * Las sugerencias que ha preparado el servidor de la casa, si las hay.
   *
   * Llegan de fuera y no se piden desde aquí: el presentador no sabe de red.
   * Cuando están, la portada sale sin preguntarle nada al panel; cuando no,
   * se saca como siempre, pidiendo la ficha larga de unas cuantas candidatas.
   */
  #portadas: PortadaRemota[] = [];

  constructor(biblioteca: Biblioteca, opciones: OpcionesPresentador = {}) {
    this.#biblioteca = biblioteca;
    this.#navegador = new Navegador();
    this.#columnasRejilla = opciones.columnasRejilla ?? 5;
    this.#tamanoPagina = opciones.tamanoPagina ?? 60;
    this.#avances = opciones.avances;
    this.#seguirViendo = opciones.seguirViendo;
    this.#parrilla = opciones.parrilla;
    this.#favoritos = opciones.favoritos;
    this.#afinidad = opciones.afinidad;
    this.#orden = opciones.orden ?? 'titulo';
  }

  get orden(): Orden {
    return this.#orden;
  }

  /** Cambia el orden y recarga la pantalla desde el principio. */
  async ordenarPor(orden: Orden): Promise<EstadoPantalla> {
    this.#orden = orden;
    return this.cargar();
  }

  get pantalla(): Pantalla {
    return this.#navegador.actual;
  }

  get formato(): Formato {
    switch (this.#navegador.actual.tipo) {
      case 'serie':
        return 'episodios';
      // La ficha no es una lista de nada: los "elementos" son sus botones.
      case 'ficha':
        return 'ficha';
      // El buscador enseña carátulas como cualquier otra rejilla. En lista, un
      // resultado era una línea de texto: para reconocer una película de un
      // vistazo hace falta el cartel, y para eso ya está el mismo formato que
      // usan Películas y Series.
      case 'buscador':
        return 'carteles';
      default:
        return 'lista';
    }
  }

  get columnas(): number {
    switch (this.formato) {
      case 'carteles':
        return this.#columnasRejilla;
      // Los canales van en lista, no en rejilla: el nombre es lo que se lee
      // —muchos logotipos no lo llevan escrito— y así queda sitio para la
      // columna de la programación, que es lo que se mira antes de entrar.
      case 'canales':
        return 1;
      /*
        Los botones de la ficha son **una fila**, así que el mando los recorre
        con izquierda y derecha. Con una sola columna se recorrían con arriba y
        abajo, que en una fila de botones no se le ocurre a nadie.
      */
      case 'ficha':
        return Math.max(1, this.#elementos.length);
      // Un episodio ocupa la fila entera: fotograma a la izquierda y ficha a
      // la derecha, que es donde va la sinopsis.
      default:
        return 1;
    }
  }

  estado(): EstadoPantalla {
    const pantalla = this.#navegador.actual;
    return {
      titulo: this.#titulo,
      elementos: [...this.#elementos],
      formato: this.formato,
      columnas: this.columnas,
      foco: this.#foco,
      hayMas: this.#hayMas,
      lateral: this.#lateral ? { ...this.#lateral, opciones: [...this.#lateral.opciones] } : null,
      busqueda: pantalla.tipo === 'buscador' ? (pantalla.texto ?? '') : null,
      inicio: this.#inicio ? { ...this.#inicio, filas: [...this.#inicio.filas] } : null,
      ficha: this.#ficha ? { ...this.#ficha } : null,
    };
  }

  /**
   * Convierte fichas de catálogo en elementos de carrusel.
   *
   * Se les pega el avance para que la barrita salga también aquí: en una fila
   * de novedades, saber qué llevas empezado es la mitad de la información.
   */
  async #aCarrusel(
    fichas: Array<{
      id: string;
      titulo: string;
      anio: number | null;
      valoracion: number | null;
      logo: string | null;
      genero?: string | null;
    }>,
    clase: 'pelicula' | 'serie',
  ): Promise<Elemento[]> {
    const elementos: Elemento[] = fichas.map((ficha) => ({
      id: `${clase}:${ficha.id}`,
      titulo: ficha.titulo,
      detalle: null,
      // Va dentro de la carátula, junto al año y la nota.
      genero: primerosGeneros(ficha.genero ?? null),
      valoracion: ficha.valoracion,
      anio: ficha.anio,
      resumen: null,
      logo: ficha.logo,
      avance: null,
      favorito: false,
      accion:
        clase === 'pelicula'
          ? { tipo: 'reproducir', medio: { clase: 'pelicula', id: ficha.id, titulo: ficha.titulo } }
          : { tipo: 'entrar', pantalla: { tipo: 'serie', serieId: ficha.id, titulo: ficha.titulo } },
    }));

    /*
      Por aquí y no llamando al historial a pelo: `#conAvances` ya se guarda de
      que un fallo de la base no tire la pantalla, y ya sabe que a una serie
      —que se abre, no se reproduce— no se le pregunta por dónde iba.

      Y el corazón, que faltaba: sin él, marcar algo desde el inicio no se
      notaba hasta ir a Mi Lista, y al volver la ficha salía sin marcar.
    */
    return this.#conFavoritos(await this.#conAvances(elementos));
  }

  /** La fila de "seguir viendo", a partir del historial del perfil. */
  async #filaContinuar(modo: ModoInicio): Promise<FilaInicio | null> {
    if (!this.#seguirViendo) return null;

    // Si la base está ocupada o el historial falla, el inicio se pinta igual
    // —sin esta fila— en vez de quedarse en blanco.
    let historial: Avance[];
    try {
      historial = await this.#seguirViendo();
    } catch {
      return null;
    }

    /*
      Se filtra por la pestaña: en Películas no pinta nada un capítulo a
      medias, y en Series tampoco una película. En "Todo" salen los dos.
    */
    const filtrados = historial.filter((avance) => {
      // Un canal solo pinta donde hay directo: en Películas y Series, no.
      if (avance.clase === 'canal') return modo === 'todo' || modo === 'directo';
      if (modo === 'peliculas') return avance.clase === 'pelicula';
      if (modo === 'series') return avance.clase === 'episodio' || avance.clase === 'serie';
      if (modo === 'directo') return false;
      return true;
    });

    /*
      Una fila por serie, no una por capítulo.

      Una serie se ve en orden, así que lo que hace falta es **por dónde vas**,
      no la lista de los cuatro últimos capítulos: eso llena "seguir viendo" de
      la misma carátula repetida y esconde lo demás. El historial viene de lo
      más reciente a lo más viejo, así que el primero de cada serie es el
      último que se tocó.
    */
    const series = new Set<string>();
    const avances = filtrados
      .filter((avance) => {
        if (avance.clase !== 'episodio') return true;
        const serieId = leerClaveDeEpisodio(avance.itemId)?.serieId;
        if (!serieId) return true;
        if (series.has(serieId)) return false;
        series.add(serieId);
        return true;
      })
      .slice(0, EN_CONTINUAR);
    if (avances.length === 0) return null;

    /*
      Lo terminado no se queda: releva.

      Una película vista se cae de la fila —para eso está el umbral, distinto
      en película y capítulo—. Un capítulo visto **da paso al siguiente**, que
      es lo que uno quiere ver: la serie se ve en orden, y dejar en la fila el
      que ya se acabó obliga a entrar en la serie y buscar el que toca. Si no
      hay siguiente, la serie se ha terminado y sale de la fila.
    */
    const alDia: Array<{ avance: Avance; relevo: string | null }> = [];
    for (const avance of avances) {
      // Un directo no se termina: caduca, y eso se mira más abajo con su
      // programación.
      if (avance.clase === 'canal' || !estaTerminado(avance)) {
        alDia.push({ avance, relevo: null });
        continue;
      }
      if (avance.clase !== 'episodio') continue;

      const siguiente = await this.#biblioteca.episodioSiguiente(avance.itemId);
      if (siguiente) alDia.push({ avance, relevo: siguiente.clave });
    }
    if (alDia.length === 0) return null;

    const idsDe = (clase: ClaseMedio): string[] =>
      alDia
        .filter(({ avance }) => avance.clase === clase)
        .map(({ avance, relevo }) => relevo ?? avance.itemId);

    const [peliculas, episodios, canales] = await Promise.all([
      this.#biblioteca.peliculasPorId(idsDe('pelicula')),
      this.#biblioteca.episodiosPorClave(idsDe('episodio')),
      this.#biblioteca.canalesPorId(idsDe('canal')),
    ]);
    const porPelicula = new Map(peliculas.map((ficha) => [ficha.id, ficha]));
    const porEpisodio = new Map(episodios.map((ficha) => [ficha.clave, ficha]));
    const porCanal = new Map(canales.map((ficha) => [ficha.id, ficha]));

    /*
      Lo que echan ahora en esos canales, para saber cuáles siguen valiendo.
      Solo de lo preparado: preguntar al panel canal a canal por una fila del
      inicio sería una petición por canal cada vez que se pinta.
    */
    const programas =
      canales.length > 0 && this.#parrilla ? await this.#parrilla(canales.map((ficha) => ficha.id)) : {};

    const ahora = new Date();
    const elementos: Elemento[] = [];
    for (const { avance, relevo } of alDia) {
      // Con relevo, el capítulo es otro y empieza de cero: la barrita del que
      // ya se vio no dice nada del que viene.
      const visto = relevo ? 0 : proporcionVista(avance);

      if (avance.clase === 'pelicula') {
        const ficha = porPelicula.get(avance.itemId);
        // Lo que ya no está en el catálogo se calla: el proveedor quita cosas,
        // y una ficha sin carátula ni título no le sirve a nadie.
        if (!ficha) continue;
        elementos.push({
          id: `continuar:pelicula:${ficha.id}`,
          titulo: ficha.titulo,
          detalle: null,
          valoracion: ficha.valoracion,
          anio: ficha.anio,
          resumen: null,
          logo: ficha.logo,
          avance: visto,
          favorito: false,
          accion: { tipo: 'reproducir', medio: { clase: 'pelicula', id: ficha.id, titulo: ficha.titulo } },
        });
        continue;
      }

      if (avance.clase === 'canal') {
        const ficha = porCanal.get(avance.itemId);
        if (!ficha) continue;

        /*
          Un canal caduca con el programa que se estaba viendo.

          No hay "por dónde ibas" en un directo: lo que tiene sentido es
          volver a lo que estabas viendo **mientras siga echándose**. Si el
          programa que hay ahora empezó después de que lo dejaras, el tuyo
          terminó y el canal se cae de la fila.

          Sin programación no se puede saber —272 de los 463 canales no tienen
          EPG—, así que ahí vale una ventana fija: pasadas dos horas, lo que
          estabas viendo ha terminado casi seguro.
        */
        const suyos = programas[ficha.id] ?? [];
        const echando = programaActual(suyos, ahora);
        const dejado = Date.parse(avance.visto);
        const sigue = echando
          ? echando.desde.getTime() <= dejado
          : Number.isFinite(dejado) && ahora.getTime() - dejado < CADUCA_DIRECTO_MS;
        if (!sigue) continue;

        elementos.push({
          id: `continuar:canal:${ficha.id}`,
          titulo: ficha.nombre,
          // Lo que echan, que es lo que uno reconoce: el nombre del canal ya
          // está arriba.
          detalle: echando?.titulo ?? ficha.grupo,
          valoracion: null,
          anio: null,
          resumen: null,
          logo: ficha.logo,
          // En directo no hay barrita que valga: el flujo no empieza ni acaba.
          avance: null,
          favorito: false,
          accion: { tipo: 'reproducir', medio: { clase: 'canal', id: ficha.id, titulo: ficha.nombre } },
        });
        continue;
      }

      if (avance.clase === 'episodio') {
        const ficha = porEpisodio.get(relevo ?? avance.itemId);
        if (!ficha) continue;
        const codigo = `T${ficha.temporada} E${ficha.numero}`;
        elementos.push({
          id: `continuar:episodio:${ficha.clave}`,
          // El nombre de la serie es lo que se busca con la vista; el capítulo
          // concreto va debajo, que es el orden en que uno lo lee.
          titulo: ficha.serieTitulo,
          detalle: ficha.titulo ? `${codigo} · ${ficha.titulo}` : codigo,
          valoracion: null,
          anio: null,
          resumen: null,
          logo: ficha.serieLogo,
          avance: visto,
          favorito: false,
          accion: {
            tipo: 'reproducir',
            medio: { clase: 'episodio', id: ficha.clave, titulo: `${ficha.serieTitulo} ${codigo}` },
          },
        });
      }
    }

    return elementos.length > 0 ? { tipo: 'carrusel', titulo: 'Seguir viendo', elementos } : null;
  }

  /**
   * Recoge las sugerencias preparadas por el servidor.
   *
   * No repinta nada por sí solo: se llaman antes de cargar, o se vuelve a
   * montar el inicio después. Que no haya ninguna es normal —casa sin
   * servidor, o servidor que todavía no ha preparado esta lista—.
   */
  usarPortadas(portadas: PortadaRemota[]): void {
    this.#portadas = portadas;
  }

  /**
   * La portada a partir de lo que preparó el servidor.
   *
   * Se comprueba que cada sugerencia exista de verdad en la base de este
   * aparato: el identificador se calcula igual en los dos lados, pero el
   * catálogo de aquí puede ser de antes de ayer. Lo que no esté, fuera; sin
   * ficha no hay ni carátula que enseñar ni URL que reproducir.
   */
  async #portadaDelServidor(modo: ModoInicio): Promise<FilaInicio | null> {
    const suyas = this.#portadas.filter(
      (portada) =>
        (modo !== 'series' && portada.clase === 'pelicula') || (modo !== 'peliculas' && portada.clase === 'serie'),
    );
    if (suyas.length === 0) return null;

    const [peliculas, series] = await Promise.all([
      this.#biblioteca.peliculasPorId(
        suyas.filter((portada) => portada.clase === 'pelicula').map((portada) => portada.id),
      ),
      this.#biblioteca.seriesPorId(suyas.filter((portada) => portada.clase === 'serie').map((portada) => portada.id)),
    ]);
    const enLaBase = new Set([...peliculas, ...series].map((ficha) => ficha.id));

    const elementos: Elemento[] = suyas
      .filter((portada) => enLaBase.has(portada.id))
      .slice(0, DESTACADAS)
      .map((portada) => ({
        id: `destacado:${portada.clase}:${portada.id}`,
        titulo: portada.titulo,
        detalle: primerosDelReparto(portada.reparto),
        genero: primerosGeneros(portada.genero),
        valoracion: portada.valoracion,
        anio: portada.anio,
        resumen: portada.sinopsis,
        logo: portada.imagen,
        avance: null,
        favorito: false,
        accion:
          portada.clase === 'serie'
            ? { tipo: 'entrar', pantalla: { tipo: 'serie', serieId: portada.id, titulo: portada.titulo } }
            : { tipo: 'reproducir', medio: { clase: 'pelicula', id: portada.id, titulo: portada.titulo } },
      }));

    return elementos.length > 0 ? { tipo: 'destacado', elementos } : null;
  }

  /**
   * Una fila por categoría del proveedor: acción, comedia, terror…
   *
   * El género de verdad —el que da `get_vod_info`— solo lo tenemos de un
   * puñado de películas, porque cuesta una petición por título. Las
   * categorías, en cambio, vienen con el catálogo y están todas: son las que
   * el proveedor usa para ordenar su lista y, salvo por los nombres a gritos,
   * dicen lo mismo.
   *
   * No caben todas —hay decenas—, así que se cogen las más gordas. Cuando la
   * afinidad del perfil tenga datos, mandará ella.
   */
  async #anadirCategorias(filas: FilaInicio[], modo: ModoInicio): Promise<void> {
    const clase = modo === 'series' ? 'serie' : 'pelicula';
    let categorias: GrupoFicha[];
    try {
      categorias = await this.#biblioteca.categorias(clase);
    } catch {
      // Sin categorías el inicio se pinta igual, con lo de arriba.
      return;
    }

    let cuenta: Record<string, number> = {};
    try {
      cuenta = (await this.#afinidad?.()) ?? {};
    } catch {
      // Sin afinidad se ordena por tamaño, que es como se empieza siempre.
    }

    const elegidas = ordenarCategorias(categorias, cuenta).slice(0, CATEGORIAS_EN_INICIO);

    for (const categoria of elegidas) {
      const fichas =
        clase === 'pelicula'
          ? await this.#biblioteca.peliculas({ limite: CARRUSEL, desde: 0, orden: 'recomendada', grupo: categoria.nombre })
          : await this.#biblioteca.series({ limite: CARRUSEL, desde: 0, orden: 'recomendada', grupo: categoria.nombre });
      if (fichas.length === 0) continue;

      filas.push({ tipo: 'carrusel', titulo: nombreDeCategoria(categoria.nombre), elementos: await this.#aCarrusel(fichas, clase) });
    }
  }

  /**
   * TV en directo, con la misma forma que el resto del inicio.
   *
   * Una fila por grupo de canales y **todos los canales**: aquí no se recorta
   * como en las películas. Un grupo de canales es una lista corta y cerrada
   * —"Deportes", "Noticias"—, no una categoría con tres mil títulos, así que
   * caben todos y esconder alguno sería esconder un canal.
   *
   * El orden es el mismo de siempre: primero los grupos que este perfil más
   * ve, y a igualdad los que más canales tienen.
   */
  async #montarDirecto(): Promise<void> {
    let grupos: GrupoFicha[] = [];
    try {
      grupos = await this.#biblioteca.grupos();
    } catch {
      grupos = [];
    }

    let cuenta: Record<string, number> = {};
    try {
      cuenta = (await this.#afinidad?.()) ?? {};
    } catch {
      // Sin afinidad, por tamaño.
    }

    const filas: FilaInicio[] = [];
    for (const grupo of ordenarCategorias(grupos, cuenta)) {
      const canales = await this.#biblioteca.canalesDeGrupo(grupo.nombre);
      if (canales.length === 0) continue;

      filas.push({
        tipo: 'carrusel',
        titulo: nombreDeCategoria(grupo.nombre),
        formato: 'canal',
        elementos: await this.#conFavoritos(canales.map(comoFichaDeCanal)),
      });
    }

    const fila = Math.min(this.#focoInicio.fila, Math.max(filas.length - 1, 0));
    this.#inicio = {
      filas,
      fila,
      columna: Math.min(this.#focoInicio.columna, Math.max((filas[fila]?.elementos.length ?? 1) - 1, 0)),
      modo: 'directo',
      destacado: 0,
      filtro: this.#filtroLista,
    };
  }

  /**
   * Mi Lista: lo que has marcado con el corazón, por clases.
   *
   * No lleva portada ni "seguir viendo": aquí no se sugiere nada, se enseña lo
   * que has elegido tú. Y lo que esté vacío no ocupa sitio —una fila de
   * "Canales" sin canales solo estorba—.
   */
  async #montarMiLista(): Promise<void> {
    const filtro = this.#filtroLista;
    const quiere = (clase: FiltroLista): boolean => filtro === 'todo' || filtro === clase;

    const [peliculas, series, canales] = await Promise.all([
      quiere('pelicula')
        ? this.#biblioteca.peliculasPorId(await this.#idsFavoritos('pelicula'))
        : Promise.resolve([]),
      quiere('serie') ? this.#biblioteca.seriesPorId(await this.#idsFavoritos('serie')) : Promise.resolve([]),
      quiere('canal') ? this.#biblioteca.canalesPorId(await this.#idsFavoritos('canal')) : Promise.resolve([]),
    ]);

    const filas: FilaInicio[] = [
      { tipo: 'filtros', elementos: FILTROS_LISTA.map((una) => filtroComoFicha(una, filtro)) },
    ];

    if (peliculas.length > 0) {
      filas.push({ tipo: 'carrusel', titulo: 'Películas', elementos: await this.#aCarrusel(peliculas, 'pelicula') });
    }
    if (series.length > 0) {
      filas.push({ tipo: 'carrusel', titulo: 'Series', elementos: await this.#aCarrusel(series, 'serie') });
    }
    if (canales.length > 0) {
      filas.push({
        tipo: 'carrusel',
        titulo: 'TV en directo',
        // El logotipo de un canal es apaisado y con transparencia: recortado a
        // un cartel 2:3 no se reconoce ninguno.
        formato: 'canal',
        // Ya se sabe que están marcados: es de lo que va esta pantalla.
        elementos: canales.map((canal) => ({ ...comoFichaDeCanal(canal), favorito: true })),
      });
    }

    const fila = Math.min(this.#focoInicio.fila, Math.max(filas.length - 1, 0));
    this.#inicio = {
      filas,
      fila,
      columna: Math.min(this.#focoInicio.columna, Math.max((filas[fila]?.elementos.length ?? 1) - 1, 0)),
      modo: 'lista',
      destacado: 0,
      filtro,
    };
  }

  /** Cambia con qué parte de Mi Lista se queda uno. */
  async elegirFiltro(filtro: FiltroLista): Promise<EstadoPantalla> {
    if (filtro === this.#filtroLista) return this.estado();
    this.#filtroLista = filtro;
    // El foco vuelve a la fila de filtros, que es donde acaba de pulsar.
    this.#focoInicio = { fila: 0, columna: FILTROS_LISTA.findIndex((una) => una.filtro === filtro) };
    await this.#montarInicio(this.#navegador.actual);
    return this.estado();
  }

  /**
   * Monta la pantalla de inicio entera.
   *
   * Las cuatro consultas van en paralelo porque son independientes y contra
   * SQLite tardan lo mismo juntas que la más lenta por separado.
   */
  async #montarInicio(pantalla: Pantalla): Promise<void> {
    if (pantalla.tipo !== 'inicio') {
      this.#inicio = null;
      return;
    }

    const modo = this.#modoInicio;
    if (modo === 'lista') {
      await this.#montarMiLista();
      return;
    }
    if (modo === 'directo') {
      await this.#montarDirecto();
      return;
    }

    const conPeliculas = modo !== 'series';
    const conSeries = modo !== 'peliculas';

    const [novedades, valoradas, series, seriesValoradas, continuar] = await Promise.all([
      conPeliculas ? this.#biblioteca.peliculas({ limite: CARRUSEL, desde: 0, orden: 'reciente' }) : [],
      conPeliculas ? this.#biblioteca.peliculas({ limite: CARRUSEL, desde: 0, orden: 'recomendada' }) : [],
      conSeries ? this.#biblioteca.series({ limite: CARRUSEL, desde: 0, orden: 'reciente' }) : [],
      modo === 'series' ? this.#biblioteca.series({ limite: CARRUSEL, desde: 0, orden: 'recomendada' }) : [],
      this.#filaContinuar(modo),
    ]);

    const filas: FilaInicio[] = [];

    /*
      Hasta cuatro sugerencias, que la vista va turnando. En "Todo" se mezclan
      películas y series —es lo que promete la pestaña—; en las otras dos, solo
      lo suyo.

      **Sin imagen apaisada no hay portada.** La carátula del proveedor es un
      cartel 2:3, y estirarlo a un rectángulo ancho deja la cara del actor
      ocupando la pantalla entera y borrosa. La imagen buena viene en la ficha
      larga (`backdrop_path`), así que se pregunta por unas cuantas candidatas
      y se cogen las primeras que la traigan; si no la trae ninguna, el inicio
      empieza directamente por "Seguir viendo".
    */
    const preparada = await this.#portadaDelServidor(modo);
    if (preparada) filas.push(preparada);

    const candidatas = preparada
      ? []
      : [
          ...(conPeliculas
            ? destacarVarias(novedades, CANDIDATAS).map((ficha) => ({ ficha, clase: 'pelicula' as const }))
            : []),
          ...(conSeries
            ? destacarVarias(series, CANDIDATAS).map((ficha) => ({ ficha, clase: 'serie' as const }))
            : []),
        ]
          .sort((a, b) => (b.ficha.valoracion ?? 0) - (a.ficha.valoracion ?? 0))
          .slice(0, CANDIDATAS);

    const fichas = await Promise.all(
      candidatas.map(async ({ ficha, clase }) => {
        try {
          return clase === 'pelicula'
            ? await this.#biblioteca.detalleDePelicula(ficha.id)
            : await this.#biblioteca.detalleDeSerie(ficha.id);
        } catch {
          return null;
        }
      }),
    );

    const conFondo = candidatas
      .map((candidata, indice) => ({ ...candidata, detalle: fichas[indice] ?? null }))
      .filter((candidata) => candidata.detalle?.fondo)
      .slice(0, DESTACADAS);

    if (conFondo.length > 0) {
      filas.push({
        tipo: 'destacado',
        elementos: conFondo.map(({ ficha, clase, detalle }) => ({
          id: `destacado:${clase}:${ficha.id}`,
          titulo: ficha.titulo,
          // El reparto va recortado: la portada no es una ficha técnica y una
          // lista de doce nombres no la lee nadie.
          detalle: primerosDelReparto(detalle?.reparto ?? null),
          genero: primerosGeneros(detalle?.genero ?? null),
          valoracion: ficha.valoracion,
          anio: ficha.anio,
          resumen: detalle?.sinopsis ?? null,
          logo: detalle!.fondo,
          avance: null,
          favorito: false,
          accion:
            clase === 'serie'
              ? { tipo: 'entrar' as const, pantalla: { tipo: 'serie' as const, serieId: ficha.id, titulo: ficha.titulo } }
              : { tipo: 'reproducir' as const, medio: { clase: 'pelicula' as const, id: ficha.id, titulo: ficha.titulo } },
        })),
      });
    }

    if (continuar) filas.push(continuar);

    const anadir = async (
      titulo: string,
      fichas: Array<{ id: string; titulo: string; anio: number | null; valoracion: number | null; logo: string | null }>,
      clase: 'pelicula' | 'serie',
    ): Promise<void> => {
      if (fichas.length === 0) return;
      const elementos = await this.#aCarrusel(fichas, clase);
      if (elementos.length > 0) filas.push({ tipo: 'carrusel', titulo, elementos });
    };

    await anadir(modo === 'peliculas' ? 'Novedades' : 'Películas recién llegadas', novedades, 'pelicula');
    await anadir(modo === 'series' ? 'Novedades' : 'Series recién llegadas', series, 'serie');
    /*
      "Recomendadas" y no "mejor valoradas": el proveedor reparte dieces a
      mansalva, así que la nota sirve para descartar y no para ordenar. Lo que
      manda aquí es el año y lo último que ha entrado.
    */
    await anadir('Recomendadas', modo === 'series' ? seriesValoradas : valoradas, modo === 'series' ? 'serie' : 'pelicula');

    await this.#anadirCategorias(filas, modo);

    // El foco vuelve donde estaba, recortado por si las filas han cambiado.
    // Vale para dos casos: volver de una sección, y una sincronización que
    // entre mientras estás mirando.
    const fila = Math.min(this.#focoInicio.fila, Math.max(filas.length - 1, 0));
    const cuantos = filas[fila] ? elementosDeFila(filas[fila]!).length : 0;
    const columna = Math.min(this.#focoInicio.columna, Math.max(cuantos - 1, 0));

    const portada = filas[0];
    const cuantasPortadas = portada?.tipo === 'destacado' ? portada.elementos.length : 0;

    this.#focoInicio = { fila, columna };
    this.#inicio = {
      filas,
      // El filtro solo pinta en Mi Lista, pero el estado lo lleva siempre para
      // que la vista no tenga que preguntarse si existe.
      filtro: this.#filtroLista,
      fila,
      columna,
      modo,
      destacado: cuantasPortadas > 0 ? Math.min(this.#inicio?.destacado ?? 0, cuantasPortadas - 1) : 0,
    };
  }

  /**
   * Cambia la pestaña del inicio y lo recarga.
   *
   * El foco vuelve arriba a propósito: lo que hay debajo es otro contenido, y
   * dejar el foco en la cuarta fila de unos carruseles que ya no existen es
   * peor que empezar de nuevo.
   */
  async elegirModo(modo: ModoInicio): Promise<EstadoPantalla> {
    // La pestaña **solo filtra**. Antes, pulsarla estando ya puesta entraba en
    // una rejilla con barra de categorías, que era el mismo contenido con otra
    // cara: dos formas de ver lo mismo y ninguna manera de saber en cuál
    // estabas. Ahora hay una sola.
    if (modo === this.#modoInicio) return this.estado();

    this.#modoInicio = modo;
    this.#focoInicio = { fila: 0, columna: 0 };
    return this.cargar();
  }

  /**
   * Pasa a otra de las sugerencias de la portada.
   *
   * Lo llama la vista con su reloj. No recarga nada: las cuatro ya están
   * montadas, solo cambia cuál se pinta.
   */
  rotarDestacado(indice: number): EstadoPantalla {
    const inicio = this.#inicio;
    const portada = inicio?.filas[0];
    if (!inicio || portada?.tipo !== 'destacado' || portada.elementos.length === 0) return this.estado();

    inicio.destacado = ((indice % portada.elementos.length) + portada.elementos.length) % portada.elementos.length;
    return this.estado();
  }

  /** Apunta dónde ha quedado el foco del inicio, para cuando se vuelva. */
  #recordarInicio(): EstadoPantalla {
    if (this.#inicio) this.#focoInicio = { fila: this.#inicio.fila, columna: this.#inicio.columna };
    return this.estado();
  }

  /** Carga la pantalla actual desde cero. Se llama al entrar y al volver. */
  async cargar(): Promise<EstadoPantalla> {
    this.#cargandoMas = false;
    const pantalla = this.#navegador.actual;
    await this.#montarFicha(pantalla);
    await this.#montarInicio(pantalla);
    await this.#montarLateral(pantalla);
    const { titulo, elementos, hayMas } = await this.#contenido(pantalla, 0);
    this.#titulo = titulo;
    this.#elementos = await this.#conFavoritos(await this.#conAvances(elementos));
    this.#hayMas = hayMas;
    // El foco vuelve donde estaba, recortado por si la lista encogió.
    this.#foco = Math.min(this.#navegador.focoGuardado(), Math.max(elementos.length - 1, 0));
    return this.estado();
  }

  /**
   * Mueve el foco y, si se acerca al final de lo cargado, pide la página
   * siguiente. Devuelve el estado ya actualizado.
   */
  async mover(direccion: Direccion): Promise<EstadoPantalla> {
    const lateral = this.#lateral;
    const inicio = this.#inicio;

    /*
      En el inicio el foco va en dos ejes: arriba y abajo cambian de fila,
      izquierda y derecha recorren la de dentro. Al cambiar de fila la columna
      se recorta a lo que quepa, para no quedarse apuntando a un hueco cuando
      la siguiente tiene menos fichas.
    */
    if (inicio) {
      if (direccion === 'arriba' || direccion === 'abajo') {
        const destino =
          direccion === 'arriba' ? Math.max(0, inicio.fila - 1) : Math.min(inicio.filas.length - 1, inicio.fila + 1);
        if (destino === inicio.fila) return this.estado();

        inicio.fila = destino;
        const cuantos = elementosDeFila(inicio.filas[destino]!).length;
        inicio.columna = Math.min(inicio.columna, Math.max(cuantos - 1, 0));
        return this.#recordarInicio();
      }

      // En la portada, izquierda y derecha no hacen nada: las sugerencias se
      // turnan solas y moverse entre ellas confundiría los dos mecanismos.
      const fila = inicio.filas[inicio.fila]!;
      if (fila.tipo === 'destacado') return this.estado();

      const cuantos = fila.elementos.length;
      if (direccion === 'izquierda') inicio.columna = Math.max(0, inicio.columna - 1);
      if (direccion === 'derecha') inicio.columna = Math.min(cuantos - 1, inicio.columna + 1);
      return this.#recordarInicio();
    }

    // Con el foco en la barra, arriba y abajo recorren categorías y la derecha
    // devuelve a la rejilla.
    if (lateral?.dentro) {
      if (direccion === 'derecha') {
        lateral.dentro = false;
        return this.estado();
      }
      if (direccion !== 'arriba' && direccion !== 'abajo') return this.estado();

      const antes = lateral.foco;
      lateral.foco =
        direccion === 'arriba'
          ? Math.max(0, lateral.foco - 1)
          : Math.min(lateral.opciones.length - 1, lateral.foco + 1);
      if (lateral.foco === antes) return this.estado();

      /*
        Posarse en un grupo ya enseña lo que tiene dentro, sin pulsar aceptar.
        Es como se recorre la lista de canales de cualquier televisor: uno baja
        por las categorías y va viendo qué hay en cada una. Aceptar queda para
        entrar en la rejilla, no para "aplicar" el grupo.
      */
      const opcion = lateral.opciones[lateral.foco];
      if (opcion) await this.#aplicarCategoria(opcion, { conservarBarra: true });
      return this.estado();
    }

    // Desde la primera columna, la izquierda salta a la barra.
    if (lateral && direccion === 'izquierda' && this.#foco % this.columnas === 0) {
      lateral.dentro = true;
      return this.estado();
    }

    const destino = mover(this.#foco, direccion, { total: this.#elementos.length, columnas: this.columnas });
    this.#foco = destino;
    this.#navegador.recordarFoco(destino);

    // Se pide más cuando queda menos de una fila por delante, para que la
    // espera no se note al llegar al borde.
    const margen = this.columnas;
    if (this.#hayMas && destino >= this.#elementos.length - margen) {
      const siguiente = await this.#contenido(this.#navegador.actual, this.#elementos.length);
      this.#elementos = [
        ...this.#elementos,
        ...(await this.#conFavoritos(await this.#conAvances(siguiente.elementos))),
      ];
      this.#hayMas = siguiente.hayMas;
    }

    return this.estado();
  }

  /**
   * Reúne lo que se enseña de una película o de una serie.
   *
   * Dos consultas: la ficha corta —título, año, nota y cartel—, que ya está en
   * la base, y la larga —sinopsis, reparto, fondo y tráiler—, que la primera
   * vez cuesta una petición al panel y luego queda guardada. Si la larga no
   * llega, la pantalla sale igual con lo que haya: es lo mismo que hace la
   * portada del inicio.
   */
  async #montarFicha(pantalla: Pantalla): Promise<void> {
    if (pantalla.tipo !== 'ficha') {
      this.#ficha = null;
      return;
    }

    const esPelicula = pantalla.clase === 'pelicula';
    const [corta] = esPelicula
      ? await this.#biblioteca.peliculasPorId([pantalla.id])
      : await this.#biblioteca.seriesPorId([pantalla.id]);

    const larga = await (esPelicula
      ? this.#biblioteca.detalleDePelicula(pantalla.id)
      : this.#biblioteca.detalleDeSerie(pantalla.id));

    const marcados = this.#favoritos ? await this.#favoritos.listar(pantalla.clase) : [];

    this.#ficha = {
      clase: pantalla.clase,
      id: pantalla.id,
      titulo: corta?.titulo ?? pantalla.titulo,
      anio: corta?.anio ?? null,
      valoracion: corta?.valoracion ?? null,
      // El género largo del panel —"Comedia, Animación, Familia"— se recorta
      // igual que en las carátulas: tres caben, seis no.
      genero: primerosGeneros(larga?.genero ?? corta?.genero ?? null),
      sinopsis: larga?.sinopsis ?? null,
      reparto: larga?.reparto ?? null,
      cartel: corta?.logo ?? null,
      fondo: larga?.fondo ?? null,
      favorito: marcados.includes(pantalla.id),
    };
    this.#trailer = larga?.trailer ?? null;
  }

  /**
   * Abre la ficha de una película o de una serie.
   *
   * No se llega pulsando —el toque normal reproduce— sino desde el menú de
   * mantener pulsado, que es donde están también Mi Lista y Descargar.
   */
  async abrirFicha(clase: 'pelicula' | 'serie', id: string, titulo: string): Promise<EstadoPantalla> {
    this.#navegador.entrar({ tipo: 'ficha', clase, id, titulo });
    return this.cargar();
  }

  /**
   * Trae la página siguiente sin tocar el foco.
   *
   * Con mando, `mover` ya la pide sola al acercarse el foco al final. Con el
   * dedo no hay foco que valga: la lista avisa cuando el usuario llega abajo.
   */
  async cargarMas(): Promise<EstadoPantalla> {
    if (!this.#hayMas || this.#cargandoMas) return this.estado();

    this.#cargandoMas = true;
    try {
      const siguiente = await this.#contenido(this.#navegador.actual, this.#elementos.length);
      this.#elementos = [
        ...this.#elementos,
        ...(await this.#conFavoritos(await this.#conAvances(siguiente.elementos))),
      ];
      this.#hayMas = siguiente.hayMas;
    } finally {
      this.#cargandoMas = false;
    }
    return this.estado();
  }

  /**
   * Lleva el foco a un elemento concreto.
   *
   * Con mando el foco se mueve paso a paso, pero en una tablet se toca
   * directamente la ficha: el dedo elige, y luego se acepta.
   */
  enfocar(indice: number): EstadoPantalla {
    if (this.#elementos.length === 0) return this.estado();
    this.#foco = Math.min(Math.max(indice, 0), this.#elementos.length - 1);
    this.#navegador.recordarFoco(this.#foco);
    return this.estado();
  }

  /**
   * Lo mismo en el inicio, donde el foco tiene dos ejes.
   *
   * El dedo toca una ficha concreta de una fila concreta, así que no vale el
   * índice único de la rejilla.
   */
  enfocarEnInicio(fila: number, columna: number): EstadoPantalla {
    const inicio = this.#inicio;
    if (!inicio || inicio.filas.length === 0) return this.estado();

    inicio.fila = Math.min(Math.max(fila, 0), inicio.filas.length - 1);
    const cuantos = elementosDeFila(inicio.filas[inicio.fila]!).length;
    inicio.columna = Math.min(Math.max(columna, 0), Math.max(cuantos - 1, 0));
    return this.#recordarInicio();
  }

  /** El usuario pulsa OK sobre lo enfocado. */
  async aceptar(): Promise<{
    estado: EstadoPantalla;
    reproducir: Reproducible | null;
    /** Algo que abrir fuera de la aplicación: el tráiler. */
    abrir?: string;
    /** Algo que mandar a la cola de descargas. */
    descargar?: Reproducible;
  }> {
    // En el inicio, aceptar actúa sobre la ficha enfocada de su fila. Si es
    // una película, reproduce —y el reproductor ya reanuda por donde iba, que
    // eso lo decide él con `avanceDe`—; si es una sección o una serie, entra.
    const inicio = this.#inicio;
    if (inicio) {
      const fila = inicio.filas[inicio.fila]!;
      // En la portada se acepta sobre la que se está enseñando, que la elige
      // el reloj de la vista y no el foco.
      const elemento =
        fila.tipo === 'destacado' ? fila.elementos[inicio.destacado] : fila.elementos[inicio.columna];
      if (!elemento) return { estado: this.estado(), reproducir: null };

      if (elemento.accion.tipo === 'reproducir') {
        return { estado: this.estado(), reproducir: elemento.accion.medio };
      }
      if (elemento.accion.tipo === 'filtrar') {
        return { estado: await this.elegirFiltro(elemento.accion.filtro), reproducir: null };
      }
      // Las demás acciones son botones de una ficha, y en el inicio no hay.
      if (elemento.accion.tipo !== 'entrar') return { estado: this.estado(), reproducir: null };

      this.#navegador.entrar(elemento.accion.pantalla, 0);
      return { estado: await this.cargar(), reproducir: null };
    }

    const lateral = this.#lateral;
    if (lateral?.dentro) {
      const opcion = lateral.opciones[lateral.foco];
      if (opcion) {
        return {
          estado: await this.elegirCategoria(opcion.grupo),
          reproducir: null,
        };
      }
      return { estado: this.estado(), reproducir: null };
    }

    const elemento = this.#elementos[this.#foco];
    if (!elemento) return { estado: this.estado(), reproducir: null };

    if (elemento.accion.tipo === 'reproducir') {
      return { estado: this.estado(), reproducir: elemento.accion.medio };
    }
    if (elemento.accion.tipo === 'filtrar') {
      return { estado: await this.elegirFiltro(elemento.accion.filtro), reproducir: null };
    }
    if (elemento.accion.tipo === 'marcar') {
      // Se recarga la pantalla porque el botón cambia de texto: "Añadir a Mi
      // Lista" pasa a "Quitar de Mi Lista".
      await this.marcar(elemento.accion.medio);
      return { estado: await this.cargar(), reproducir: null };
    }
    if (elemento.accion.tipo === 'descargar') {
      return { estado: this.estado(), reproducir: null, descargar: elemento.accion.medio };
    }
    if (elemento.accion.tipo === 'enlace') {
      // La vista es quien sabe abrir algo fuera: aquí no hay ni navegador ni
      // aplicaciones del sistema.
      return { estado: this.estado(), reproducir: null, abrir: elemento.accion.url };
    }

    this.#navegador.entrar(elemento.accion.pantalla, this.#foco);
    return { estado: await this.cargar(), reproducir: null };
  }

  /**
   * Atrás. Devuelve 'salir' cuando ya estábamos en el inicio, para que la vista
   * pida confirmación y cierre la aplicación.
   */
  async atras(): Promise<{ resultado: ResultadoAtras; estado: EstadoPantalla }> {
    const resultado = this.#navegador.atras();
    if (resultado === 'salir') return { resultado, estado: this.estado() };
    return { resultado, estado: await this.cargar() };
  }

  /**
   * Cambia la categoría que se está viendo.
   *
   * Reemplaza la pantalla en vez de apilar otra: sigues en "Películas", así que
   * "atrás" tiene que salir de la sección, no ir deshaciendo las categorías que
   * hayas ido mirando.
   */
  /**
   * Cambia lo que se está viendo a la categoría dada.
   *
   * `conservarBarra` deja el foco donde estaba: al recorrer los grupos con el
   * mando, el contenido cambia debajo pero uno sigue en la barra.
   */
  async #aplicarCategoria(
    opcion: OpcionLateral,
    { conservarBarra = false } = {},
  ): Promise<EstadoPantalla> {
    const estado = await this.elegirCategoria(opcion.grupo);
    if (conservarBarra && this.#lateral) {
      this.#lateral.dentro = true;
      return { ...estado, lateral: this.#lateral };
    }
    return estado;
  }

  async elegirCategoria(grupo: string | null): Promise<EstadoPantalla> {
    const pantalla = this.#navegador.actual;

    // La "categoría" de la única pantalla que conserva barra lateral es la
    // temporada de una serie, y el número viene como texto porque la barra es
    // la misma que había en las rejillas.
    if (pantalla.tipo !== 'serie') return this.estado();

    const temporada = Number(grupo);
    if (!Number.isFinite(temporada)) return this.estado();
    this.#navegador.reemplazar({ ...pantalla, temporada });

    const estado = await this.cargar();
    // El foco vuelve a la rejilla: se acaba de elegir qué mirar.
    if (this.#lateral) this.#lateral.dentro = false;
    return { ...estado, lateral: this.#lateral };
  }

  /**
   * Marca o desmarca lo enfocado como favorito de este perfil.
   *
   * Se activa con una pulsación larga sobre la ficha: es el gesto que no
   * choca con el toque normal, que reproduce o entra.
   */
  async alternarFavorito(indice = this.#foco): Promise<EstadoPantalla> {
    const elemento = this.#elementos[indice];
    if (!elemento) return this.estado();
    return this.#marcar(elemento, (marcado) => {
      this.#elementos = this.#elementos.map((otro, posicion) =>
        posicion === indice ? { ...otro, favorito: marcado } : otro,
      );
    });
  }

  /**
   * Lo mismo, pero sobre una ficha del inicio.
   *
   * En el inicio las fichas no están en `#elementos` —viven en las filas—, y
   * el gesto tiene que ser el mismo en todas partes: mantener pulsado añade a
   * Mi Lista, se esté donde se esté.
   */
  async alternarFavoritoEnInicio(fila: number, columna: number): Promise<EstadoPantalla> {
    const inicio = this.#inicio;
    const elemento = inicio?.filas[fila]?.elementos[columna];
    if (!inicio || !elemento) return this.estado();

    return this.#marcar(elemento, (marcado) => {
      this.#inicio = {
        ...inicio,
        filas: inicio.filas.map((una, posicionFila) =>
          posicionFila !== fila
            ? una
            : {
                ...una,
                elementos: una.elementos.map((otro, posicion) =>
                  posicion === columna ? { ...otro, favorito: marcado } : otro,
                ),
              },
        ),
      };
    });
  }

  /**
   * Marca o desmarca algo por su identificador, sin pasar por una ficha.
   *
   * Es lo que usa el botón de la pantalla de información, donde no hay
   * carátula enfocada que alternar.
   */
  async marcar(medio: Marcable): Promise<void> {
    if (!this.#favoritos) return;
    // Un episodio suelto no se marca: lo que uno guarda es la serie.
    if (medio.clase === 'episodio') return;
    await this.#favoritos.alternar(medio.clase, medio.id, medio.titulo);
  }

  /** Marca o desmarca una ficha y deja que quien llame se apunte el cambio. */
  async #marcar(elemento: Elemento, anotar: (marcado: boolean) => void): Promise<EstadoPantalla> {
    if (!this.#favoritos) return this.estado();

    const marcable = claseFavorita(elemento);
    if (!marcable) return this.estado();

    anotar(await this.#favoritos.alternar(marcable.clase, marcable.id, elemento.titulo));
    return this.estado();
  }

  /**
   * Abre el buscador, acotado a la pestaña en la que estés.
   *
   * Antes se acotaba a la rejilla y a su categoría; sin rejilla, lo que dice
   * dónde estás es la pestaña del inicio.
   */
  async abrirBuscador(): Promise<EstadoPantalla> {
    const ambito =
      this.#modoInicio === 'peliculas'
        ? { tipo: 'pelicula' as const }
        : this.#modoInicio === 'series'
          ? { tipo: 'serie' as const }
          : this.#modoInicio === 'directo'
            ? { tipo: 'canal' as const }
            : undefined;

    this.#navegador.entrar({ tipo: 'buscador', ambito, texto: '' }, this.#foco);
    return this.cargar();
  }

  /** Lo que se va tecleando. Busca dentro del ámbito con el que se abrió. */
  async buscar(texto: string): Promise<EstadoPantalla> {
    const pantalla = this.#navegador.actual;
    if (pantalla.tipo !== 'buscador') return this.estado();

    this.#navegador.reemplazar({ ...pantalla, texto });
    return this.cargar();
  }

  /**
   * Añade a cada ficha lo que se lleva visto de ella.
   *
   * Se pregunta por todas las de la pantalla a la vez: una consulta por ficha
   * serían sesenta por pantalla, y con el dedo se cargan de sesenta en sesenta.
   */
  async #conAvances(elementos: Elemento[]): Promise<Elemento[]> {
    if (!this.#avances) return elementos;

    // Solo tiene sentido en lo que se reproduce: un grupo no se ve a medias.
    const medios = elementos
      .filter((elemento) => elemento.accion.tipo === 'reproducir')
      .map((elemento) => {
        const medio = (elemento.accion as { tipo: 'reproducir'; medio: Reproducible }).medio;
        return { clase: medio.clase as ClaseMedio, id: medio.id };
      });

    if (medios.length === 0) return elementos;

    let vistos: Record<string, number> = {};
    try {
      vistos = await this.#avances(medios);
    } catch {
      // Sin historial se pinta la rejilla igual, solo que sin barritas.
      return elementos;
    }

    return elementos.map((elemento) => {
      if (elemento.accion.tipo !== 'reproducir') return elemento;
      const medio = elemento.accion.medio;
      const proporcion = vistos[claveDeMedio(medio.clase as ClaseMedio, medio.id)];
      return proporcion ? { ...elemento, avance: proporcion } : elemento;
    });
  }

  /**
   * Marca con el corazón lo que este perfil tenga guardado.
   *
   * Una consulta por clase y no una por ficha: en una rejilla de sesenta
   * carátulas serían sesenta viajes a la base para pintar un icono.
   */
  async #conFavoritos(elementos: Elemento[]): Promise<Elemento[]> {
    if (!this.#favoritos || elementos.length === 0) return elementos;

    const clases = new Set<ClaseMedio>();
    for (const elemento of elementos) {
      const marcable = claseFavorita(elemento);
      if (marcable) clases.add(marcable.clase);
    }
    if (clases.size === 0) return elementos;

    const marcados = new Set<string>();
    try {
      for (const clase of clases) {
        for (const id of await this.#favoritos.listar(clase)) marcados.add(claveDeMedio(clase, id));
      }
    } catch {
      // Sin favoritos la rejilla se pinta igual, solo que sin corazones.
      return elementos;
    }

    return elementos.map((elemento) => {
      const marcable = claseFavorita(elemento);
      if (!marcable) return elemento;
      return marcados.has(claveDeMedio(marcable.clase, marcable.id))
        ? { ...elemento, favorito: true }
        : elemento;
    });
  }

  async #idsFavoritos(clase: ClaseMedio): Promise<string[]> {
    if (!this.#favoritos) return [];
    try {
      return await this.#favoritos.listar(clase);
    } catch {
      return [];
    }
  }

  /**
   * Monta la barra de la izquierda de la pantalla actual.
   *
   * En las tres secciones son las categorías del proveedor, con "Todas" y
   * "Favoritos" por delante; dentro de una serie, sus temporadas.
   */
  async #montarLateral(pantalla: Pantalla): Promise<void> {
    const opciones = await this.#opcionesLaterales(pantalla);
    if (!opciones) {
      this.#lateral = null;
      return;
    }

    // Qué hay marcado en la barra: hoy solo queda una, la de las temporadas
    // de una serie.
    const activa = pantalla.tipo === 'serie' ? String(pantalla.temporada ?? '') : null;
    const foco = Math.max(0, opciones.findIndex((opcion) => opcion.grupo === activa));
    // Se conserva si el foco estaba en la barra: recargar por elegir categoría
    // no debe sacarlo de ahí a mitad de recorrido.
    this.#lateral = {
      opciones,
      activa,
      foco,
      dentro: this.#lateral?.dentro ?? false,
    };
  }

  async #opcionesLaterales(pantalla: Pantalla): Promise<OpcionLateral[] | null> {
    if (pantalla.tipo === 'serie') {
      const temporadas = await this.#biblioteca.temporadas(pantalla.serieId);
      if (temporadas.length === 0) return null;
      return temporadas.map((temporada) => ({
        grupo: String(temporada.numero),
        nombre: `Temporada ${temporada.numero}`,
        cuantos: temporada.episodios,
      }));
    }

    return null;
  }

  /**
   * "Todas" va siempre la primera, antes de lo del proveedor.
   *
   * Lo marcado ya no vive aquí: tiene su propia pestaña arriba, Mi Lista.
   * Tenerlo en los dos sitios era el mismo contenido por dos caminos, y en la
   * barra lateral se mezclaba con las categorías del proveedor, que son otra
   * cosa.
   */
  #conCabeceras(todas: string, categorias: OpcionLateral[]): OpcionLateral[] {
    return [{ grupo: null, nombre: todas, cuantos: null }, ...categorias];
  }

  async #contenido(
    pantalla: Pantalla,
    desde: number,
  ): Promise<{ titulo: string; elementos: Elemento[]; hayMas: boolean }> {
    const pagina = { limite: this.#tamanoPagina, desde, orden: this.#orden };

    switch (pantalla.tipo) {
      // El inicio no llena la rejilla: sus fichas viven en `inicio.filas`, que
      // monta `#montarInicio`. Aquí solo queda el título.
      case 'inicio':
        return { titulo: 'Biblioteca', hayMas: false, elementos: [] };

      /*
        Los "elementos" de una ficha son sus botones. Se modelan como el resto
        para que el mando los recorra igual —arriba, abajo, aceptar— sin
        inventar otro sitio donde pueda estar el foco, que es lo mismo que se
        hizo con el selector de Mi Lista.
      */
      case 'ficha': {
        const ficha = this.#ficha;
        const titulo = ficha?.titulo ?? pantalla.titulo;
        /*
          Una serie se marca pero no se reproduce: lo que se ve es un
          episodio. Por eso hay dos formas del mismo contenido y no una.
        */
        const marcable: Marcable = { clase: pantalla.clase, id: pantalla.id, titulo };
        const medio: Reproducible = { clase: 'pelicula', id: pantalla.id, titulo };

        const botones: Elemento[] = [];
        const boton = (id: string, titulo: string, accion: Accion): Elemento => ({
          id,
          titulo,
          detalle: null,
          genero: null,
          valoracion: null,
          anio: null,
          resumen: null,
          logo: null,
          avance: null,
          favorito: false,
          accion,
        });

        if (pantalla.clase === 'pelicula') {
          botones.push(boton('reproducir', 'Reproducir', { tipo: 'reproducir', medio }));
        } else {
          // En una serie no hay nada que reproducir todavía: hay que elegir
          // episodio, y para eso está su pantalla.
          botones.push(
            boton('episodios', 'Ver episodios', {
              tipo: 'entrar',
              pantalla: { tipo: 'serie', serieId: pantalla.id, titulo },
            }),
          );
        }

        botones.push(
          boton('lista', ficha?.favorito ? 'Quitar de Mi Lista' : 'Añadir a Mi Lista', {
            tipo: 'marcar',
            medio: marcable,
          }),
        );

        // Descargar solo lo que es un fichero: una serie no se descarga, se
        // descargan sus episodios.
        if (pantalla.clase === 'pelicula') {
          botones.push(boton('descargar', 'Descargar', { tipo: 'descargar', medio }));
        }

        if (this.#trailer) {
          botones.push(boton('trailer', 'Ver tráiler', { tipo: 'enlace', url: urlDeTrailer(this.#trailer) }));
        }

        return { titulo, elementos: botones, hayMas: false };
      }

      case 'serie': {
        // La temporada elegida está en la barra de la izquierda; sin elegir,
        // la primera, que es lo que uno espera al abrir una serie.
        const temporadas = await this.#biblioteca.temporadas(pantalla.serieId);
        const numero = pantalla.temporada ?? temporadas[0]?.numero;
        if (numero === undefined) {
          return { titulo: pantalla.titulo, elementos: [], hayMas: false };
        }

        const episodios = await this.#biblioteca.episodios(pantalla.serieId, numero);
        return {
          titulo: `${pantalla.titulo} · Temporada ${numero}`,
          hayMas: false,
          elementos: episodios.map((episodio) => {
            // Sin título propio se numera, que es mejor que repetir el nombre
            // de la serie en las treinta filas.
            const nombre = episodio.titulo ?? `Episodio ${episodio.numero}`;
            return {
              id: String(episodio.id),
              titulo: `${episodio.numero}. ${nombre}`,
              detalle: episodio.segundos ? duracion(episodio.segundos) : null,
              valoracion: episodio.valoracion,
              anio: episodio.anio,
              resumen: episodio.resumen,
              logo: episodio.imagen,
              avance: null,
              favorito: false,
              accion: {
                tipo: 'reproducir',
                // La clave, no el número de fila: es lo que se guarda en el
                // historial y lo único que significa lo mismo en la tablet.
                medio: {
                  clase: 'episodio',
                  id: claveDeEpisodio(pantalla.serieId, episodio.temporada, episodio.numero),
                  titulo: nombre,
                },
              },
            };
          }),
        };
      }

      case 'buscador': {
        const texto = (pantalla.texto ?? '').trim();
        const donde = pantalla.ambito?.grupo
          ? ` en ${pantalla.ambito.grupo}`
          : pantalla.ambito?.tipo === 'pelicula'
            ? ' en Películas'
            : pantalla.ambito?.tipo === 'serie'
              ? ' en Series'
              : '';

        if (!texto) return { titulo: `Buscar${donde}`, elementos: [], hayMas: false };

        const resultados = await this.#biblioteca.buscar(texto, pantalla.ambito);

        /*
          La búsqueda solo devuelve tipo, identificador y título: lo justo para
          ordenar por relevancia. Las carátulas hay que ir a buscarlas, como en
          los favoritos y en "seguir viendo", y en las tres consultas a la vez
          porque son independientes.
        */
        const idsDe = (tipo: Resultado['tipo']): string[] =>
          resultados.filter((resultado) => resultado.tipo === tipo).map((resultado) => resultado.id);

        const [peliculas, series, canales] = await Promise.all([
          this.#biblioteca.peliculasPorId(idsDe('pelicula')),
          this.#biblioteca.seriesPorId(idsDe('serie')),
          this.#biblioteca.canalesPorId(idsDe('canal')),
        ]);
        const porPelicula = new Map(peliculas.map((ficha) => [ficha.id, ficha]));
        const porSerie = new Map(series.map((ficha) => [ficha.id, ficha]));
        const porCanal = new Map(canales.map((ficha) => [ficha.id, ficha]));

        return {
          titulo: `Buscar${donde}`,
          hayMas: false,
          // Se recorre `resultados` y no las fichas encontradas para conservar
          // el orden de relevancia que da la búsqueda.
          elementos: resultados.flatMap((resultado): Elemento[] => {
            if (resultado.tipo === 'serie') {
              const ficha = porSerie.get(resultado.id);
              return [
                {
                  id: `res:serie:${resultado.id}`,
                  titulo: ficha?.titulo ?? resultado.titulo,
                  detalle: 'Serie',
                  valoracion: ficha?.valoracion ?? null,
                  anio: ficha?.anio ?? null,
                  resumen: null,
                  logo: ficha?.logo ?? null,
                  avance: null,
                  favorito: false,
                  // Aceptar sobre una serie entra en ella, con sus temporadas
                  // en la barra: no devuelve al listado de series.
                  accion: {
                    tipo: 'entrar',
                    pantalla: { tipo: 'serie', serieId: resultado.id, titulo: ficha?.titulo ?? resultado.titulo },
                  },
                },
              ];
            }

            if (resultado.tipo === 'canal') {
              const ficha = porCanal.get(resultado.id);
              return [
                {
                  id: `res:canal:${resultado.id}`,
                  titulo: ficha?.nombre ?? resultado.titulo,
                  detalle: ficha?.grupo ?? 'Canal',
                  valoracion: null,
                  anio: null,
                  resumen: null,
                  logo: ficha?.logo ?? null,
                  avance: null,
                  favorito: false,
                  accion: {
                    tipo: 'reproducir',
                    medio: { clase: 'canal', id: resultado.id, titulo: ficha?.nombre ?? resultado.titulo },
                  },
                },
              ];
            }

            const ficha = porPelicula.get(resultado.id);
            return [
              {
                id: `res:pelicula:${resultado.id}`,
                titulo: ficha?.titulo ?? resultado.titulo,
                detalle: null,
                valoracion: ficha?.valoracion ?? null,
                anio: ficha?.anio ?? null,
                resumen: null,
                logo: ficha?.logo ?? null,
                avance: null,
                favorito: false,
                accion: {
                  tipo: 'reproducir',
                  medio: { clase: 'pelicula', id: resultado.id, titulo: ficha?.titulo ?? resultado.titulo },
                },
              },
            ];
          }),
        };
      }
    }
  }
}

/** Atajo para las fichas que solo llevan a otra pantalla. */
/** Un canal con la forma de ficha que entiende una fila del inicio. */
function comoFichaDeCanal(canal: CanalFicha): Elemento {
  return {
    id: `canal:${canal.id}`,
    titulo: canal.nombre,
    detalle: canal.grupo,
    genero: null,
    valoracion: null,
    anio: null,
    resumen: null,
    logo: canal.logo,
    avance: null,
    favorito: false,
    accion: { tipo: 'reproducir', medio: { clase: 'canal', id: canal.id, titulo: canal.nombre } },
  };
}

/**
 * En qué orden salen las categorías del inicio.
 *
 * Primero **lo que este perfil ve más**, y a igualdad —o sin haber visto nada
 * todavía— las que más contenido tienen. Así el inicio arranca con algo
 * razonable el primer día y se va pareciendo a ti según lo usas.
 *
 * La cuenta es de reproducciones: mirar una carátula no es verla.
 */
export function ordenarCategorias(categorias: GrupoFicha[], afinidad: Record<string, number>): GrupoFicha[] {
  return [...categorias].sort(
    (a, b) => (afinidad[b.nombre] ?? 0) - (afinidad[a.nombre] ?? 0) || (b.canales ?? 0) - (a.canales ?? 0),
  );
}

/**
 * El nombre de una categoría del proveedor, presentable.
 *
 * Vienen a gritos y con la sección delante —"PELICULAS ACCION", "SERIES |
 * DRAMA"—, que dentro de su sección sobra. Se le quita eso y se deja en
 * capital inicial, que es como se lee una fila.
 */
export function nombreDeCategoria(bruto: string): string {
  const limpio = bruto
    .replace(/^(pel[ií]culas?|cine|series?|tv|canales?)\b[\s|:·-]*/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  const texto = limpio || bruto.trim();
  return texto.charAt(0).toUpperCase() + texto.slice(1).toLowerCase();
}

/** Un filtro de Mi Lista, con la forma de ficha que entiende la fila. */
function filtroComoFicha(opcion: { filtro: FiltroLista; nombre: string }, activo: FiltroLista): Elemento {
  return {
    id: `filtro:${opcion.filtro}`,
    titulo: opcion.nombre,
    detalle: null,
    genero: null,
    valoracion: null,
    anio: null,
    resumen: null,
    logo: null,
    avance: null,
    // Se reaprovecha para marcar cuál está puesto: la vista lo pinta distinto.
    favorito: opcion.filtro === activo,
    accion: { tipo: 'filtrar', filtro: opcion.filtro },
  };
}

function ficha(id: string, titulo: string, detalle: string | null, pantalla: Pantalla): Elemento {
  return {
    id,
    titulo,
    detalle,
    valoracion: null,
    anio: null,
    resumen: null,
    logo: null,
    avance: null,
    favorito: false,
    accion: { tipo: 'entrar', pantalla },
  };
}

/**
 * Qué se marca como favorito de cada ficha.
 *
 * Una película o un canal se marcan solos; una serie se marca por la pantalla
 * a la que lleva, no por lo que se reproduce. Un episodio suelto no se marca:
 * lo que uno guarda es la serie.
 */
function claseFavorita(elemento: Elemento): { clase: ClaseMedio; id: string } | null {
  if (elemento.accion.tipo === 'reproducir') {
    const medio = elemento.accion.medio;
    return medio.clase === 'episodio' ? null : { clase: medio.clase, id: medio.id };
  }
  // Un filtro no es contenido: no hay corazón que ponerle.
  if (elemento.accion.tipo === 'filtrar') return null;
  // Ni los botones de una ficha: el corazón va en las carátulas.
  if (elemento.accion.tipo !== 'entrar') return null;

  const destino = elemento.accion.pantalla;
  return destino.tipo === 'serie' ? { clase: 'serie', id: destino.serieId } : null;
}
