/**
 * Encontrar las teles de casa a las que mandar un vídeo.
 *
 * La búsqueda por la red es nativa (`ModuloDeTeles.kt`, por UDP); leer la
 * ficha de cada una y quedarse con las que saben reproducir lo hace
 * `leerTele`, de `@m3u/core`, que es lo mismo que se prueba en el portátil.
 */

import { NativeModules } from 'react-native';

import { leerTele, type Tele } from '@m3u/core';

interface Nativo {
  buscar(milisegundos: number): Promise<string[]>;
}

/*
  Puede no estar: en un APK anterior a que existiera. Sin él, "Ver en la tele"
  dice que no encuentra ninguna, que es verdad.
*/
const nativo = (NativeModules as { Teles?: Nativo }).Teles;

/**
 * Cuánto se escucha la red. Las teles contestan en menos de un segundo, pero
 * una medio dormida tarda más; dos segundos y medio es lo que se tarda en
 * darle a un botón y mirar a la tele.
 */
const ESCUCHA_MS = 2_500;

/** Cuánto se espera a que una tele dé su ficha antes de darla por perdida. */
const PLAZO_FICHA_MS = 4_000;

/** Un `fetch` que no se queda colgado esperando a un aparato que no contesta. */
function conPlazo(ms: number): typeof globalThis.fetch {
  return ((url: string, opciones?: RequestInit) => {
    const control = new AbortController();
    const reloj = setTimeout(() => control.abort(), ms);
    return fetch(url, { ...opciones, signal: control.signal }).finally(() => clearTimeout(reloj));
  }) as typeof globalThis.fetch;
}

/** El `fetch` con el que se le habla a una tele ya encontrada. */
export const pedirALaTele = conPlazo(8_000);

/**
 * Las teles que hay ahora mismo en la red, por su nombre.
 *
 * Una tele contesta a las dos preguntas de la búsqueda y a veces por dos
 * sitios, así que se juntan por la dirección a la que se le mandan las
 * órdenes: eso sí es una por tele.
 */
export async function buscarTeles(): Promise<Tele[]> {
  if (!nativo) return [];

  const fichas = [...new Set(await nativo.buscar(ESCUCHA_MS).catch(() => [] as string[]))];
  console.log(`[tele] ${fichas.length} aparatos contestan en la red`);

  const leidas = await Promise.all(fichas.map((ficha) => leerTele(ficha, conPlazo(PLAZO_FICHA_MS)).catch(() => null)));

  const porControl = new Map<string, Tele>();
  for (const tele of leidas) if (tele && !porControl.has(tele.control)) porControl.set(tele.control, tele);

  const teles = [...porControl.values()].sort((a, b) => a.nombre.localeCompare(b.nombre));
  console.log(`[tele] ${teles.length} saben reproducir: ${teles.map((tele) => tele.nombre).join(', ') || 'ninguna'}`);
  return teles;
}
