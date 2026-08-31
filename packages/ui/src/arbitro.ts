/**
 * El árbitro de las conexiones del panel.
 *
 * El proveedor limita cuántas cosas se pueden estar bajando a la vez de la
 * cuenta —`max_connections`—, y ese límite es **de la casa entera**, no de
 * este aparato: si la tele está viendo una película y la tablet abre otra, la
 * segunda ranura ya está ocupada aunque este aparato no haya hecho nada.
 *
 * De ahí las dos mitades de esto:
 *
 * 1. **Lo que sabe de sí mismo.** Cuántas cosas tiene abiertas este aparato y
 *    con qué prioridad, para no pelearse consigo mismo: reproducir siempre
 *    gana, y lo que se cae es lo menos importante.
 * 2. **Lo que aprende a golpes.** Cuando el panel contesta `403 Max
 *    Connections Reached` es que la casa está al tope, y eso no se puede
 *    saber de antemano. Entonces toca esperar y volver a intentarlo, no dar
 *    la reproducción por fallada, que es lo que se hacía hasta ahora.
 *
 * Dos medidas contra el panel real mandan aquí y no son negociables:
 *
 * - **`active_cons` del handshake no vale de semáforo.** Medido: marcaba 0 con
 *   una película sonando, y oscilaba entre 0 y 1 durante un minuto con la
 *   aplicación cerrada. Así que el árbitro se fía de su propio estado y del
 *   403, y nunca de ese contador.
 * - **El panel tarda unos treinta segundos en soltar la ranura** después de
 *   cerrar el reproductor, aunque no quede ningún proceso vivo. Por eso lo
 *   recién soltado queda "enfriándose": pedirla antes es comerse un 403.
 *
 * Y `max_connections` **no es siempre 1**: una cuenta del mismo proveedor da 1
 * y otra da 3. Sale del handshake y se ajusta con `ajustarRanuras`, así que
 * aquí no hay ningún número escrito a mano.
 */

/** Para qué se pide una conexión, de más importante a menos. */
export type Uso = 'reproducir' | 'previa' | 'descargar';

/**
 * Quién gana cuando no hay ranuras para todos.
 *
 * Reproducir es lo que la persona está mirando: gana siempre. La vista previa
 * va después porque también es algo que se está mirando, aunque de pasada. Y
 * la descarga va la última **porque es la única que no se pierde nada**: los
 * ficheros aceptan `Range`, así que se reanuda donde iba y ni se nota.
 */
const PRIORIDAD: Record<Uso, number> = { reproducir: 3, previa: 2, descargar: 1 };

/** Lo que tarda el panel en soltar de verdad una ranura, medido. */
export const ENFRIAMIENTO_MS = 30_000;

/** Cuánto se espera antes de reintentar cuando la casa está al tope. */
export const REINTENTO_MS = 10_000;

interface Concedida {
  uso: Uso;
  desde: number;
}

/** Lo que contesta el árbitro a quien pide una conexión. */
export type Respuesta =
  | {
      concedido: true;
      /**
       * Lo que hay que cerrar para dejarle sitio, si es que hay algo.
       *
       * Quien pide es responsable de pararlos: el árbitro no conoce ni
       * reproductores ni descargas, solo reparte.
       */
      expulsados: string[];
    }
  | {
      concedido: false;
      /** Cuánto conviene esperar antes de volver a preguntar, en ms. */
      esperar: number;
      porque: 'ranuras' | 'enfriando';
    };

export class Arbitro {
  #ranuras: number;
  #concedidas = new Map<string, Concedida>();
  /** Cuándo se soltó cada ranura que todavía se está enfriando. */
  #enfriando: number[] = [];

  constructor(ranuras = 1) {
    this.#ranuras = Math.max(1, ranuras);
  }

  /**
   * Cuántas ranuras hay, según el handshake.
   *
   * Se lee del panel y no se supone: la primera cuenta del proveedor daba 1 y
   * la segunda, 3.
   */
  ajustarRanuras(ranuras: number): void {
    if (Number.isFinite(ranuras) && ranuras >= 1) this.#ranuras = Math.floor(ranuras);
  }

  get ranuras(): number {
    return this.#ranuras;
  }

  /** Lo que este aparato tiene abierto ahora mismo. */
  enUso(): Array<{ id: string; uso: Uso }> {
    return [...this.#concedidas].map(([id, concedida]) => ({ id, uso: concedida.uso }));
  }

  /** Cuántas ranuras siguen enfriándose, y por tanto no se pueden usar. */
  #enfriandoAhora(ahora: number): number {
    this.#enfriando = this.#enfriando.filter((cuando) => ahora - cuando < ENFRIAMIENTO_MS);
    return this.#enfriando.length;
  }

