/**
 * Lo que queda de la columna del directo: la hora y el hueco del vídeo.
 *
 * La columna entera —vista previa a un lado, programación al otro— se fue
 * cuando TV en directo pasó a tener la forma del inicio, con una fila por
 * grupo de canales. Lo que sigue en pie es lo que usa el reproductor: escribir
 * una hora con el huso del aparato, y el tipo del hueco donde se coloca el
 * vídeo cuando no ocupa la pantalla entera.
 *
 * Queda pendiente devolver la programación al directo: ahora mismo, lo que
 * echan solo se ve dentro del reproductor.
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
