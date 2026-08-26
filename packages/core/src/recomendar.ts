/**
 * Qué merece presidir el inicio y salir entre lo recomendado.
 *
 * Vive en el núcleo porque **lo deciden dos sitios**: el aparato, cuando saca
 * sus sugerencias por su cuenta, y el servidor de la casa, que las prepara una
 * vez al día. Si cada uno usara su criterio, la portada cambiaría según quién
 * la hubiera calculado.
 *
 * El orden es **año, luego lo último que ha entrado, luego la nota**. La nota
 * va la última a propósito: en la lista real está inflada —hay cientos de
 * películas con un 10 pelado— así que sirve para descartar, no para ordenar.
 */

import { deaccent } from './normalize.ts';

/** Por debajo de esto no luce en una portada. */
export const NOTA_MINIMA = 7;

/**
 * Nota que no vale para nada: el proveedor la reparte a mansalva.
 *
 * Un 10 en esta lista no significa que la película sea buena, significa que
 * nadie la ha valorado de verdad. Se quedan fuera.
 */
export const NOTA_INFLADA = 10;

/**
 * Copias de pase de prensa: "Screening", "SCREENING 2026"…
 *
 * Son grabaciones previas al estreno y se ven mal. Que aparezcan en el
 * catálogo está bien; presidir el inicio con ellas, no.
 */
export function esMuestra(titulo: string): boolean {
  return deaccent(titulo).toLowerCase().includes('screening');
}

/** ¿Vale esta ficha para la portada o para lo recomendado? */
export function esRecomendable(titulo: string, valoracion: number | null): boolean {
  if (valoracion === null) return false;
  if (valoracion < NOTA_MINIMA || valoracion >= NOTA_INFLADA) return false;
  return !esMuestra(titulo);
}

/**
 * El `ORDER BY` de lo recomendado, para los almacenes que hablan SQL.
 *
 * Con el prefijo de la tabla cuando la consulta lleva `JOIN` y hay que
 * distinguir de quién es cada columna.
 */
export function ordenRecomendadaSQL(prefijo = ''): string {
  return `${prefijo}year IS NULL, ${prefijo}year DESC, ${prefijo}added IS NULL, ${prefijo}added DESC, ${prefijo}rating DESC`;
}

/** Y el filtro que le acompaña, que es la otra mitad del criterio. */
export function filtroRecomendadaSQL(prefijo = ''): string {
  return (
    `${prefijo}rating >= ${NOTA_MINIMA} AND ${prefijo}rating < ${NOTA_INFLADA}` +
    ` AND ${prefijo}sort_title NOT LIKE '%screening%'`
  );
}
