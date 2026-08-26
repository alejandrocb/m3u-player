/**
 * Formateo de los textos que se ven en pantalla.
 *
 * Sin `Intl`: en Android la interfaz corre sobre Hermes, cuyo soporte de
 * internacionalización varía entre versiones y plataformas. Son dos reglas
 * sencillas y es preferible tenerlas aquí, iguales en todas partes.
 */

/** Separador de miles a la española: 17968 -> "17.968". */
export function numero(valor: number): string {
  const entero = Math.trunc(Math.abs(valor)).toString();
  const conPuntos = entero.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return valor < 0 ? `-${conPuntos}` : conPuntos;
}

/**
 * Cantidad con su unidad, concordando en número: "1 canal", "486 canales".
 *
 * Sin esto salen cosas como "1 episodios", que es lo primero que se ve al
 * abrir una serie con una sola temporada corta.
 */
export function cantidad(valor: number, singular: string, plural: string): string {
  return `${numero(valor)} ${valor === 1 ? singular : plural}`;
}

/**
 * Duración en la unidad que toca: "45 s", "12 min", "1 h 32 min".
 *
 * Redondear siempre a minutos deja los avances y los clips cortos en "0 min",
 * y las películas de dos horas en "127 min", que no dice nada de un vistazo.
 */
export function duracion(segundos: number): string {
  if (!Number.isFinite(segundos) || segundos <= 0) return '';

  const total = Math.round(segundos);
  if (total < 60) return `${total} s`;

  const minutos = Math.round(total / 60);
  if (minutos < 60) return `${minutos} min`;

  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  return resto === 0 ? `${horas} h` : `${horas} h ${resto} min`;
}

/**
 * Tiempo en formato de reloj: "04:57", "1:49:37".
 *
 * Distinto de `duracion`, que redondea para una ficha ("92 min"). En un
 * reproductor hace falta el segundo exacto, y la hora solo cuando la hay.
 */
export function reloj(segundos: number): string {
  if (!Number.isFinite(segundos) || segundos < 0) return '0:00';

  const total = Math.floor(segundos);
  const horas = Math.floor(total / 3600);
  const minutos = Math.floor((total % 3600) / 60);
  const resto = total % 60;
  const dosCifras = (valor: number): string => String(valor).padStart(2, '0');

  return horas > 0 ? `${horas}:${dosCifras(minutos)}:${dosCifras(resto)}` : `${minutos}:${dosCifras(resto)}`;
}

/**
 * Nota del panel tal y como se pinta en la carátula: "7,2", "9", "10".
 *
 * Una cifra decimal como mucho —el panel las da entre 0 y 10, y "7,25" no dice
 * más que "7,2"— y sin el ",0" de las redondas, que en una pastilla de
 * cuarenta píxeles es ruido.
 */
export function nota(valoracion: number): string {
  const redondeada = Math.round(valoracion * 10) / 10;
  return Number.isInteger(redondeada) ? String(redondeada) : redondeada.toFixed(1).replace('.', ',');
}

/**
 * La nota en medias estrellas: de 0 a 10, sobre cinco estrellas.
 *
 * El panel la da sobre diez, que es la escala de las bases de datos de cine,
 * pero cinco estrellas es lo que la gente lee de un golpe: "cuatro y media"
 * se entiende sin pensar, "8,7" hay que traducirlo.
 *
 * Devuelve el número de mitades y no una cadena de caracteres porque **la
 * media estrella hay que dibujarla**: el carácter que existe para ella
 * (U+2BE8) no está en la fuente de un televisor y sale como un cuadrado.
 * Se redondea al medio punto: un 8,7 son cuatro y media, no cuatro y tres
 * cuartos, que no tiene dibujo.
 */
export function mediasEstrellas(valoracion: number): number {
  if (!Number.isFinite(valoracion) || valoracion <= 0) return 0;
  return Math.round(Math.min(5, valoracion / 2) * 2);
}