  /**
   * Pide una conexión para algo.
   *
   * Volver a pedir con el mismo `id` no consume otra ranura: es el caso de
   * reintentar tras un 403, y de cambiar de canal en el mismo reproductor.
   */
  pedir(id: string, uso: Uso, ahora: number): Respuesta {
    if (this.#concedidas.has(id)) {
      this.#concedidas.set(id, { uso, desde: ahora });
      return { concedido: true, expulsados: [] };
    }

    const enfriando = this.#enfriandoAhora(ahora);
    const libres = this.#ranuras - this.#concedidas.size - enfriando;
    if (libres > 0) {
      this.#concedidas.set(id, { uso, desde: ahora });
      return { concedido: true, expulsados: [] };
    }

    /*
      Sin ranuras libres, se mira si lo que hay abierto vale menos que esto.
      Se expulsa lo más flojo y, a igualdad, lo más viejo: entre dos descargas,
      la que lleve más tiempo ya ha adelantado más.
    */
    const candidatos = [...this.#concedidas]
      .filter(([, concedida]) => PRIORIDAD[concedida.uso] < PRIORIDAD[uso])
      .sort(
        ([, a], [, b]) => PRIORIDAD[a.uso] - PRIORIDAD[b.uso] || a.desde - b.desde,
      );

    const victima = candidatos[0];
    if (victima) {
      /*
        Lo expulsado **no enfría**: la ranura se la queda quien acaba de
        entrar, sin soltarla en el panel. Si enfriara, echar a una descarga
        para poner una película haría esperar treinta segundos a la película,
        que es justo lo contrario de lo que se busca.
      */
      this.#concedidas.delete(victima[0]);
      this.#concedidas.set(id, { uso, desde: ahora });
      return { concedido: true, expulsados: [victima[0]] };
    }

    // Todo lo abierto vale tanto o más que esto: toca esperar.
    if (enfriando > 0 && this.#concedidas.size < this.#ranuras) {
      const masViejo = Math.min(...this.#enfriando);
      return {
        concedido: false,
        esperar: Math.max(0, ENFRIAMIENTO_MS - (ahora - masViejo)),
        porque: 'enfriando',
      };
    }
    return { concedido: false, esperar: REINTENTO_MS, porque: 'ranuras' };
  }

  /**
   * Suelta una conexión.
   *
   * La ranura no queda libre en el acto: el panel tarda en enterarse, así que
   * se queda enfriándose. Sin esto, cerrar una película y abrir otra seguida
   * se lleva un 403 que parece un fallo del reproductor.
   */
  soltar(id: string, ahora: number): void {
    if (!this.#concedidas.delete(id)) return;
    this.#enfriando.push(ahora);
  }

  /**
   * El panel ha dicho que no: la casa está al tope.
   *
   * No es un fallo de este aparato —su cuenta le cuadraba— sino que hay otro
   * viendo algo. Se suelta lo que creíamos tener y se dice cuánto esperar.
   */
  rechazado(id: string, ahora: number): number {
    this.#concedidas.delete(id);
    // Sin enfriamiento: la ranura nunca llegó a abrirse aquí, y quien la tiene
    // ocupada es otro aparato de la casa.
    void ahora;
    return REINTENTO_MS;
  }
}

/**
 * ¿Es esto el "no hay conexiones libres" del panel?
 *
 * Llega de dos sitios distintos y con dos formas distintas, y las dos hay que
 * reconocerlas:
 *
 * - Del reproductor de Android, dentro de un objeto con la traza de Java
 *   entera: ahí lo que se ve es `Response code: 403`.
 * - De una petición nuestra, como `HTTP 403` y, si el panel se molesta, con
 *   `{"message": "Max Connections Reached"}` en el cuerpo.
 *
 * Es un 403 y no un 429 —que sería lo suyo—, así que hay que mirar el cuerpo
 * o dar por hecho que un 403 del panel es esto: no hay más motivos para que
 * rechace a una cuenta activa.
 */
export function esLimiteDeConexiones(fallo: unknown): boolean {
  const texto =
    typeof fallo === 'string'
      ? fallo
      : (() => {
          try {
            return JSON.stringify(fallo ?? '');
          } catch {
            return String(fallo);
          }
        })();

  if (/max\s*connections/i.test(texto)) return true;
  return /Response code:\s*403|\bHTTP 403\b|"status"\s*:\s*403/.test(texto);
}
