/**
 * El título de un episodio, que el proveedor manda de tres formas distintas.
 *
 * Medido sobre las categorías de ficción del panel real:
 *
 * ```
 * Outer Banks 1080P S01E01                              -> sin título
 * Euphoria 1080p - S01E01 - Piloto                      -> "Piloto"
 * True Detective - S01E01 - La larga y clara oscuridad  -> "La larga y clara oscuridad"
 * ```
 *
 * Es decir: el nombre de la serie repetido, el código de temporada y episodio,
 * y a veces —solo a veces— el título de verdad al final. Enseñar el campo tal
 * cual llena la columna de episodios con el nombre de la serie treinta veces
 * seguidas, que es justo lo que no aporta nada estando ya dentro de la serie.
 */

import { fold, tidy } from './normalize.ts';

/**
 * Con qué se identifica un episodio **fuera de este aparato**.
 *
 * Los episodios no se importan con el catálogo: se piden al abrir cada serie,
 * así que el número de fila que les da SQLite depende de en qué orden haya
 * abierto series cada aparato. Usarlo para el historial es lo que hacía que
 * una serie a medias en la tele no apareciera en la tablet —y, peor, que
 * pudiera aparecer **otro capítulo**, el que tuviera ese número allí—.
 *
 * Así que el avance viaja con una clave sacada del contenido, como todo lo
 * demás en la biblioteca: la serie y el código del capítulo.
 */
export function claveDeEpisodio(serieId: string, temporada: number, numero: number): string {
  return `${serieId}:s${temporada}e${numero}`;
}

/** Lo contrario: de la clave a la serie y el capítulo. `null` si no lo es. */
export function leerClaveDeEpisodio(
  clave: string,
): { serieId: string; temporada: number; numero: number } | null {
  // El identificador de una serie es un `slug`, así que no lleva dos puntos:
  // el primero que aparezca es el que separa.
  const corte = clave.indexOf(':');
  if (corte <= 0) return null;

  const codigo = /^s(\d+)e(\d+)$/.exec(clave.slice(corte + 1));
  if (!codigo) return null;

  return { serieId: clave.slice(0, corte), temporada: Number(codigo[1]), numero: Number(codigo[2]) };
}


/** SxxExx, 1x01, "S01 E01"... tal y como lo escriben los distintos paneles. */
const CODIGO = /\b[sS]\s*\d{1,4}\s*[eExX]\s*\d{1,5}\b|\b\d{1,3}x\d{1,3}\b/;

/**
 * El título limpio, o `null` si lo que quedaba era el nombre de la serie.
 *
 * `serie` se pasa para poder reconocerlo aunque venga con la calidad pegada
 * ("Outer Banks 1080P" contra "Outer Banks"): se compara sin acentos ni
 * mayúsculas y por prefijo.
 */
export function tituloDeEpisodio(bruto: string | null | undefined, serie: string): string | null {
  const original = (bruto ?? '').trim();
  if (!original) return null;

  // Lo que va detrás del código es el título; lo de delante, la serie.
  const corte = original.match(CODIGO);
  const resto = corte ? original.slice(corte.index! + corte[0].length) : original;
  const limpio = tidy(resto);
  if (!limpio) return null;

  // Sin código no hay forma de separar, así que se descarta lo que empiece por
  // el nombre de la serie: es el caso "Outer Banks 1080P" a secas.
  const comparable = fold(limpio);
  const nombreSerie = fold(serie);
  if (nombreSerie && (comparable === nombreSerie || comparable.startsWith(`${nombreSerie} `))) return null;

  // Un título que es solo un número —"1080p" ya se fue por otro lado— tampoco
  // dice nada.
  return /^\d+$/.test(comparable) ? null : limpio;
}

/**
 * El año de emisión a partir de la fecha del panel: "2025-12-28" -> 2025.
 *
 * Viene vacía a menudo y alguna vez con la fecha entera mal formada, así que
 * solo se acepta un año de cuatro cifras con sentido.
 */
export function anioDeFecha(fecha: string | null | undefined): number | null {
  const anio = Number((fecha ?? '').slice(0, 4));
  return Number.isInteger(anio) && anio >= 1900 && anio <= 2200 ? anio : null;
}

/**
 * Segundos de duración, de donde se puedan sacar.
 *
 * El panel da `duration_secs` como número y `duration` como "00:57:00". El
 * primero llega a cero en bastantes episodios, así que se recurre al segundo.
 */
export function segundosDeEpisodio(
  segundos: number | string | undefined,
  reloj: string | undefined,
): number | null {
  const directo = Number(segundos);
  if (Number.isFinite(directo) && directo > 0) return Math.round(directo);

  const partes = (reloj ?? '').split(':').map(Number);
  if (partes.length < 2 || partes.some((parte) => !Number.isFinite(parte))) return null;

  const total =
    partes.length === 3
      ? partes[0]! * 3600 + partes[1]! * 60 + partes[2]!
      : partes[0]! * 60 + partes[1]!;
  return total > 0 ? total : null;
}

/** Epoch en segundos, que el panel manda como cadena. */
export function epoch(valor: string | number | undefined): number | null {
  const numero = Number(valor);
  return Number.isFinite(numero) && numero > 0 ? Math.trunc(numero) : null;
}
