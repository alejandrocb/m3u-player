/**
 * Movimiento del foco en una rejilla, que es como se navega con un mando.
 *
 * Las reglas no son obvias y conviene fijarlas aquí, con tests, en vez de
 * repartirlas por la vista:
 *
 * - **En los bordes no se envuelve.** Si el foco está en la primera columna e
 *   insistes hacia la izquierda, se queda: en un televisor, saltar al final de
 *   la fila anterior desorienta y es la queja clásica de estas aplicaciones.
 * - **La última fila suele estar incompleta.** Bajar desde una posición que no
 *   tiene elemento debajo lleva al último, en vez de no hacer nada, para que
 *   el contenido nunca quede inalcanzable.
 */

export type Direccion = 'arriba' | 'abajo' | 'izquierda' | 'derecha';

export interface Rejilla {
  /** Cuántos elementos hay en total. */
  total: number;
  /** Cuántos caben por fila. Una lista vertical es una rejilla de una columna. */
  columnas: number;
}

/**
 * Devuelve el índice donde queda el foco tras moverse. Si el movimiento no es
 * posible, devuelve el mismo índice: quien llama puede comparar y, por ejemplo,
 * pasar el foco a la barra lateral.
 */
export function mover(indice: number, direccion: Direccion, rejilla: Rejilla): number {
  const { total, columnas } = rejilla;
  if (total <= 0 || columnas <= 0) return 0;

  const actual = Math.min(Math.max(indice, 0), total - 1);
  const columna = actual % columnas;

  switch (direccion) {
    case 'izquierda':
      return columna === 0 ? actual : actual - 1;

    case 'derecha':
      // Ni fuera de la fila ni más allá del último elemento.
      return columna === columnas - 1 || actual + 1 >= total ? actual : actual + 1;

    case 'arriba':
      return actual - columnas < 0 ? actual : actual - columnas;

    case 'abajo': {
      const debajo = actual + columnas;
      if (debajo < total) return debajo;
      // Hay más filas pero esa columna se queda corta: al último elemento.
      const ultimaFila = Math.floor((total - 1) / columnas);
      return Math.floor(actual / columnas) < ultimaFila ? total - 1 : actual;
    }
  }
}

/**
 * Primer índice de la página que contiene a `indice`.
 *
 * La biblioteca se pide paginada, así que al mover el foco hay que saber si
 * toca cargar el bloque siguiente.
 */
export function paginaDe(indice: number, tamano: number): number {
  if (tamano <= 0) return 0;
  return Math.floor(indice / tamano) * tamano;
}
