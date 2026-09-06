/**
 * La cola de descargas: qué se baja, en qué orden y quién la para.
 *
 * Es lo que no hacen los reproductores comerciales y la razón de que esto
 * exista, así que conviene tener claras las tres decisiones de las que
 * depende todo lo demás:
 *
 * 1. **Una cada vez.** No porque no quepan más, sino porque el ancho de banda
 *    es el mismo: dos a la vez tardan lo mismo que dos seguidas y ninguna de
 *    las dos termina hasta el final. Con una, a los diez minutos ya hay una
 *    película entera en el disco.
 * 2. **La conexión la reparte el árbitro.** Descargar es la prioridad más
 *    baja **porque es la única que no pierde nada**: los ficheros del panel
 *    aceptan `Range`, así que lo expulsado se reanuda donde iba. Poner una
 *    película echa a la descarga, y la descarga vuelve sola cuando se cierra
 *    el reproductor.
 * 3. **Lo bajado se apunta en bytes, no en porcentaje.** El porcentaje es
 *    para pintar; lo que hace falta para reanudar es por qué byte iba, que es
 *    lo que se le manda al panel en la cabecera `Range`.
 *
 * Aquí no se toca ningún fichero: eso lo hace la plataforma detrás de
 * `Transferencia`. Esto decide **qué** se baja y **cuándo**, que es lo que
 * quiero poder probar sin un Android delante.
 */

import type { Arbitro } from './arbitro.ts';

/** En qué punto está una descarga. */
export type EstadoDescarga = 'en cola' | 'bajando' | 'pausada' | 'hecha' | 'fallida';

export interface Descarga {
  /** La clave del medio: `pelicula:el-aviso-2018`, `episodio:doctor-who:s1e7`. */
  id: string;
  clase: 'pelicula' | 'episodio';
  /** El identificador dentro de su clase, que es lo que sabe la biblioteca. */
  itemId: string;
  titulo: string;
  /** De qué serie es, para agrupar en la pantalla. Nulo en las películas. */
  serieId: string | null;
  url: string;
  /** El nombre del fichero en la carpeta de la aplicación. */
  fichero: string;
  estado: EstadoDescarga;
  /** Bytes ya guardados. Es por donde se reanuda. */
  bytes: number;
  /** Tamaño total si el panel lo dice; `null` mientras no se sepa. */
  total: number | null;
  /** Cuándo se pidió, en ISO. Ordena la cola: primero lo que se pidió antes. */
  creada: string;
  /**
   * Cuántas veces se ha cortado seguidas sin avanzar nada.
   *
   * Se pone a cero en cuanto entra un byte nuevo: lo que importa no es cuántos
   * cortes ha habido —en una película de dos gigas por un wifi flojo hay
   * muchos— sino cuántos van sin avanzar, que es lo que distingue una red
   * regular de algo que de verdad no se puede bajar.
   */
  intentos: number;
  error: string | null;
}

/** Lo que la plataforma tiene que saber hacer: mover bytes a un fichero. */
export interface Transferencia {
  /**
   * Empieza o reanuda una descarga y devuelve cómo cancelarla.
   *
   * `desde` son los bytes que ya hay en el disco: la plataforma pide al panel
   * `Range: bytes=<desde>-` y **añade** al fichero. Si el panel no respeta el
   * rango —algunos no lo hacen— hay que empezar de cero y avisar con
   * `alAvanzar` desde 0, que la cola se entera sola.
   */
  empezar(orden: {
    descarga: Descarga;
    desde: number;
    alAvanzar: (bytes: number, total: number | null) => void;
    alTerminar: () => void;
    alFallar: (razon: string) => void;
  }): () => void;
}

/** Dónde se guarda la cola entre arranques. */
export interface AlmacenDescargas {
  leer(): Promise<Descarga[]>;
  guardar(descarga: Descarga): Promise<void>;
  borrar(id: string): Promise<void>;
}

