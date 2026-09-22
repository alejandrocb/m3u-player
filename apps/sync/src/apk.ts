/**
 * La última versión de la aplicación, para que los aparatos se actualicen.
 *
 * **Se reparte por la API con token, no por una carpeta pública.** El servidor
 * ya sabe qué aparatos son de la casa —están emparejados y tienen su token—,
 * así que no hay que inventar ninguna autenticación nueva ni dejar una URL
 * abierta con el APK. Un aparato que no sea de la casa no ve nada.
 *
 * En el disco del VPS son dos ficheros, que los pone el que publica:
 *
 * - `chocitatv.apk`, el que se instala.
 * - `version.json`, con `{ version, compilada, commit }`, tal y como los deja
 *   `tools/sello.mjs` en la compilación.
 *
 * El tamaño y la huella no se escriben a mano: se sacan del propio fichero, que
 * es lo único que no puede mentir.
 */

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Dónde deja el APK quien publica.
 *
 * Cuelga de `DATOS` —el mismo sitio donde vive todo lo demás del servidor, que
 * en el VPS es el volumen `m3u-sync-datos`— para que publicar no obligue a
 * montar nada nuevo ni a tocar `compose.yaml`. Se puede mover con `APK_DIR`.
 */
export const CARPETA = process.env.APK_DIR ?? join(process.env.DATOS ?? '/datos', 'apk');

const APK = 'chocitatv.apk';
const FICHA = 'version.json';

export interface VersionPublicada {
  version: string;
  /** `YYYY-MM-DD HH:mm`, que es el orden en que se comparan. */
  compilada: string;
  commit: string;
  bytes: number;
  sha256: string;
}

/**
 * Lo calculado la última vez.
 *
 * Sacar el sha256 son sesenta megas de lectura, y esto se pregunta en cada
 * arranque de cada aparato. Se recuerda mientras el fichero no cambie de
 * tamaño ni de fecha.
 */
let recordado: { marca: string; ficha: VersionPublicada } | null = null;

export function rutaDelApk(): string {
  return join(CARPETA, APK);
}

async function huella(ruta: string): Promise<string> {
  const resumen = createHash('sha256');
  for await (const trozo of createReadStream(ruta)) resumen.update(trozo as Buffer);
  return resumen.digest('hex');
}

/** La versión publicada, o `null` si todavía no hay ninguna. */
export async function ultimaVersion(): Promise<VersionPublicada | null> {
  const ruta = rutaDelApk();

  const medida = await stat(ruta).catch(() => null);
  if (!medida) return null;

  const marca = `${medida.size}:${medida.mtimeMs}`;
  if (recordado && recordado.marca === marca) return recordado.ficha;

  const dicho = await readFile(join(CARPETA, FICHA), 'utf8')
    .then((texto) => JSON.parse(texto) as Partial<VersionPublicada>)
    .catch(() => null);
  if (!dicho?.compilada || !dicho.commit) {
    console.warn('[apk] hay fichero pero no ficha: falta o no se puede leer', FICHA);
    return null;
  }

  const ficha: VersionPublicada = {
    version: dicho.version ?? '0.0.0',
    compilada: dicho.compilada,
    commit: dicho.commit,
    bytes: medida.size,
    sha256: await huella(ruta),
  };

  recordado = { marca, ficha };
  console.log(`[apk] publicada ${ficha.version} · ${ficha.compilada} · ${ficha.commit}`);
  return ficha;
}
