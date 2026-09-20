/**
 * Prepara lo que hay que subir al VPS para publicar una versión.
 *
 * No compila ni sube nada: mira el APK que ya hay compilado y escribe a su
 * lado el `version.json` que el servidor necesita para poder ofrecerlo. Subir
 * los dos ficheros es el último paso, y lo hace quien despliega.
 *
 * Comprueba dos cosas antes, que son las que dejan a una casa sin poder
 * actualizarse y no se ven hasta que es tarde:
 *
 * - Que el APK está **firmado con la clave de la casa** y no con la de
 *   depuración. Android solo acepta una actualización firmada igual que lo
 *   instalado; publicar uno firmado con la otra clave da "aplicación no
 *   instalada" en todos los aparatos, sin más explicación.
 * - Que el sello del APK es **el de la compilación de verdad** y no el de una
 *   anterior, comparándolo con `apps/tv/src/version.ts`.
 *
 * Uso:  node tools/publicar.mjs
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const APK = join(RAIZ, 'apps/tv/android/app/build/outputs/apk/release/app-release.apk');
const FICHA = join(dirname(APK), 'version.json');

/** Quién firma el APK, leído del propio fichero. */
function quienLoFirma(ruta) {
  const sdk = process.env.ANDROID_HOME ?? join(process.env.LOCALAPPDATA ?? '', 'Android/Sdk');
  for (const version of ['35.0.0', '34.0.0', '36.0.0']) {
    const apksigner = join(sdk, 'build-tools', version, process.platform === 'win32' ? 'apksigner.bat' : 'apksigner');
    try {
      /*
        `shell: true` y las comillas: desde Node 20, `execFile` no ejecuta un
        `.bat` sin shell —lo cerraron por seguridad—, y con shell hay que
        entrecomillar porque las rutas de Windows llevan espacios.
      */
      const salida = execFileSync(`"${apksigner}"`, ['verify', '--print-certs', `"${ruta}"`], {
        encoding: 'utf8',
        shell: process.platform === 'win32',
      });
      return /certificate DN: (.*)/.exec(salida)?.[1]?.trim() ?? null;
    } catch {
      // Esa versión de las herramientas no está; se prueba la siguiente.
    }
  }
  return null;
}

async function huella(ruta) {
  const resumen = createHash('sha256');
  for await (const trozo of createReadStream(ruta)) resumen.update(trozo);
  return resumen.digest('hex');
}

const medida = await stat(APK).catch(() => null);
if (!medida) {
  console.error('No hay APK compilado. Antes: cd apps/tv/android && ./gradlew.bat assembleRelease');
  process.exit(1);
}

const sello = await readFile(join(RAIZ, 'apps/tv/src/version.ts'), 'utf8');
const leer = (nombre) => new RegExp(`${nombre} = '([^']*)'`).exec(sello)?.[1] ?? '';
const version = leer('VERSION');
const compilada = leer('COMPILADA');
const commit = leer('COMMIT');

if (!compilada || !commit) {
  console.error('El sello de `apps/tv/src/version.ts` no se puede leer.');
  process.exit(1);
}

const firma = quienLoFirma(APK);
if (firma === null) {
  console.warn('No se ha podido comprobar la firma: no encuentro `apksigner`.');
} else if (/Android Debug/i.test(firma)) {
  console.error('ESTE APK VA FIRMADO CON LA CLAVE DE DEPURACIÓN:', firma);
  console.error('Los aparatos lo rechazarían con "aplicación no instalada".');
  console.error('Falta `~/.chocitatv/keystore.properties`; recompila con la clave de la casa.');
  process.exit(1);
} else {
  console.log('Firmado por:', firma);
}

await writeFile(FICHA, `${JSON.stringify({ version, compilada, commit }, null, 2)}\n`, 'utf8');

const mega = (bytes) => `${(bytes / 1_000_000).toFixed(1)} MB`;
console.log(`Versión ${version} · ${compilada} · ${commit} · ${mega(medida.size)}`);
console.log(`sha256   ${await huella(APK)}`);
console.log('');
console.log('Sube estos dos a la carpeta `APK_DIR` del VPS, y el APK con el nombre `chocitatv.apk`:');
console.log('  ', APK);
console.log('  ', FICHA);