export interface OpcionesCola {
  arbitro: Arbitro;
  transferencia: Transferencia;
  almacen: AlmacenDescargas;
  /** Se avisa a la vista cada vez que la cola cambia. */
  alCambiar?: (descargas: Descarga[]) => void;
  /** Para poder probar sin esperar. */
  ahora?: () => number;
  /** Ídem: en los tests se dispara a mano en vez de esperar de verdad. */
  esperar?: (hacer: () => void, ms: number) => void;
}

/**
 * Cada cuánto se apunta el avance en la base.
 *
 * El avance llega decenas de veces por segundo y guardarlo todo sería escribir
 * en SQLite sin parar para un dato que solo hace falta al reanudar. Con un
 * apunte cada pocos segundos, lo que se pierde al cortar la luz son unos
 * megas que se vuelven a bajar.
 */
const APUNTAR_CADA_MS = 5_000;

/**
 * Cuántos cortes seguidos sin avanzar antes de darla por fallida.
 *
 * Un corte no es un fallo: en un wifi flojo, dos gigas se cortan varias veces
 * y lo único que hay que hacer es seguir por donde iba, que para eso están los
 * bytes apuntados. Lo que sí es un fallo es cortarse una y otra vez **sin
 * avanzar nada**, que es lo que pasa cuando el disco está lleno o el panel ha
 * dejado de servir ese fichero.
 */
const CORTES_SEGUIDOS = 5;

/** Cuánto se espera antes de volver a intentarlo tras un corte. */
const TRAS_UN_CORTE_MS = 5_000;

export class ColaDeDescargas {
  #arbitro: Arbitro;
  #transferencia: Transferencia;
  #almacen: AlmacenDescargas;
  #alCambiar: OpcionesCola['alCambiar'];
  #ahora: () => number;

  #cola: Descarga[] = [];
  /** Cómo cancelar la que está bajando ahora mismo. */
  #cancelar: (() => void) | null = null;
  #bajando: string | null = null;
  #ultimoApunte = 0;
  #esperar: (hacer: () => void, ms: number) => void;
  /** Hay una vuelta ya programada: no se apilan dos. */
  #programada = false;

  constructor(opciones: OpcionesCola) {
    this.#arbitro = opciones.arbitro;
    this.#transferencia = opciones.transferencia;
    this.#almacen = opciones.almacen;
    this.#alCambiar = opciones.alCambiar;
    this.#ahora = opciones.ahora ?? (() => Date.now());
    this.#esperar = opciones.esperar ?? ((hacer, ms) => setTimeout(hacer, ms));
  }

  /** Lo guardado de la vez anterior. Lo que quedó a medias vuelve a la cola. */
  async cargar(): Promise<void> {
    this.#cola = await this.#almacen.leer();
    /*
      Lo que estaba bajando cuando se cerró la aplicación no está bajando: al
      arrancar no hay nada en marcha. Se deja en cola, que es donde estaba de
      verdad, y sigue por donde iba porque los bytes están apuntados.
    */
    for (const descarga of this.#cola) {
      if (descarga.estado === 'bajando') descarga.estado = 'en cola';
    }
    this.#avisar();
    await this.#seguir();
  }

