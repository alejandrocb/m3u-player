/**
 * Medir una imagen sin descargarla entera.
 *
 * Hace falta para una sola decisión: **si la imagen es apaisada**. El panel
 * mete a veces un cartel vertical en el campo del fondo, y una portada con un
 * 2:3 estirado a lo ancho es exactamente lo que estamos evitando.
 *
 * Las dimensiones van en la cabecera del fichero, en los primeros bytes, así
 * que se piden con `Range` y se leen ahí. Si el servidor ignora el `Range` y
 * manda la imagen entera, se corta la lectura al llegar al tope: da igual, ya
 * están las medidas.
 *
 * No hay librería: son tres formatos y treinta líneas cada uno. Meter una
 * dependencia en un servidor que no tiene ninguna, por esto, no compensa.
 */

/** Cuánto se lee como mucho. La cabecera cabe de sobra. */
const TOPE = 64 * 1024;

export interface Medida {
  ancho: number;
  alto: number;
}

/**
 * Proporción mínima para considerar apaisada una imagen.
 *
 * Un fondo de verdad es 16:9 (1,78). Un cartel es 2:3 (0,67). Con 1,3 se
 * aceptan los 4:3 raros y se rechaza todo lo vertical, sin quedarse en el
 * filo de nada.
 */
export const APAISADA = 1.3;

export function esApaisada(medida: Medida | null): boolean {
  if (!medida || medida.alto === 0) return false;
  return medida.ancho / medida.alto >= APAISADA;
}

/** Lee la cabecera de una imagen por HTTP y la mide. `null` si no se puede. */
export async function medirRemota(
  url: string,
  opciones: { fetch?: typeof globalThis.fetch; timeoutMs?: number } = {},
): Promise<Medida | null> {
  const hacerFetch = opciones.fetch ?? globalThis.fetch;
  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), opciones.timeoutMs ?? 10_000);
  try {
    const respuesta = await hacerFetch(url, {
      signal: control.signal,
      headers: { Range: `bytes=0-${TOPE - 1}` },
    });
    if (!respuesta.ok && respuesta.status !== 206) return null;

    const bytes = new Uint8Array((await respuesta.arrayBuffer()).slice(0, TOPE));
    return medir(bytes);
  } catch {
    // Una imagen que no se puede medir se trata como si no estuviera: la
    // sugerencia se queda fuera y ya está.
    return null;
  } finally {
    clearTimeout(reloj);
  }
}

/** Mide unos bytes de cabecera. Reconoce JPEG, PNG, GIF y WebP. */
export function medir(bytes: Uint8Array): Medida | null {
  return medirPng(bytes) ?? medirGif(bytes) ?? medirWebp(bytes) ?? medirJpeg(bytes);
}

function u16(bytes: Uint8Array, posicion: number): number {
  return (bytes[posicion]! << 8) | bytes[posicion + 1]!;
}

function u32(bytes: Uint8Array, posicion: number): number {
  return (
    ((bytes[posicion]! << 24) | (bytes[posicion + 1]! << 16) | (bytes[posicion + 2]! << 8) | bytes[posicion + 3]!) >>> 0
  );
}

function texto(bytes: Uint8Array, posicion: number, largo: number): string {
  return String.fromCharCode(...bytes.slice(posicion, posicion + largo));
}

function medirPng(bytes: Uint8Array): Medida | null {
  // 8 bytes de firma, 4 de longitud, "IHDR", y ahí van ancho y alto.
  if (bytes.length < 24) return null;
  if (bytes[0] !== 0x89 || texto(bytes, 1, 3) !== 'PNG') return null;
  return { ancho: u32(bytes, 16), alto: u32(bytes, 20) };
}

function medirGif(bytes: Uint8Array): Medida | null {
  if (bytes.length < 10 || texto(bytes, 0, 3) !== 'GIF') return null;
  // En GIF van al revés que en todo lo demás: en little endian.
  return { ancho: bytes[6]! | (bytes[7]! << 8), alto: bytes[8]! | (bytes[9]! << 8) };
}

function medirWebp(bytes: Uint8Array): Medida | null {
  if (bytes.length < 30 || texto(bytes, 0, 4) !== 'RIFF' || texto(bytes, 8, 4) !== 'WEBP') return null;

  const clase = texto(bytes, 12, 4);
  if (clase === 'VP8X') {
    // Lienzo en 24 bits little endian, y guardado con uno menos.
    const ancho = 1 + (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16));
    const alto = 1 + (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16));
    return { ancho, alto };
  }
  if (clase === 'VP8 ') {
    // Detrás de la marca de arranque del fotograma van 14 bits de cada medida.
    const marca = 20;
    if (bytes[marca] !== 0x9d || bytes[marca + 1] !== 0x01 || bytes[marca + 2] !== 0x2a) return null;
    return {
      ancho: (bytes[marca + 3]! | (bytes[marca + 4]! << 8)) & 0x3fff,
      alto: (bytes[marca + 5]! | (bytes[marca + 6]! << 8)) & 0x3fff,
    };
  }
  return null;
}

/**
 * JPEG: hay que recorrer los segmentos hasta dar con el que describe el marco.
 *
 * Antes vienen las miniaturas y los datos de la cámara, que no interesan y
 * que además traen sus propias medidas —leerlas sería medir la miniatura—.
 */
function medirJpeg(bytes: Uint8Array): Medida | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;

  let posicion = 2;
  // `+ 9` porque el segmento del marco se lee hasta el noveno byte.
  while (posicion + 9 <= bytes.length) {
    if (bytes[posicion] !== 0xff) {
      posicion += 1;
      continue;
    }
    const marca = bytes[posicion + 1]!;
    // Relleno entre segmentos.
    if (marca === 0xff) {
      posicion += 1;
      continue;
    }
    // Los SOFn llevan el tamaño del marco; C4, C8 y CC son otra cosa.
    const esMarco = marca >= 0xc0 && marca <= 0xcf && marca !== 0xc4 && marca !== 0xc8 && marca !== 0xcc;
    if (esMarco) return { alto: u16(bytes, posicion + 5), ancho: u16(bytes, posicion + 7) };

    const largo = u16(bytes, posicion + 2);
    if (largo < 2) return null;
    posicion += 2 + largo;
  }
  return null;
}
