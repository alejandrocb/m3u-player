/**
 * Contraseñas, tokens y códigos de emparejamiento.
 *
 * Todo sale de `node:crypto`, que viene dentro de Node: ni una dependencia,
 * igual que en el resto del proyecto. Aquí eso no es solo elegancia —una
 * biblioteca de terceros en el camino de las contraseñas es exactamente
 * donde no interesa tener sorpresas—.
 */

import { createHash, randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';

/** Cadena aleatoria en hexadecimal. 32 bytes es lo que se usa para los tokens. */
export function aleatorio(bytes = 32): string {
  return randomBytes(bytes).toString('hex');
}

/**
 * Alfabeto de los códigos que se leen en una pantalla y se teclean en otra.
 *
 * Sin `I`, `L`, `O`, `0` ni `1`: en la tele, a tres metros, son la misma
 * letra, y el que se equivoca de carácter no entiende por qué no le funciona.
 */
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/**
 * Código corto de emparejamiento, del estilo `K7M2-P4XR`.
 *
 * Ocho caracteres de un alfabeto de treinta y uno son del orden de un billón
 * de combinaciones. No es lo que protege el alta —eso lo hace el secreto de
 * espera, que es largo—, pero conviene que tampoco se pueda adivinar a mano.
 */
export function codigoCorto(): string {
  let codigo = '';
  for (let i = 0; i < 8; i++) codigo += ALFABETO[randomInt(ALFABETO.length)];
  return `${codigo.slice(0, 4)}-${codigo.slice(4)}`;
}

/**
 * Huella de un token, que es lo que se guarda en la base.
 *
 * SHA-256 a secas basta **porque el token lo generamos nosotros con 32 bytes
 * aleatorios**: no hay diccionario que probar. Las contraseñas son otra cosa
 * y van más abajo, con scrypt.
 */
export function huella(valor: string): string {
  return createHash('sha256').update(valor).digest('hex');
}

/** Cuántas veces se repite el cálculo de scrypt. El coste es el punto. */
const SCRYPT_COSTE = 16384;
const SCRYPT_LARGO = 64;

/**
 * Deja una contraseña lista para guardar: `sal:resumen`.
 *
 * scrypt es deliberadamente lento y con mucha memoria, que es justo lo que
 * hace inviable probar millones de contraseñas contra un volcado de la base.
 */
export function cifrarContrasena(contrasena: string): string {
  const sal = randomBytes(16).toString('hex');
  const resumen = scryptSync(contrasena, sal, SCRYPT_LARGO, { N: SCRYPT_COSTE }).toString('hex');
  return `${sal}:${resumen}`;
}

/**
 * ¿Es esta la contraseña?
 *
 * La comparación es de tiempo constante: una comparación normal se rinde en
 * el primer carácter distinto, y ese "cuánto ha tardado en decir que no" es
 * suficiente para ir adivinando el resumen carácter a carácter.
 */
export function compruebaContrasena(contrasena: string, guardado: string): boolean {
  const [sal, resumen] = guardado.split(':');
  if (!sal || !resumen) return false;

  const candidato = scryptSync(contrasena, sal, SCRYPT_LARGO, { N: SCRYPT_COSTE });
  const esperado = Buffer.from(resumen, 'hex');
  if (candidato.length !== esperado.length) return false;
  return timingSafeEqual(candidato, esperado);
}