  /** Todas, de lo más reciente a lo más viejo. */
  todas(): Descarga[] {
    return [...this.#cola];
  }

  de(id: string): Descarga | undefined {
    return this.#cola.find((descarga) => descarga.id === id);
  }

  /**
   * Mete algo en la cola. Si ya estaba, no se duplica.
   *
   * Volver a pedir algo que falló lo reintenta: es lo que uno espera al pulsar
   * "Descargar" sobre una ficha que se quedó a medias.
   */
  async anadir(
    nueva: Omit<Descarga, 'estado' | 'bytes' | 'total' | 'creada' | 'intentos' | 'error'>,
  ): Promise<void> {
    const antigua = this.de(nueva.id);
    if (antigua) {
      if (antigua.estado !== 'fallida' && antigua.estado !== 'pausada') return;
      antigua.estado = 'en cola';
      antigua.intentos = 0;
      antigua.error = null;
      await this.#apuntar(antigua);
    } else {
      const descarga: Descarga = {
        ...nueva,
        estado: 'en cola',
        bytes: 0,
        total: null,
        creada: new Date(this.#ahora()).toISOString(),
        intentos: 0,
        error: null,
      };
      this.#cola.push(descarga);
      await this.#apuntar(descarga);
    }

    this.#avisar();
    await this.#seguir();
  }

  /** La quita de la cola. Si estaba bajando, se corta primero. */
  async quitar(id: string): Promise<void> {
    if (this.#bajando === id) this.#parar();
    this.#cola = this.#cola.filter((descarga) => descarga.id !== id);
    await this.#almacen.borrar(id);
    this.#avisar();
    await this.#seguir();
  }

  /** La aparta sin perder lo bajado. Vuelve con `anadir`. */
  async pausar(id: string): Promise<void> {
    const descarga = this.de(id);
    if (!descarga || descarga.estado === 'hecha') return;

    if (this.#bajando === id) this.#parar();
    descarga.estado = 'pausada';
    await this.#apuntar(descarga);
    this.#avisar();
    await this.#seguir();
  }

  /**
   * El árbitro ha echado a esta descarga: se para y vuelve a la cola.
   *
   * No es un fallo ni una pausa del usuario: en cuanto haya ranura, sigue.
   */
  expulsar(id: string): void {
    const descarga = this.de(id);
    if (!descarga || this.#bajando !== id) return;

    /*
      **Sin soltar la ranura**: al expulsar, el árbitro ya se la ha dado a
      quien la pidió. Soltarla aquí la pondría a enfriar treinta segundos, que
      es justo lo contrario de lo que se busca —la película tendría que
      esperar por la descarga que acaba de echar—.
    */
    this.#cortar();
    this.#bajando = null;
    descarga.estado = 'en cola';
    this.#avisar();
  }

  /** Se llama cuando se suelta una ranura: quizá ahora sí quepa. */
  async reintentar(): Promise<void> {
    await this.#seguir();
  }

  /** Corta lo que esté bajando. La cola se queda como está. */
  parar(): void {
    if (!this.#bajando) return;
    const descarga = this.de(this.#bajando);
    this.#parar();
    if (descarga && descarga.estado === 'bajando') descarga.estado = 'en cola';
    this.#avisar();
  }

  /** Corta el transporte sin tocar el árbitro. */
  #cortar(): void {
    this.#cancelar?.();
    this.#cancelar = null;
  }

  /**
   * Corta y suelta la ranura.
   *
   * Soltar la pone a enfriar: el panel tarda unos treinta segundos en darla
   * por libre de verdad, así que la siguiente descarga no arranca de
   * inmediato. Es lo correcto —pedirla antes es comerse un 403— y no se nota,
   * que una película tarda minutos en bajarse.
   */
  #parar(): void {
    this.#cortar();
    if (this.#bajando) this.#arbitro.soltar(this.#bajando, this.#ahora());
    this.#bajando = null;
  }

  /** Arranca la siguiente si hay hueco y no hay nada en marcha. */
  async #seguir(): Promise<void> {
    if (this.#bajando) return;

    const siguiente = this.#cola.find((descarga) => descarga.estado === 'en cola');
    if (!siguiente) return;

    const respuesta = this.#arbitro.pedir(siguiente.id, 'descargar', this.#ahora());
    if (!respuesta.concedido) {
      /*
        **Sin ranura hay que volver a preguntar solo.** Esto es lo que dejaba
        una descarga en "en cola" para siempre: el árbitro decía que no —la
        ranura que la propia descarga acababa de soltar está enfriándose
        treinta segundos— y nadie volvía a intentarlo nunca. Por fuera se veía
        un 0 % que no se movía y ningún error que mirar.

        El árbitro dice cuánto conviene esperar; se le hace caso.
      */
      this.#volverATiempo(respuesta.esperar);
      return;
    }

    // Descargar es la prioridad más baja, así que no debería expulsar a nadie;
    // si algún día lo hiciera, quien lo lea aquí sabrá que pasa por el árbitro.
    for (const expulsado of respuesta.expulsados) this.expulsar(expulsado);

    this.#bajando = siguiente.id;
    siguiente.estado = 'bajando';
    this.#avisar();

    // Por dónde iba al empezar: es lo que dice, si esto se corta, si ha
    // avanzado algo o se ha quedado clavada.
    const arrancoEn = siguiente.bytes;

    this.#cancelar = this.#transferencia.empezar({
      descarga: siguiente,
      desde: siguiente.bytes,
      alAvanzar: (bytes, total) => {
        siguiente.bytes = bytes;
        if (total !== null) siguiente.total = total;

        // A la vista se le avisa siempre —es una barra que se mueve— y a la
        // base cada pocos segundos, que es un dato que solo hace falta al
        // reanudar.
        this.#avisar();
        const ahora = this.#ahora();
        if (ahora - this.#ultimoApunte >= APUNTAR_CADA_MS) {
          this.#ultimoApunte = ahora;
          void this.#apuntar(siguiente);
        }
      },
      alTerminar: () => {
        siguiente.estado = 'hecha';
        siguiente.intentos = 0;
        siguiente.error = null;
        if (siguiente.total === null) siguiente.total = siguiente.bytes;
        this.#parar();
        void this.#apuntar(siguiente).then(() => this.#avisar());
        void this.#seguir();
      },
      alFallar: (razon) => {
        /*
          **Un corte no es un fallo.** Una película de dos gigas por un wifi
          flojo se corta varias veces, y lo único que hay que hacer es seguir
          por donde iba. Solo se da por fallida cuando se corta varias veces
          **sin avanzar nada**, que es lo que pasa de verdad cuando el disco
          está lleno o el panel ha dejado de servir ese fichero.
        */
        siguiente.intentos = siguiente.bytes > arrancoEn ? 0 : siguiente.intentos + 1;
        siguiente.error = razon;
        siguiente.estado = siguiente.intentos >= CORTES_SEGUIDOS ? 'fallida' : 'en cola';

        this.#parar();
        void this.#apuntar(siguiente).then(() => this.#avisar());

        // Un momento antes de volver: si el corte es de la red, insistir en el
        // acto es gastar batería para nada.
        if (siguiente.estado === 'en cola') this.#volverATiempo(TRAS_UN_CORTE_MS);
        else void this.#seguir();
      },
    });
  }

  /**
   * Vuelve a mirar la cola dentro de un rato.
   *
   * Con guarda para no apilar esperas: cada ficha que se añade mientras no hay
   * ranura llamaría aquí, y acabarían diez relojes despertando a la vez.
   */
  #volverATiempo(ms: number): void {
    if (this.#programada) return;
    this.#programada = true;
    this.#esperar(() => {
      this.#programada = false;
      void this.#seguir();
    }, Math.max(1_000, ms));
  }

  async #apuntar(descarga: Descarga): Promise<void> {
    try {
      await this.#almacen.guardar(descarga);
    } catch {
      // Que no se pueda apuntar no puede parar la descarga: lo peor que pasa
      // es que al reanudar se vuelvan a bajar unos megas.
    }
  }

  #avisar(): void {
    this.#alCambiar?.(this.todas());
  }
}

/** La clave con la que se identifica una descarga. */
export function claveDeDescarga(clase: 'pelicula' | 'episodio', itemId: string): string {
  return `${clase}:${itemId}`;
}

/**
 * El nombre del fichero en el disco.
 *
 * **Sin la extensión de la URL**, que miente: hay `.mkv` que por dentro son
 * MP4. Se guarda con la extensión que se le pase, que la decide quien mira los
 * primeros bytes del fichero.
 */
export function ficheroDe(clave: string, extension: string): string {
  return `${clave.replace(/[^a-z0-9]+/gi, '-')}.${extension.replace(/^\./, '')}`;
}
