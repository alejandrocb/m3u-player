/**
 * La hora y el hueco del vídeo.
 *
 * Lo que queda de la columna del directo, que se fue cuando TV en directo pasó
 * a tener la forma del inicio: escribir una hora con el huso del aparato —el
 * panel manda los tiempos en UTC— y el tipo del hueco donde se coloca el vídeo
 * cuando no ocupa la pantalla entera.
 *
 * La hora la usan los dos sitios donde hoy se ve la programación: la ficha del
 * canal en las filas del directo y la barra del reproductor.
 */

/** "20:15", con la hora del aparato: el panel manda los tiempos en UTC. */
export function hora(fecha: Date): string {
  const dosCifras = (valor: number): string => String(valor).padStart(2, '0');
  return `${dosCifras(fecha.getHours())}:${dosCifras(fecha.getMinutes())}`;
}

/** Dónde ha quedado el hueco del vídeo, en coordenadas de pantalla. */
export interface Caja {
  x: number;
  y: number;
  width: number;
  height: number;
}
