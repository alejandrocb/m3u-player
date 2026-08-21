/**
 * Pila de navegación de la interfaz.
 *
 * El mando de un televisor tiene una tecla de "atrás" y poco más, así que la
 * navegación tiene que ser una pila honesta: cada pantalla sabe volver a la
 * anterior, y en la raíz "atrás" significa salir de la aplicación.
 *
 * Esto es lógica pura a propósito: es lo que se reutiliza tal cual cuando la
 * interfaz se rehaga en React Native para Android TV.
 */

/** Pantallas que existen. La sección de inicio es siempre el fondo de la pila. */
export type Pantalla =
  | { tipo: 'inicio' }
  // Las tres secciones tienen la misma forma: barra de grupos a la izquierda y
  // lo elegido a la derecha. `grupo` es lo que hay marcado en la barra; sin
  // ello, todo. `favoritos` es el grupo propio de cada perfil, que no viene
  // del proveedor y por eso no cabe en `grupo`.
  | { tipo: 'directo'; grupo?: string; favoritos?: true }
  | { tipo: 'peliculas'; grupo?: string; favoritos?: true }
  | { tipo: 'series'; grupo?: string; favoritos?: true }
  // Igual: temporadas a la izquierda, episodios de la marcada a la derecha.
  | { tipo: 'serie'; serieId: string; titulo: string; temporada?: number }
  // El buscador hereda dónde se abrió: en una categoría busca solo ahí.
  | { tipo: 'buscador'; ambito?: { tipo?: 'canal' | 'pelicula' | 'serie'; grupo?: string }; texto?: string };

/** Lo que la vista debe hacer cuando el usuario pulsa "atrás". */
export type ResultadoAtras = 'retrocedido' | 'salir';

export class Navegador {
  /** Nunca queda vacía: el inicio es el fondo y no se puede desapilar. */
  #pila: Pantalla[] = [{ tipo: 'inicio' }];

  /** Posición del foco en cada pantalla, para restaurarla al volver. */
  #focos = new Map<string, number>();

  get actual(): Pantalla {
    return this.#pila[this.#pila.length - 1]!;
  }

  get profundidad(): number {
    return this.#pila.length;
  }

  /** Copia de la pila, de la raíz hacia arriba. Útil para migas y para depurar. */
  get ruta(): Pantalla[] {
    return [...this.#pila];
  }

  entrar(pantalla: Pantalla, focoActual = 0): void {
    // Se recuerda dónde estaba el foco antes de entrar: al volver de una ficha,
    // el cursor debe quedar sobre ella y no al principio de una rejilla de
    // 18.000 películas.
    this.#focos.set(claveDe(this.actual), focoActual);
    this.#pila.push(pantalla);
  }

  /**
   * Retrocede una pantalla. En la raíz no desapila: devuelve 'salir' para que
   * la vista pida confirmación y cierre la aplicación.
   */
  atras(): ResultadoAtras {
    if (this.#pila.length === 1) return 'salir';
    this.#pila.pop();
    return 'retrocedido';
  }

  /**
   * Cambia la pantalla actual sin apilar otra.
   *
   * Es lo que hace elegir categoría en la barra lateral: sigues en "Películas",
   * solo que viendo otra; "atrás" debe salir de la sección, no ir recorriendo
   * las categorías que hayas mirado.
   */
  reemplazar(pantalla: Pantalla): void {
    this.#pila[this.#pila.length - 1] = pantalla;
  }

  /** Vuelve al inicio de un salto, para el botón de "inicio" del mando. */
  aInicio(): void {
    this.#pila = [{ tipo: 'inicio' }];
  }

  /** Foco guardado de la pantalla actual, o 0 si es la primera vez que se ve. */
  focoGuardado(): number {
    return this.#focos.get(claveDe(this.actual)) ?? 0;
  }

  recordarFoco(indice: number): void {
    this.#focos.set(claveDe(this.actual), indice);
  }
}

/**
 * Identidad de una pantalla a efectos de recordar el foco: dos temporadas
 * distintas de la misma serie, o dos categorías distintas de películas, son
 * pantallas distintas y cada una recuerda por dónde iba.
 */
export function claveDe(pantalla: Pantalla): string {
  switch (pantalla.tipo) {
    case 'serie':
      return `serie:${pantalla.serieId}:${pantalla.temporada ?? ''}`;
    case 'directo':
    case 'peliculas':
    case 'series':
      return `${pantalla.tipo}:${pantalla.favoritos ? '♥' : (pantalla.grupo ?? '')}`;
    default:
      return pantalla.tipo;
  }
}
