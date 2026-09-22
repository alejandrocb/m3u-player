/**
 * El llavero de este aparato, cuando se rompe.
 *
 * `react-native-keychain` guarda **todo en un solo fichero**: las listas con
 * sus credenciales y el emparejamiento con la casa. Si ese fichero se
 * corrompe, falla con "Unable to parse preferences proto" en todo, y el
 * aparato se queda sin poder guardar nada: el servidor aprueba el
 * emparejamiento, el aparato no consigue quedárselo, pide otro código, y así
 * indefinidamente.
 */

import { NativeModules } from 'react-native';

interface Nativo {
  reparar(): Promise<boolean>;
}

const nativo = (NativeModules as { Llavero?: Nativo }).Llavero;

/**
 * Si este fallo es el del llavero roto y no otra cosa.
 *
 * Son dos averías distintas con el mismo remedio —borrar y empezar— y las dos
 * se han visto en esta casa:
 *
 * - **El fichero corrupto**, "Unable to parse preferences proto". Pasó en la
 *   tablet Xiaomi sin que nadie tocara nada.
 * - **La clave invalidada**, `CryptoFailedException: Key permanently
 *   invalidated`. El llavero cifra con una clave del almacén de Android que
 *   **se destruye al desinstalar la aplicación**, mientras que el fichero
 *   cifrado sí puede volver con la copia de seguridad automática del sistema.
 *   El resultado son datos que ya no puede descifrar nadie. Salió al cambiar
 *   la clave de firma, que obligó a desinstalar y reinstalar en los cuatro
 *   aparatos; y sale igual si alguien cambia el bloqueo de pantalla.
 *
 * Lo que hay dentro es irrecuperable en los dos casos, así que no se pierde
 * nada borrándolo: el emparejamiento se rehace y las listas las devuelve la
 * casa.
 */
export function esLlaveroRoto(fallo: unknown): boolean {
  const mensaje = fallo instanceof Error ? fallo.message : String(fallo);
  return /preferences proto|CorruptionException|Corruption|permanently invalidated|CryptoFailedException/i.test(
    mensaje,
  );
}

/**
 * Borra el fichero del llavero para poder empezar de cero.
 *
 * Con el fichero ilegible no hay nada que perder: lo que hubiera dentro ya no
 * se puede recuperar. **Hace falta reabrir la aplicación** después, porque el
 * almacén ya está montado en memoria con el error dentro.
 */
export async function limpiarLlavero(): Promise<boolean> {
  return (await nativo?.reparar().catch(() => false)) ?? false;
}
