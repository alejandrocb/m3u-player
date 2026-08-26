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
import type { Biblioteca, DetallePelicula, Orden, Resultado } from './puerto.ts';
import { claveDeMedio, proporcionVista } from './perfiles.ts';
import type { Avance, ClaseMedio } from './perfiles.ts';

/** Qué reproducir cuando el usuario acepta sobre una ficha. */
export interface Reproducible {
  clase: 'canal' | 'pelicula' | 'episodio';
  id: string;
  titulo: string;
}

export type Accion = { tipo: 'entrar'; pantalla: Pantalla } | { tipo: 'reproducir'; medio: Reproducible };

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
  favoritos?: true;
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
  /** Categoría en uso; null es "Todas" —o el grupo de favoritos—. */
  activa: string | null;
  /** true cuando lo que se está viendo es el grupo de favoritos. */
  enFavoritos: boolean;
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
export type Formato = 'lista' | 'carteles' | 'canales' | 'episodios';

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
  | { tipo: 'destacado'; elemento: Elemento }
  | { tipo: 'carrusel'; titulo: string; elementos: Elemento[] }
  | { tipo: 'secciones'; elementos: Elemento[] };

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
export type ModoInicio = 'todo' | 'peliculas' | 'series';

export const MODOS_INICIO: Array<{ modo: ModoInicio; nombre: string }> = [
  { modo: 'todo', nombre: 'Todo' },
  { modo: 'peliculas', nombre: 'Películas' },
  { modo: 'series', nombre: 'Series' },
];

export interface Inicio {
  filas: FilaInicio[];
  fila: number;
  columna: number;
  /** La pestaña activa del selector de arriba. */
  modo: ModoInicio;
}

/** Los elementos de una fila, sea del tipo que sea. */
export function elementosDeFila(fila: FilaInicio): Elemento[] {
  return fila.tipo === 'destacado' ? [fila.elemento] : fila.elementos;
}

/** Cuántas fichas lleva cada carrusel del inicio. */
const CARRUSEL = 20;

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

/** Nota mínima para que una película merezca ser el destacado. */
const NOTA_DESTACADO = 7;

/**
 * Elige la película que preside el inicio.
 *
 * De lo último que ha entrado en el catálogo, la mejor valorada que además
 * sea reciente. Las tres condiciones importan: lo viejo no es novedad, lo mal
 * valorado no luce, y sin cartel no hay nada que enseñar.
 *
 * Si nada cumple, se devuelve `null` y el inicio arranca sin destacado en vez
 * de presidirlo con lo primero que haya, que es peor que no tener.
 */
