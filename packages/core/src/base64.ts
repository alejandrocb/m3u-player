/**
 * Base64, en los dos sentidos.
 *
 * **Ni `atob`, ni `btoa`, ni `Buffer`, ni `TextDecoder`**: `packages/core`
 * tiene que funcionar igual en Node y en Hermes, y Hermes no trae ninguno.
 * Costó verlo, porque la conversión fallaba en silencio y la parrilla del
 * directo salía escrita en base64 en la tablet mientras los tests pasaban en
 * el portátil.
 *
 * Lo usan el EPG del panel —que manda los títulos codificados— y "Ver en la
 * tele", para pasarle al lado nativo los trozos de fichero que hay que
 * cambiar al vuelo.
 */

const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** De base64 a bytes. `null` si lo que venía no era base64. */
export function bytesDeBase64(valor: string): number[] | null {
  const sinEspacios = valor.replace(/\s/g, '');
  // La longitud múltiplo de cuatro es lo que separa el base64 de una frase que
  // por casualidad solo lleva letras: "Telediario 1" se descodificaría sin
  // protestar y saldría convertido en tres caracteres ilegibles.
  if (sinEspacios.length === 0 || sinEspacios.length % 4 !== 0) return null;

  const limpio = sinEspacios.replace(/=+$/, '');
  if (limpio.length === 0) return [];

  const bytes: number[] = [];
  let acumulado = 0;
  let bits = 0;
  for (const letra of limpio) {
    const indice = ALFABETO.indexOf(letra);
    // Un carácter que no es base64 significa que esto no venía codificado.
    if (indice < 0) return null;
    acumulado = (acumulado << 6) | indice;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((acumulado >> bits) & 0xff);
    }
  }
  return bytes;
}

/** Y de bytes a base64, con su relleno. */
export function base64DeBytes(bytes: number[]): string {
  let texto = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const tres = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    const cuantos = Math.min(3, bytes.length - i);
    texto +=
      ALFABETO[(tres >> 18) & 0x3f]! +
      ALFABETO[(tres >> 12) & 0x3f]! +
      (cuantos > 1 ? ALFABETO[(tres >> 6) & 0x3f]! : '=') +
      (cuantos > 2 ? ALFABETO[tres & 0x3f]! : '=');
  }
  return texto;
}
