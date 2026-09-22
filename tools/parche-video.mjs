/**
 * Enciende las extensiones de decodificación en `react-native-video`.
 *
 * La librería las trae **apagadas a fuego**:
 *
 *     .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_OFF)
 *
 * y sin tocar eso, el decodificador FFmpeg que compilamos aparte no se usa
 * nunca aunque esté dentro del APK. Con `..._ON` ExoPlayer sigue prefiriendo
 * los decodificadores del aparato —que van por hardware y gastan menos
 * batería— y solo cae en el nuestro **cuando no hay ninguno**, que es justo
 * el caso del DTS en la tele y de cualquier Dolby en la tablet Samsung.
 *
 * `..._PREFER` sería peor: usaría el nuestro incluso para el H.264 que el
 * aparato decodifica por hardware.
 *
 * Va en el `postinstall` y no con una herramienta de parches para no añadir
 * una dependencia por una línea. Es idempotente: pasarlo dos veces no hace
 * nada la segunda.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const FICHERO = join(
  RAIZ,
  'node_modules/react-native-video/android/src/main/java/com/brentvatne/exoplayer/ReactExoplayerView.java',
);

const APAGADO = 'DefaultRenderersFactory.EXTENSION_RENDERER_MODE_OFF';
const ENCENDIDO = 'DefaultRenderersFactory.EXTENSION_RENDERER_MODE_ON';

const texto = await readFile(FICHERO, 'utf8').catch(() => null);

if (texto === null) {
  // Sin la librería no hay nada que parchear: será una instalación a medias o
  // una máquina donde solo se tocan los paquetes de arriba.
  process.exit(0);
}

if (texto.includes(ENCENDIDO)) {
  process.exit(0);
}

if (!texto.includes(APAGADO)) {
  /*
    Callarse aquí sería lo peor: el APK saldría sin poder decodificar DTS y el
    fallo aparecería en el salón, no en la consola. Pero tampoco se rompe la
    instalación de nadie por esto, así que se avisa a gritos y se sigue.
  */
  console.warn('');
  console.warn('  AVISO: no encuentro `EXTENSION_RENDERER_MODE_OFF` en react-native-video.');
  console.warn('  Seguramente ha cambiado de versión. Sin ese cambio, el decodificador');
  console.warn('  FFmpeg no se usa y el audio DTS volverá a fallar en la tele.');
  console.warn('  Mira ReactExoplayerView.java y tools/parche-video.mjs.');
  console.warn('');
  process.exit(0);
}

await writeFile(FICHERO, texto.replace(APAGADO, ENCENDIDO), 'utf8');
console.log('[parche] react-native-video: extensiones de decodificación encendidas');
