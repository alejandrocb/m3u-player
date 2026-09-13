/**
 * Escribe el sello de compilación que enseña la aplicación.
 *
 * Existe por lo que ha costado media tarde más de una vez: cuatro aparatos con
 * versiones distintas y ninguna forma de saberlo desde el sofá. La versión de
 * `package.json` no sirve para eso —no cambia entre dos compilaciones del
 * mismo día—, así que el sello lleva **la fecha y el commit**.
 *
 * Lo lanza Gradle antes de empaquetar el JavaScript (ver `android/app/
 * build.gradle`), así que no hay que acordarse de nada: si el fichero se
 * quedara viejo, estaría mintiendo justo sobre lo que se quiere comprobar.
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const destino = join(raiz, 'apps', 'tv', 'src', 'version.ts');

const version = JSON.parse(readFileSync(join(raiz, 'apps', 'tv', 'package.json'), 'utf8')).version;

/** El commit corto, o nada: compilar fuera de un repositorio tiene que valer. */
function commit() {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: raiz, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return '';
  }
}

/** `2026-09-14 21:40`, en hora local, que es la que mira quien compila. */
function cuando() {
  const ahora = new Date();
  const dos = (n) => String(n).padStart(2, '0');
  return (
    `${ahora.getFullYear()}-${dos(ahora.getMonth() + 1)}-${dos(ahora.getDate())}` +
    ` ${dos(ahora.getHours())}:${dos(ahora.getMinutes())}`
  );
}

const contenido = `/**
 * Generado por \`tools/sello.mjs\` al compilar. **No se edita a mano.**
 *
 * Es lo que se enseña en la pantalla de perfiles para saber, desde el sofá,
 * si un aparato tiene lo último o se quedó en una compilación de ayer.
 */

export const VERSION = '${version}';
export const COMPILADA = '${cuando()}';
export const COMMIT = '${commit()}';
`;

writeFileSync(destino, contenido, 'utf8');
console.log(`[sello] ${version} · ${cuando()} · ${commit() || 'sin commit'}`);
