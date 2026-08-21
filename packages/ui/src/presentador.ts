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
import type { Biblioteca, Orden } from './puerto.ts';
import { claveDeMedio } from './perfiles.ts';
import type { ClaseMedio } from './perfiles.ts';

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
  #avances: OpcionesPresentador['avances'];
  #favoritos: PuertoFavoritos | undefined;
  #orden: Orden;

  constructor(biblioteca: Biblioteca, opciones: OpcionesPresentador = {}) {
    this.#biblioteca = biblioteca;
    this.#navegador = new Navegador();
    this.#columnasRejilla = opciones.columnasRejilla ?? 5;
    this.#tamanoPagina = opciones.tamanoPagina ?? 60;
    this.#avances = opciones.avances;
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
    };
  }

  /** Carga la pantalla actual desde cero. Se llama al entrar y al volver. */
  async cargar(): Promise<EstadoPantalla> {
    this.#cargandoMas = false;
    const pantalla = this.#navegador.actual;
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

    // Con el foco en la barra, arriba y abajo recorren categorías y la derecha
    // devuelve a la rejilla.
    if (lateral?.dentro) {
      if (direccion === 'derecha') {
        lateral.dentro = false;
      } else if (direccion === 'arriba') {
        lateral.foco = Math.max(0, lateral.foco - 1);
      } else if (direccion === 'abajo') {
        lateral.foco = Math.min(lateral.opciones.length - 1, lateral.foco + 1);
      }
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

  /** El usuario pulsa OK sobre lo enfocado. */
  async aceptar(): Promise<{ estado: EstadoPantalla; reproducir: Reproducible | null }> {
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
      case 'inicio': {
        const totales = await this.#biblioteca.totales();
        return {
          titulo: 'Biblioteca',
          hayMas: false,
          elementos: [
            ficha('seccion:directo', 'TV en directo', cantidad(totales.canales, 'canal', 'canales'), {
              tipo: 'directo',
            }),
            ficha('seccion:peliculas', 'Películas', cantidad(totales.peliculas, 'título', 'títulos'), {
              tipo: 'peliculas',
            }),
            ficha('seccion:series', 'Series', cantidad(totales.series, 'serie', 'series'), { tipo: 'series' }),
            ficha('seccion:buscador', 'Buscar', null, { tipo: 'buscador' }),
          ],
        };
      }

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
        return {
          titulo: `Buscar${donde}`,
          hayMas: false,
          elementos: resultados.map((resultado) => {
            // Una serie se abre; un canal o una película se reproducen.
            if (resultado.tipo === 'serie') {
              return ficha(`res:${resultado.id}`, resultado.titulo, 'serie', {
                tipo: 'serie',
                serieId: resultado.id,
                titulo: resultado.titulo,
              });
            }
            const clase = resultado.tipo === 'canal' ? ('canal' as const) : ('pelicula' as const);
            return {
              id: `res:${resultado.id}`,
              titulo: resultado.titulo,
              detalle: resultado.tipo === 'canal' ? 'canal' : 'película',
              valoracion: null,
              anio: null,
              resumen: null,
              logo: null,
              avance: null,
              favorito: false,
              accion: {
                tipo: 'reproducir' as const,
                medio: { clase, id: resultado.id, titulo: resultado.titulo },
              },
            };
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
