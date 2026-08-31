/**
 * La intro y los créditos de un capítulo, para poder saltarlos.
 *
 * De dónde salen estos segundos es la pregunta que decide todo. Medido contra
 * la lista real: **los ficheros no lo saben**. Son MKV y traen marcas de
 * capítulo, sí, pero sin nombre —lo que hay escrito es la propia hora,
 * `00:06:16.251`— y repartidas cada cinco o seis minutos, que es un troceado
 * automático del que codificó y no un capitulado que sepa dónde está la
 * careta. Con eso no hay forma de decir cuál de las marcas es la intro.
 *
 * Así que los marca quien mira, con dos pulsaciones, y **la marca se comparte**
 * con toda la casa: la careta de una serie es la misma para todos, y quien la
 * marque le ahorra el trabajo al siguiente. Por eso viaja con la
 * sincronización aunque no cuelgue de ningún perfil.
 *
 * Hay dos clases de serie y por eso hay dos ámbitos:
 *
 * - La careta empieza **siempre en el mismo minuto**: se marca una vez y vale
 *   para la temporada entera (`doctor-who:s1`).
 * - La serie **arranca con una escena** y mete la careta después, en un sitio
 *   distinto cada vez: ahí no queda otra que marcar el capítulo
 *   (`doctor-who:s1e4`), y **lo concreto manda sobre lo general**.
 *
 * El formato es el de Jellyfin —tipo, principio y final— a propósito: si algún
 * día se automatiza o se importa de un servidor suyo, los datos encajan sin
 * traducir nada.
 */

import { leerClaveDeEpisodio } from '@m3u/core';

export type TipoSegmento = 'intro' | 'outro';

export interface Segmento {
  /** La temporada o el capítulo al que se refiere. */
  ambito: string;
  tipo: TipoSegmento;
  /** Segundos desde el principio del fichero. */
  desde: number;
  hasta: number;
}

/** Lo que la interfaz necesita para leer y anotar segmentos. */
export interface AlmacenSegmentos {
  /** Los que apliquen a un capítulo: los suyos y los de su temporada. */
  deEpisodio(clave: string): Promise<Segmento[]>;
  guardar(segmento: Segmento): Promise<void>;
}

/**
 * El ámbito de temporada de un capítulo: `doctor-who:s1e4` -> `doctor-who:s1`.
 *
 * Devuelve `null` si la clave no es la de un episodio, que es lo que pasa con
 * una película: no tiene temporada a la que subir la marca.
 */
export function ambitoDeTemporada(claveEpisodio: string): string | null {
  const sitio = leerClaveDeEpisodio(claveEpisodio);
  if (!sitio) return null;
  return `${sitio.serieId}:s${sitio.temporada}`;
}

/**
 * Cuál de los segmentos manda para un capítulo.
 *
 * El del propio capítulo gana al de su temporada: se marca uno concreto
 * precisamente cuando el de la temporada no vale.
 */
export function segmentoQueManda(
  segmentos: Segmento[],
  claveEpisodio: string,
  tipo: TipoSegmento,
): Segmento | null {
  const suyos = segmentos.filter((uno) => uno.tipo === tipo);
  return (
    suyos.find((uno) => uno.ambito === claveEpisodio) ??
    suyos.find((uno) => uno.ambito === ambitoDeTemporada(claveEpisodio)) ??
    null
  );
}

/**
 * ¿Estamos dentro del segmento?
 *
 * Con un poco de margen por delante: el botón tiene que aparecer justo cuando
 * arranca la careta, y el reloj del reproductor avisa cada pocos cientos de
 * milisegundos. Por detrás no hace falta: pasado el final ya no hay nada que
 * saltar.
 */
export function dentroDelSegmento(segmento: Segmento, tiempo: number, margen = 0.5): boolean {
  return tiempo >= segmento.desde - margen && tiempo < segmento.hasta;
}

/**
 * ¿Vale la pena guardar esto?
 *
 * Una marca al revés o de dos segundos es un despiste de quien la puso, y
 * guardarla estropearía la serie para toda la casa. Una intro dura entre
 * quince segundos y cinco minutos largos; fuera de ahí, no se guarda.
 */
export function segmentoValido(segmento: Segmento): boolean {
  const dura = segmento.hasta - segmento.desde;
  return segmento.desde >= 0 && dura >= 5 && dura <= 600;
}