export function destacar<T extends { anio: number | null; valoracion: number | null; logo: string | null }>(
  candidatas: T[],
  ahora = new Date(),
): T | null {
  const desde = ahora.getFullYear() - 1;
  const buenas = candidatas.filter(
    (ficha) => ficha.logo && ficha.anio !== null && ficha.anio >= desde && (ficha.valoracion ?? 0) >= NOTA_DESTACADO,
  );
  if (buenas.length === 0) return null;

  return buenas.reduce((mejor, ficha) => ((ficha.valoracion ?? 0) > (mejor.valoracion ?? 0) ? ficha : mejor));
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
  #avances: OpcionesPresentador['avances'];
  #seguirViendo: OpcionesPresentador['seguirViendo'];
  #favoritos: PuertoFavoritos | undefined;
  #orden: Orden;

  constructor(biblioteca: Biblioteca, opciones: OpcionesPresentador = {}) {
    this.#biblioteca = biblioteca;
    this.#navegador = new Navegador();
    this.#columnasRejilla = opciones.columnasRejilla ?? 5;
    this.#tamanoPagina = opciones.tamanoPagina ?? 60;
    this.#avances = opciones.avances;
    this.#seguirViendo = opciones.seguirViendo;
    this.#favoritos = opciones.favoritos;
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
      case 'peliculas':
      case 'series':
        return 'carteles';
      case 'directo':
        return 'canales';
      case 'serie':
        return 'episodios';
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
    };
  }

  /**
   * Convierte fichas de catálogo en elementos de carrusel.
   *
   * Se les pega el avance para que la barrita salga también aquí: en una fila
   * de novedades, saber qué llevas empezado es la mitad de la información.
   */
  async #aCarrusel(
    fichas: Array<{ id: string; titulo: string; anio: number | null; valoracion: number | null; logo: string | null }>,
    clase: 'pelicula' | 'serie',
  ): Promise<Elemento[]> {
    const elementos: Elemento[] = fichas.map((ficha) => ({
      id: `${clase}:${ficha.id}`,
      titulo: ficha.titulo,
      detalle: null,
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

    // Por aquí y no llamando al historial a pelo: `#conAvances` ya se guarda de
    // que un fallo de la base no tire la pantalla, y ya sabe que a una serie
    // —que se abre, no se reproduce— no se le pregunta por dónde iba.
    return this.#conAvances(elementos);
  }

  /** La fila de "seguir viendo", a partir del historial del perfil. */
  async #filaContinuar(): Promise<FilaInicio | null> {
    if (!this.#seguirViendo) return null;

    // Si la base está ocupada o el historial falla, el inicio se pinta igual
    // —sin esta fila— en vez de quedarse en blanco.
    let historial: Avance[];
    try {
      historial = await this.#seguirViendo();
    } catch {
      return null;
    }

    const avances = historial.filter((avance) => avance.clase !== 'canal');
    if (avances.length === 0) return null;

    const idsDe = (clase: ClaseMedio): string[] =>
      avances.filter((avance) => avance.clase === clase).map((avance) => avance.itemId);

    const [peliculas, episodios] = await Promise.all([
      this.#biblioteca.peliculasPorId(idsDe('pelicula')),
      this.#biblioteca.episodiosPorId(idsDe('episodio')),
    ]);
    const porPelicula = new Map(peliculas.map((ficha) => [ficha.id, ficha]));
    const porEpisodio = new Map(episodios.map((ficha) => [String(ficha.id), ficha]));

    const elementos: Elemento[] = [];
    for (const avance of avances) {
      const visto = proporcionVista(avance);

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

      if (avance.clase === 'episodio') {
        const ficha = porEpisodio.get(avance.itemId);
        if (!ficha) continue;
        const codigo = `T${ficha.temporada} E${ficha.numero}`;
        elementos.push({
          id: `continuar:episodio:${ficha.id}`,
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
            medio: { clase: 'episodio', id: String(ficha.id), titulo: `${ficha.serieTitulo} ${codigo}` },
          },
        });
      }
    }

    return elementos.length > 0 ? { tipo: 'carrusel', titulo: 'Seguir viendo', elementos } : null;
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
    const conPeliculas = modo !== 'series';
    const conSeries = modo !== 'peliculas';

    const [totales, novedades, valoradas, series, seriesValoradas, continuar] = await Promise.all([
      this.#biblioteca.totales(),
      conPeliculas ? this.#biblioteca.peliculas({ limite: CARRUSEL, desde: 0, orden: 'reciente' }) : [],
      conPeliculas ? this.#biblioteca.peliculas({ limite: CARRUSEL, desde: 0, orden: 'valoracion' }) : [],
      conSeries ? this.#biblioteca.series({ limite: CARRUSEL, desde: 0, orden: 'reciente' }) : [],
      modo === 'series' ? this.#biblioteca.series({ limite: CARRUSEL, desde: 0, orden: 'valoracion' }) : [],
      this.#filaContinuar(),
    ]);

    const filas: FilaInicio[] = [];

    const destacada = destacar(modo === 'series' ? series : novedades);
    if (destacada) {
      /*
        La ficha larga es **una petición al panel**, y solo para esta película.
        Se pide después de tener las filas montadas y sin dejar que un fallo
        tire la pantalla: la portada sale igual, solo que sin sinopsis.
      */
      let detalle: DetallePelicula | null = null;
      if (modo !== 'series') {
        try {
          detalle = await this.#biblioteca.detalleDePelicula(destacada.id);
        } catch {
          detalle = null;
        }
      }

      filas.push({
        tipo: 'destacado',
        elemento: {
          id: `destacado:${destacada.id}`,
          titulo: destacada.titulo,
          // El reparto va en el detalle, recortado: la portada no es una ficha
          // técnica y una lista de doce nombres no la lee nadie.
          detalle: primerosDelReparto(detalle?.reparto ?? null),
          genero: primerosGeneros(detalle?.genero ?? null),
          valoracion: destacada.valoracion,
          anio: destacada.anio,
          resumen: detalle?.sinopsis ?? null,
          // La imagen apaisada si el panel la da; si no, el cartel, que es
          // vertical pero es lo que hay.
          logo: detalle?.fondo ?? destacada.logo,
          avance: null,
          favorito: false,
          accion:
            modo === 'series'
              ? { tipo: 'entrar', pantalla: { tipo: 'serie', serieId: destacada.id, titulo: destacada.titulo } }
              : { tipo: 'reproducir', medio: { clase: 'pelicula', id: destacada.id, titulo: destacada.titulo } },
        },
      });
    }

    if (continuar) filas.push(continuar);

    filas.push({
      tipo: 'secciones',
      elementos: [
        ficha('seccion:directo', 'TV en directo', cantidad(totales.canales, 'canal', 'canales'), { tipo: 'directo' }),
        ficha('seccion:peliculas', 'Películas', cantidad(totales.peliculas, 'título', 'títulos'), {
          tipo: 'peliculas',
        }),
        ficha('seccion:series', 'Series', cantidad(totales.series, 'serie', 'series'), { tipo: 'series' }),
        ficha('seccion:buscador', 'Buscar', null, { tipo: 'buscador' }),
      ],
    });

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
    await anadir('Mejor valoradas', modo === 'series' ? seriesValoradas : valoradas, modo === 'series' ? 'serie' : 'pelicula');

    // El foco vuelve donde estaba, recortado por si las filas han cambiado.
    // Vale para dos casos: volver de una sección, y una sincronización que
    // entre mientras estás mirando.
    const fila = Math.min(this.#focoInicio.fila, Math.max(filas.length - 1, 0));
    const cuantos = filas[fila] ? elementosDeFila(filas[fila]!).length : 0;
    const columna = Math.min(this.#focoInicio.columna, Math.max(cuantos - 1, 0));

    this.#focoInicio = { fila, columna };
    this.#inicio = { filas, fila, columna, modo };
  }

  /**
   * Cambia la pestaña del inicio y lo recarga.
   *
   * El foco vuelve arriba a propósito: lo que hay debajo es otro contenido, y
   * dejar el foco en la cuarta fila de unos carruseles que ya no existen es
   * peor que empezar de nuevo.
   */
  async elegirModo(modo: ModoInicio): Promise<EstadoPantalla> {
    if (modo === this.#modoInicio) return this.estado();
    this.#modoInicio = modo;
    this.#focoInicio = { fila: 0, columna: 0 };
    return this.cargar();
  }

  /**
   * Entra en TV en directo desde el selector del inicio.
   *
   * No es una pestaña más: el directo tiene su parrilla y su vista previa, así
   * que es otra pantalla y se apila como tal. Volver atrás devuelve al inicio.
   */
  async irADirecto(): Promise<EstadoPantalla> {
    this.#navegador.entrar({ tipo: 'directo' }, 0);
    return this.cargar();
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

      const cuantos = elementosDeFila(inicio.filas[inicio.fila]!).length;
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
  async aceptar(): Promise<{ estado: EstadoPantalla; reproducir: Reproducible | null }> {
    // En el inicio, aceptar actúa sobre la ficha enfocada de su fila. Si es
    // una película, reproduce —y el reproductor ya reanuda por donde iba, que
    // eso lo decide él con `avanceDe`—; si es una sección o una serie, entra.
    const inicio = this.#inicio;
    if (inicio) {
      const elemento = elementosDeFila(inicio.filas[inicio.fila]!)[inicio.columna];
      if (!elemento) return { estado: this.estado(), reproducir: null };

      if (elemento.accion.tipo === 'reproducir') {
        return { estado: this.estado(), reproducir: elemento.accion.medio };
      }
      this.#navegador.entrar(elemento.accion.pantalla, 0);
      return { estado: await this.cargar(), reproducir: null };
    }

    const lateral = this.#lateral;
    if (lateral?.dentro) {
      const opcion = lateral.opciones[lateral.foco];
      if (opcion) {
        return {
          estado: await this.elegirCategoria(opcion.grupo, { favoritos: opcion.favoritos }),
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
    const estado = await this.elegirCategoria(opcion.grupo, { favoritos: opcion.favoritos });
    if (conservarBarra && this.#lateral) {
      this.#lateral.dentro = true;
      return { ...estado, lateral: this.#lateral };
    }
    return estado;
  }

  async elegirCategoria(grupo: string | null, opciones: { favoritos?: boolean } = {}): Promise<EstadoPantalla> {
    const pantalla = this.#navegador.actual;

    if (pantalla.tipo === 'serie') {
      // Aquí la "categoría" es la temporada, y el número viene como texto
      // porque la barra es la misma en todas las pantallas.
      const temporada = Number(grupo);
      if (!Number.isFinite(temporada)) return this.estado();
      this.#navegador.reemplazar({ ...pantalla, temporada });
    } else if (pantalla.tipo === 'directo' || pantalla.tipo === 'peliculas' || pantalla.tipo === 'series') {
      this.#navegador.reemplazar(
        opciones.favoritos
          ? { tipo: pantalla.tipo, favoritos: true }
          : grupo
            ? { tipo: pantalla.tipo, grupo }
            : { tipo: pantalla.tipo },
      );
    } else {
      return this.estado();
    }

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
    if (!elemento || !this.#favoritos) return this.estado();

    const marcable = claseFavorita(elemento);
    if (!marcable) return this.estado();

    const favorito = await this.#favoritos.alternar(marcable.clase, marcable.id, elemento.titulo);
    this.#elementos = this.#elementos.map((otro, posicion) =>
      posicion === indice ? { ...otro, favorito } : otro,
    );

    // Estando dentro del grupo de favoritos, quitar uno tiene que sacarlo de
    // la lista: si no, se queda una ficha sin corazón en "Favoritos".
    const pantalla = this.#navegador.actual;
    const enGrupoFavoritos =
      (pantalla.tipo === 'directo' || pantalla.tipo === 'peliculas' || pantalla.tipo === 'series') &&
      pantalla.favoritos === true;
    if (!favorito && enGrupoFavoritos) return this.cargar();
    return this.estado();
  }

  /** Abre el buscador acotado a donde estemos. */
  async abrirBuscador(): Promise<EstadoPantalla> {
    const pantalla = this.#navegador.actual;
    const ambito =
      pantalla.tipo === 'peliculas'
        ? { tipo: 'pelicula' as const, grupo: pantalla.grupo }
        : pantalla.tipo === 'series'
          ? { tipo: 'serie' as const, grupo: pantalla.grupo }
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

    // Qué hay marcado en la barra: la temporada dentro de una serie, y la
    // categoría —o el grupo de favoritos— en las tres secciones.
    const conGrupos = pantalla.tipo === 'directo' || pantalla.tipo === 'peliculas' || pantalla.tipo === 'series';
    const activa =
      pantalla.tipo === 'serie'
        ? String(pantalla.temporada ?? '')
        : conGrupos
          ? (pantalla.grupo ?? null)
          : null;
    const enFavoritos = conGrupos && pantalla.favoritos === true;
    const foco = Math.max(
      0,
      opciones.findIndex((opcion) =>
        enFavoritos ? opcion.favoritos === true : !opcion.favoritos && opcion.grupo === activa,
      ),
    );
    // Se conserva si el foco estaba en la barra: recargar por elegir categoría
    // no debe sacarlo de ahí a mitad de recorrido.
    this.#lateral = {
      opciones,
      activa: enFavoritos ? null : activa,
      enFavoritos,
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

    if (pantalla.tipo === 'directo') {
      const grupos = await this.#biblioteca.grupos();
      return this.#conCabeceras(
        'Todos los canales',
        grupos.map((grupo) => ({ grupo: grupo.nombre, nombre: grupo.nombre, cuantos: grupo.canales })),
      );
    }

    if (pantalla.tipo === 'peliculas' || pantalla.tipo === 'series') {
      const tipo = pantalla.tipo === 'peliculas' ? 'pelicula' : 'serie';
      const categorias = await this.#biblioteca.categorias(tipo);
      return this.#conCabeceras(
        pantalla.tipo === 'peliculas' ? 'Todas las películas' : 'Todas las series',
        categorias.map((categoria) => ({
          grupo: categoria.nombre,
          nombre: categoria.nombre,
          cuantos: categoria.canales,
        })),
      );
    }

    return null;
  }

  /** "Todas" y "Favoritos" van siempre las primeras, antes de lo del proveedor. */
  #conCabeceras(todas: string, categorias: OpcionLateral[]): OpcionLateral[] {
    const cabeceras: OpcionLateral[] = [{ grupo: null, nombre: todas, cuantos: null }];
    // Sin puerto de favoritos no hay perfil detrás, así que tampoco grupo.
    if (this.#favoritos) cabeceras.push({ grupo: null, nombre: 'Favoritos', cuantos: null, favoritos: true });
    return [...cabeceras, ...categorias];
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

      case 'directo': {
        // Sin grupo elegido se enseña el primero: una rejilla con los 482
        // canales de golpe no dice nada, y la barra ya está a la izquierda.
        // Sin grupo elegido salen todos, igual que en películas y series: lo
        // que marca la barra y lo que se ve tienen que coincidir.
        const canales = pantalla.favoritos
          ? await this.#biblioteca.canalesPorId(await this.#idsFavoritos('canal'))
          : pantalla.grupo
            ? await this.#biblioteca.canalesDeGrupo(pantalla.grupo)
            : await this.#biblioteca.canales(pagina);

        return {
          titulo: pantalla.favoritos ? 'Favoritos' : (pantalla.grupo ?? 'TV en directo'),
          // Solo se pagina el listado completo: un grupo cabe entero.
          hayMas: !pantalla.favoritos && !pantalla.grupo && canales.length === pagina.limite,
          elementos: canales.map((canal) => ({
            id: canal.id,
            titulo: canal.nombre,
            detalle: null,
            valoracion: null,
            anio: null,
            resumen: null,
            logo: canal.logo,
            avance: null,
            favorito: false,
            accion: { tipo: 'reproducir', medio: { clase: 'canal', id: canal.id, titulo: canal.nombre } },
          })),
        };
      }

      case 'peliculas': {
        // Los favoritos son pocos y ya vienen ordenados por cuándo se
        // marcaron: no se paginan ni se reordenan.
        const peliculas = pantalla.favoritos
          ? await this.#biblioteca.peliculasPorId(await this.#idsFavoritos('pelicula'))
          : await this.#biblioteca.peliculas({ ...pagina, grupo: pantalla.grupo });

        return {
          titulo: pantalla.favoritos ? 'Favoritos' : (pantalla.grupo ?? 'Películas'),
          hayMas: !pantalla.favoritos && peliculas.length === pagina.limite,
          elementos: peliculas.map((pelicula) => ({
            id: pelicula.id,
            titulo: pelicula.titulo,
            detalle: null,
            valoracion: pelicula.valoracion,
            anio: pelicula.anio,
            resumen: null,
            logo: pelicula.logo,
            avance: null,
            favorito: false,
            accion: {
              tipo: 'reproducir',
              medio: { clase: 'pelicula', id: pelicula.id, titulo: pelicula.titulo },
            },
          })),
        };
      }

      case 'series': {
        const series = pantalla.favoritos
          ? await this.#biblioteca.seriesPorId(await this.#idsFavoritos('serie'))
          : await this.#biblioteca.series({ ...pagina, grupo: pantalla.grupo });

        return {
          titulo: pantalla.favoritos ? 'Favoritos' : (pantalla.grupo ?? 'Series'),
          hayMas: !pantalla.favoritos && series.length === pagina.limite,
          elementos: series.map((serie) => ({
            id: serie.id,
            titulo: serie.titulo,
            detalle: null,
            valoracion: serie.valoracion,
            anio: serie.anio,
            resumen: null,
            logo: serie.logo,
            avance: null,
            favorito: false,
            accion: { tipo: 'entrar', pantalla: { tipo: 'serie', serieId: serie.id, titulo: serie.titulo } },
          })),
        };
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
                medio: { clase: 'episodio', id: String(episodio.id), titulo: nombre },
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
  const destino = elemento.accion.pantalla;
  return destino.tipo === 'serie' ? { clase: 'serie', id: destino.serieId } : null;
}
