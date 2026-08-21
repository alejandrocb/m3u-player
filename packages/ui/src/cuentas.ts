/**
 * Las listas dadas de alta y cuál está conectada.
 *
 * El arranque de la app es esta pantalla, no la biblioteca: se ven las listas
 * guardadas y se conecta a una. La sesión **se mantiene** entre arranques —al
 * abrir se entra directo a la última lista conectada— hasta que se cierra
 * expresamente, que es como funcionan los reproductores del ramo.
 *
 * Aquí solo está el modelo: guardar y leer es cosa del `AlmacenCuentas` que
 * ponga cada plataforma, porque las URLs llevan las credenciales del panel
 * dentro y cada sistema tiene su sitio seguro (llavero de Android, DPAPI en
 * Windows).
 */

/** Una lista dada de alta. */
export interface Cuenta {
  id: string;
  /** Nombre que le pone el usuario: "Casa", "La de mi hermano". */
  nombre: string;
  /**
   * `m3u` es una URL de `get.php`; `xtream` es un panel con `player_api.php`.
   * Se distingue porque con Xtream las series llegan ya estructuradas.
   */
  tipo: 'm3u' | 'xtream';
  /** URL completa. **Lleva usuario y contraseña**: nunca se imprime entera. */
  url: string;
  creada: string;
  ultimoUso: string | null;
}

/** Lo que se persiste: las listas y cuál quedó conectada. */
export interface EstadoCuentas {
  cuentas: Cuenta[];
  /** Sesión abierta. `null` tras cerrar sesión. */
  activaId: string | null;
}

/**
 * Dónde se guardan las cuentas. Cada plataforma pone la suya: llavero de
 * Android, `safeStorage` en Electron.
 */
export interface AlmacenCuentas {
  leer(): Promise<EstadoCuentas | null>;
  guardar(estado: EstadoCuentas): Promise<void>;
}

export interface OpcionesGestor {
  /** Inyectable para que los tests no dependan del reloj. */
  ahora?: () => string;
}

/** Datos de alta de una lista nueva. */
export interface AltaCuenta {
  nombre: string;
  url: string;
  tipo?: 'm3u' | 'xtream';
}

const VACIO: EstadoCuentas = { cuentas: [], activaId: null };

export class GestorCuentas {
  #almacen: AlmacenCuentas;
  #estado: EstadoCuentas;
  #ahora: () => string;

  private constructor(almacen: AlmacenCuentas, estado: EstadoCuentas, ahora: () => string) {
    this.#almacen = almacen;
    this.#estado = estado;
    this.#ahora = ahora;
  }

  static async abrir(almacen: AlmacenCuentas, opciones: OpcionesGestor = {}): Promise<GestorCuentas> {
    const guardado = await almacen.leer();
    const ahora = opciones.ahora ?? (() => new Date().toISOString());
    // Un almacén vacío o corrupto no debe impedir arrancar: se empieza de cero.
    const estado = guardado && Array.isArray(guardado.cuentas) ? guardado : VACIO;
    return new GestorCuentas(almacen, { cuentas: [...estado.cuentas], activaId: estado.activaId ?? null }, ahora);
  }

  /** Ordenadas por uso reciente: la última conectada, primero. */
  get cuentas(): Cuenta[] {
    return [...this.#estado.cuentas].sort((a, b) => (b.ultimoUso ?? '').localeCompare(a.ultimoUso ?? ''));
  }

  /** La lista con sesión abierta, si la hay. */
  get activa(): Cuenta | null {
    return this.#estado.cuentas.find((cuenta) => cuenta.id === this.#estado.activaId) ?? null;
  }

  async anadir(alta: AltaCuenta): Promise<Cuenta> {
    const url = alta.url.trim();
    if (!url) throw new Error('La dirección de la lista no puede estar vacía.');

    const cuenta: Cuenta = {
      id: this.#idLibre(alta.nombre),
      nombre: alta.nombre.trim() || hostDe(url) || 'Lista',
      tipo: alta.tipo ?? (esXtream(url) ? 'xtream' : 'm3u'),
      url,
      creada: this.#ahora(),
      ultimoUso: null,
    };

    this.#estado.cuentas.push(cuenta);
    await this.#persistir();
    return cuenta;
  }

  async editar(id: string, cambios: Partial<AltaCuenta>): Promise<Cuenta> {
    const cuenta = this.#estado.cuentas.find((candidata) => candidata.id === id);
    if (!cuenta) throw new Error('Esa lista ya no existe.');

    if (cambios.nombre !== undefined) cuenta.nombre = cambios.nombre.trim() || cuenta.nombre;
    if (cambios.url !== undefined && cambios.url.trim()) {
      cuenta.url = cambios.url.trim();
      cuenta.tipo = cambios.tipo ?? (esXtream(cuenta.url) ? 'xtream' : 'm3u');
    } else if (cambios.tipo) {
      cuenta.tipo = cambios.tipo;
    }

    await this.#persistir();
    return cuenta;
  }

  async borrar(id: string): Promise<void> {
    this.#estado.cuentas = this.#estado.cuentas.filter((cuenta) => cuenta.id !== id);
    // Borrar la lista conectada cierra la sesión: no puede quedar apuntando a
    // algo que ya no está.
    if (this.#estado.activaId === id) this.#estado.activaId = null;
    await this.#persistir();
  }

  /** Abre sesión con una lista. Se mantiene hasta `cerrarSesion`. */
  async conectar(id: string): Promise<Cuenta> {
    const cuenta = this.#estado.cuentas.find((candidata) => candidata.id === id);
    if (!cuenta) throw new Error('Esa lista ya no existe.');

    cuenta.ultimoUso = this.#ahora();
    this.#estado.activaId = cuenta.id;
    await this.#persistir();
    return cuenta;
  }

  async cerrarSesion(): Promise<void> {
    this.#estado.activaId = null;
    await this.#persistir();
  }

  #idLibre(nombre: string): string {
    const base = nombre.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'lista';
    if (!this.#estado.cuentas.some((cuenta) => cuenta.id === base)) return base;

    // Dos listas pueden llamarse igual ("Casa" en dos servidores distintos).
    let sufijo = 2;
    while (this.#estado.cuentas.some((cuenta) => cuenta.id === `${base}-${sufijo}`)) sufijo++;
    return `${base}-${sufijo}`;
  }

  async #persistir(): Promise<void> {
    await this.#almacen.guardar({ cuentas: [...this.#estado.cuentas], activaId: this.#estado.activaId });
  }
}

/** Servidor de una URL, sin credenciales: lo único que se puede enseñar. */
export function hostDe(url: string): string {
  const sinEsquema = url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  const corte = sinEsquema.search(/[/?#]/);
  return (corte === -1 ? sinEsquema : sinEsquema.slice(0, corte)).trim();
}

/** ¿Huele a panel Xtream? Lleva usuario y contraseña como parámetros. */
export function esXtream(url: string): boolean {
  return /[?&]username=/i.test(url) && /[?&]password=/i.test(url);
}
