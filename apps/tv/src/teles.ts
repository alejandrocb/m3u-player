/**
 * Encontrar las teles de casa a las que mandar un vídeo.
 *
 * La búsqueda por la red es nativa (`ModuloDeTeles.kt`, por UDP); leer la
 * ficha de cada una y quedarse con las que saben reproducir lo hace
 * `leerTele`, de `@m3u/core`, que es lo mismo que se prueba en el portátil.
 */

import { DeviceEventEmitter, NativeModules } from 'react-native';

import ReactNativeBlobUtil from 'react-native-blob-util';

import {
  base64DeBytes,
  bytesDeBase64,
  codecsDeMatroska,
  leerTele,
  pistasDeMatroska,
  type Parche,
  type PistaMkv,
  type Tele,
} from '@m3u/core';

interface Nativo {
  buscar(milisegundos: number): Promise<string[]>;
  avisar(titulo: string, detalle: string, sonando: boolean): void;
  callar(): void;
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
export interface CabeceraDelFichero {
  estado: number;
  /** Las pistas del MKV: audio, subtítulos y en qué idioma va cada una. */
  pistas: PistaMkv[];
  /** Los códecs, por si la cabecera no se pudo leer entera. */
  codecs: string[];
}

/**
 * El principio del fichero, leído como lo leería un reproductor.
 *
 * Se piden **medio mega**: la lista de pistas de un MKV va al principio, y
 * pedir más sería bajarse la película para leer una etiqueta. Va por
 * `react-native-blob-util` y no por `fetch` porque hacen falta **los bytes**,
 * no texto: un MKV leído como texto llega hecho trizas. Y se descodifica con
 * el base64 de `@m3u/core`, que existe justamente porque Hermes no trae
 * `atob` ni `TextDecoder`.
 */
export async function mirarElFichero(url: string): Promise<CabeceraDelFichero> {
  const respuesta = await ReactNativeBlobUtil.config({ timeout: 15_000 }).fetch('GET', url, {
    'User-Agent': 'VLC/3.0.20 LibVLC/3.0.20',
    Accept: '*/*',
    Range: 'bytes=0-524287',
  });
  const estado = respuesta.info().status;
  const bytes = Uint8Array.from(bytesDeBase64(respuesta.base64()) ?? []);
  const pistas = pistasDeMatroska(bytes);

  // Si no se pudo leer la cabecera entera —hay ficheros que la traen más
  // adelante—, al menos los nombres de los códecs se ven a simple vista.
  const codecs = pistas.length > 0 ? pistas.map((pista) => pista.codec) : codecsDeMatroska(comoTexto(bytes));
  console.log(`[tele] el fichero: ${estado} · ${pistas.length} pistas · ${codecs.join(', ') || 'sin reconocer'}`);
  return { estado, pistas, codecs };
}

/** Los bytes como caracteres sueltos, solo para buscar cadenas ASCII. */
function comoTexto(bytes: Uint8Array): string {
  let texto = '';
  for (let i = 0; i < bytes.length; i += 4096) {
    texto += String.fromCharCode(...bytes.subarray(i, Math.min(bytes.length, i + 4096)));
  }
  return texto;
}

interface NativoPuente {
  abrir(url: string, tipo: string, parches: Array<{ desde: number; datos: string }>): Promise<string>;
  cerrar(): void;
}

const puente = (NativeModules as { Puente?: NativoPuente }).Puente;

/**
 * La dirección que hay que darle a la tele: la del puente del teléfono, que
 * le pide el vídeo al panel como un reproductor cualquiera (`ModuloDePuente`).
 *
 * Si el puente no está —un APK anterior— se le da la del panel tal cual,
 * que con algunas teles funciona y con la Samsung de casa no.
 */
export async function direccionParaLaTele(url: string, tipo: string, parches: Parche[] = []): Promise<string> {
  if (!puente) return url;
  // Los bytes viajan en base64: es lo que entiende el puente del otro lado.
  return puente.abrir(
    url,
    tipo,
    parches.map((parche) => ({ desde: parche.desde, datos: base64DeBytes(parche.bytes) })),
  );
}

/** Cierra el puente al dejar de ver en la tele: suelta la wifi y la CPU. */
export function cerrarPuente(): void {
  puente?.cerrar();
}

/*
  El aviso de la barra mientras algo suena en la tele (`ServicioDeTele`).

  Es lo que deja salir de la aplicación: el vídeo pasa por el teléfono, y sin
  un servicio en primer plano MIUI le quita el candado de CPU al puente en
  cuanto la aplicación se va al fondo. Y trae la tarea sin interfaz que
  mantiene andando el reloj de JavaScript, que es el que pregunta a la tele.
*/

/** Lo último que se mandó, para no repintar el aviso cada dos segundos. */
let ultimoAviso = '';
let cerrarTarea: (() => void) | null = null;
let hayTele = false;

/** Pone o cambia el aviso. Solo llama al lado nativo si ha cambiado algo. */
export function avisarDeLaTele(titulo: string, detalle: string, sonando: boolean): void {
  hayTele = true;
  const linea = `${titulo}|${detalle}|${sonando}`;
  if (!nativo || linea === ultimoAviso) return;
  ultimoAviso = linea;
  nativo.avisar(titulo, detalle, sonando);
}

/** Lo quita, y con él la tarea y el candado. */
export function callarLaTele(): void {
  hayTele = false;
  ultimoAviso = '';
  cerrarTarea?.();
  cerrarTarea = null;
  nativo?.callar();
}

/** La tarea sin interfaz, registrada en `index.js`: existir es su trabajo. */
export function tareaDeTele(): Promise<void> {
  if (!hayTele) return Promise.resolve();
  return new Promise<void>((listo) => {
    cerrarTarea = listo;
  });
}

/** Lo que piden los botones del aviso: "alternar" o "parar". */
export function alPulsarElAviso(hacer: (orden: 'alternar' | 'parar') => void): () => void {
  const suscripcion = DeviceEventEmitter.addListener('ordenDeTele', (orden: string) => {
    if (orden === 'alternar' || orden === 'parar') hacer(orden);
  });
  return () => suscripcion.remove();
}
