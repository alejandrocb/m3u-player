/**
 * Actualizar la aplicación sin ordenador.
 *
 * Hasta ahora cada versión entraba por `adb`, con el portátil, el cable o la
 * depuración inalámbrica. En una tablet es incómodo; en la tele del salón es
 * un viaje, y por eso los aparatos se quedaban atrás unos de otros.
 *
 * El servidor de la casa ya sabe quiénes son de aquí —están emparejados y
 * tienen su token—, así que reparte el APK por la misma API: `GET
 * /api/version` dice qué hay y `GET /api/apk` lo entrega. **No hay ninguna
 * dirección abierta con el instalable.**
 *
 * Tres cosas que no son opcionales:
 *
 * - **La firma tiene que ser la misma.** Android solo acepta una actualización
 *   firmada con la clave con la que se instaló lo que hay. Si no coincide, el
 *   sistema dice "aplicación no instalada" y no explica por qué.
 * - **Se comprueba la huella antes de instalar.** Un APK a medias —wifi que se
 *   cae— es un fichero que parece válido y que el instalador rechaza con un
 *   error que no dice nada. Mejor verlo aquí.
 * - **Instala el sistema, no nosotros.** Se le pasa el fichero al instalador de
 *   Android, que pide permiso y enseña lo que va a hacer. La aplicación
 *   necesita `REQUEST_INSTALL_PACKAGES` y que el usuario le deje instalar
 *   aplicaciones desconocidas, una vez por aparato.
 */

import ReactNativeBlobUtil from 'react-native-blob-util';

import type { VersionPublicada } from '@m3u/ui';

import { COMPILADA } from './version';

/** Dónde se deja el APK mientras se instala. */
const DESCARGA = `${ReactNativeBlobUtil.fs.dirs.CacheDir}/chocitatv.apk`;

/**
 * Si lo publicado es más nuevo que lo que corre aquí.
 *
 * Se compara la fecha de compilación y no el commit: con el commit solo se
 * sabría que son **distintos**, y al volver atrás a propósito —para probar
 * algo— la aplicación se ofrecería a sí misma lo que ya tiene.
 */
export function esMasNueva(publicada: VersionPublicada | null): boolean {
  return publicada !== null && publicada.compilada > COMPILADA;
}

export interface AvanceDeActualizacion {
  bytes: number;
  total: number;
}

/**
 * Se baja el APK y se lo da al instalador de Android.
 *
 * El fichero va a la caché a propósito: si algo se tuerce a mitad, el sistema
 * lo borra por su cuenta y no queda un APK de sesenta megas ocupando sitio
 * para siempre —que es exactamente lo que pasó con las descargas—.
 */
export async function bajarEInstalar(
  servidor: string,
  token: string,
  publicada: VersionPublicada,
  alAvanzar: (avance: AvanceDeActualizacion) => void,
): Promise<void> {
  // Lo que hubiera de un intento anterior: se empieza limpio, que son sesenta
  // megas y no merece la pena reanudar.
  await ReactNativeBlobUtil.fs.unlink(DESCARGA).catch(() => undefined);

  const tarea = ReactNativeBlobUtil.config({ path: DESCARGA, timeout: 120_000 }).fetch(
    'GET',
    `${servidor}/api/apk`,
    { authorization: `Bearer ${token}` },
  );

  tarea.progress({ interval: 500 }, (recibidos) => {
    alAvanzar({ bytes: Number(recibidos) || 0, total: publicada.bytes });
  });

  const respuesta = await tarea;
  const estado = respuesta.info().status;
  if (estado !== 200) {
    await ReactNativeBlobUtil.fs.unlink(DESCARGA).catch(() => undefined);
    throw new Error(`el servidor respondió ${estado}`);
  }

  const medida = await ReactNativeBlobUtil.fs.stat(DESCARGA).catch(() => null);
  const bajados = medida ? Number(medida.size) || 0 : 0;
  if (bajados !== publicada.bytes) {
    await ReactNativeBlobUtil.fs.unlink(DESCARGA).catch(() => undefined);
    throw new Error(`la descarga llegó a medias (${bajados} de ${publicada.bytes})`);
  }

  /*
    La huella, si el servidor la dio. Un APK a medias o tocado por el camino lo
    rechaza el instalador con un error que no dice nada, y desde aquí sí se
    puede explicar.
  */
  if (publicada.sha256) {
    const suya = await ReactNativeBlobUtil.fs.hash(DESCARGA, 'sha256').catch(() => '');
    if (suya && suya.toLowerCase() !== publicada.sha256.toLowerCase()) {
      await ReactNativeBlobUtil.fs.unlink(DESCARGA).catch(() => undefined);
      throw new Error('el fichero no coincide con lo publicado');
    }
  }

  console.log(`[actualizar] ${publicada.version} · ${publicada.commit}: al instalador`);
  // De aquí en adelante manda Android: pide permiso, enseña qué va a instalar
  // y al terminar reabre la aplicación.
  ReactNativeBlobUtil.android.actionViewIntent(DESCARGA, 'application/vnd.android.package-archive');
}
