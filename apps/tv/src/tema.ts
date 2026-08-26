/**
 * Los colores y las medidas de la aplicación, en un solo sitio.
 *
 * No es una hoja de estilos: React Native no tiene cascada, ni selectores, ni
 * herencia. Lo único que se puede compartir entre pantallas son los valores,
 * así que aquí viven los que se repetían a mano —el verde estaba copiado en
 * cinco ficheros y el fondo, escrito dentro de cada degradado—.
 *
 * El fondo es **negro**, no azul: los carteles traen su propio color y
 * cualquier tinte de fondo compite con ellos. Se guarda además en
 * `FONDO_RGB` porque los degradados se escriben como texto CSS
 * (`experimental_backgroundImage`) y ahí hacen falta las componentes sueltas
 * para poder darles transparencia.
 */

export const FONDO = '#0b0b0c';

/** Las componentes de `FONDO`, para montar `rgba(...)` en los degradados. */
export const FONDO_RGB = '11,11,12';

/** Un peldaño por encima del fondo: barras, fichas vacías, superficies. */
export const SUPERFICIE = '#17171a';

/** El color de la marca. Lo enfocado y lo activo. */
export const VERDE = '#35d07f';

/** Blanco roto para los títulos; el blanco puro se reserva a lo enfocado. */
export const TINTA = '#f2f6f9';

/** Texto secundario: detalles, sinopsis, lo que acompaña. */
export const TINTA_SUAVE = '#b9c2cc';

/** Texto apagado: rótulos de fila, cosas que solo se leen si se buscan. */
export const TINTA_TENUE = '#8a929c';

export const ROJO = '#ff6b6b';

/** El margen lateral de todas las pantallas. */
export const MARGEN_PANTALLA = 32;

/** El hueco que deja arriba la barra flotante del inicio. */
export const MARGEN_CABECERA = 96;

/**
 * Cuánto crece una ficha al enfocarse.
 *
 * Es el efecto de Netflix, y en un televisor no es decoración: desde el sofá,
 * el marco de tres píxeles se ve mal y el tamaño se ve siempre.
 */
export const ESCALA_ENFOQUE = 1.12;
