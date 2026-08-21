/**
 * Ordenación alfabética barata.
 *
 * `localeCompare` con un idioma es correcto pero muy caro cuando hay miles de
 * elementos: cada comparación hace trabajo de internacionalización, y ordenar
 * 18.000 títulos son unas 250.000 comparaciones. En el motor de JavaScript de
 * Android eso bloquea el hilo durante minutos —medido: la importación se quedó
 * clavada al 180 % de CPU—, y en el escritorio tampoco es gratis.
 *
 * La alternativa es preparar una vez por elemento la clave de ordenación, ya
 * sin acentos ni mayúsculas, y comparar cadenas a pelo. Es el mismo truco que
 * usa el esquema de SQLite con sus columnas `sort_*`.
 */

import { fold } from './normalize.ts';

/**
 * Ordena por la clave que devuelva `clave`, calculándola una sola vez por
 * elemento. Devuelve un array nuevo; no toca el original.
 */
export function ordenarPor<T>(items: T[], clave: (item: T) => string): T[] {
  return items
    .map((item) => ({ item, orden: fold(clave(item)) }))
    .sort((a, b) => (a.orden < b.orden ? -1 : a.orden > b.orden ? 1 : 0))
    .map((par) => par.item);
}
