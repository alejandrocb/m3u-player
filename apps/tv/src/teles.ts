/**
 * Encontrar las teles de casa a las que mandar un vídeo.
 *
 * La búsqueda por la red es nativa (`ModuloDeTeles.kt`, por UDP); leer la
 * ficha de cada una y quedarse con las que saben reproducir lo hace
 * `leerTele`, de `@m3u/core`, que es lo mismo que se prueba en el portátil.
 */

import { NativeModules } from 'react-native';

import { codecsDeMatroska, leerTele, type Tele } from '@m3u/core';
import { urlSinCredenciales } from '@m3u/ui';

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

/**
 * Lo que dice el propio fichero cuando se le pregunta como lo haría un
 * reproductor: si el panel lo da, si redirige a otro servidor y qué pistas
 * trae.
 *
 * Se piden **solo los primeros 256 KB**: en un MKV la lista de pistas va al
 * principio, y pedir más sería bajarse la película para leer una etiqueta.
 * Se leen como texto aunque sean binarios; los nombres de los códecs son
 * ASCII y sobreviven (ver `codecsDeMatroska`).
 */
export async function mirarElFichero(url: string): Promise<{ estado: number; redirige: string | null; codecs: string[] }> {
  const respuesta = await conPlazo(15_000)(url, {
    headers: { 'User-Agent': 'VLC/3.0.20 LibVLC/3.0.20', Range: 'bytes=0-262143' },
  });
  const texto = await respuesta.text().catch(() => '');
  // Si la dirección final no es la pedida, el panel ha redirigido: hay teles
  // que no saben seguir ese salto.
  const final = respuesta.url && respuesta.url !== url ? urlSinCredenciales(respuesta.url) : null;
  return { estado: respuesta.status, redirige: final, codecs: codecsDeMatroska(texto) };
}
