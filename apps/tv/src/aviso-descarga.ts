/**
 * El aviso de la barra, que es lo que deja bajar con la aplicación cerrada.
 *
 * Android mata el proceso de una aplicación que no se ve, y una película de
 * dos gigas no cabe en los segundos que uno la tiene delante: en cuanto se
 * apaga la pantalla, la descarga se corta. La única forma que da el sistema de
 * decir "esto sigue" es un **servicio en primer plano**, y su precio es un
 * aviso permanente en la barra.
 *
 * Así que el aviso no es un extra: es el permiso. Y ya que está puesto, lleva
 * el título de lo que se baja y por dónde va, que es lo que uno mira si le da
 * por mirar.
 *
 * Aquí no se decide nada: la cola dice qué hay y esto lo traduce a una línea.
 * Lo nativo está en `ServicioDeDescargas.kt`.
 */

import { NativeModules, PermissionsAndroid, Platform } from 'react-native';

import type { Descarga } from '@m3u/ui';

interface Nativo {
  avisar(titulo: string, detalle: string, avance: number): void;
  callar(): void;
}

/*
  Puede no estar: en una compilación anterior a que esto existiera, o el día
  que esto corra en otro sitio. Sin él todo funciona igual, solo que la
  descarga se para al irse la aplicación al fondo.
*/
const nativo = (NativeModules as { Descargas?: Nativo }).Descargas;

/** Lo último que se mandó, para no repintar el aviso treinta veces por segundo. */
let ultimo = '';

/**
 * Cómo se cierra la tarea sin interfaz, que es la que mantiene vivo el reloj.
 *
 * React Native **para los temporizadores** cuando la aplicación deja de estar
 * delante, y la cola los usa para lo que de verdad pasa en una tablet con
 * wifi flojo: reintentar tras un corte y volver a pedir la ranura cuando el
 * árbitro la ha denegado. Con una tarea abierta el reloj sigue andando.
 */
let cerrarTarea: (() => void) | null = null;

/** Si queda algo por bajar. Lo mira la tarea al arrancar, por si llega tarde. */
let hayFaena = false;

/** El permiso se pide una vez y no se espera: la descarga no depende de él. */
let permisoPedido = false;

/**
 * Desde Android 13 hay que pedir permiso para que un aviso se vea.
 *
 * Si se deniega, **el servicio funciona igual** y la descarga sigue: lo único
 * que pasa es que no se ve por dónde va. Por eso no se espera la respuesta ni
 * se mira: pedirlo y seguir.
 */
function pedirPermiso(): void {
  if (permisoPedido) return;
  permisoPedido = true;
  if (Platform.OS !== 'android' || Number(Platform.Version) < 33) return;
  void PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS).catch(() => undefined);
}

/** Lo que queda por hacer: lo que baja, lo que espera turno y lo pausado no. */
function pendientes(descargas: Descarga[]): Descarga[] {
  return descargas.filter((una) => una.estado === 'bajando' || una.estado === 'en cola');
}

/**
 * Enciende, cambia o apaga el aviso según lo que haya en la cola.
 *
 * Se llama con cada cambio de la cola, que son varios por segundo, así que lo
 * primero que hace es callarse si la línea no ha cambiado: reemplazar el aviso
 * cuesta un salto al lado nativo y hace parpadear la barra.
 */
export function avisarDeLasDescargas(descargas: Descarga[]): void {
  if (!nativo) return;

  const queda = pendientes(descargas);
  hayFaena = queda.length > 0;

  if (queda.length === 0) {
    if (ultimo !== '') {
      ultimo = '';
      // Cerrar la tarea es lo que para el servicio y quita el aviso; lo otro
      // es el cinturón, por si la tarea nunca llegó a arrancar.
      console.log('[descarga] no queda nada: se quita el aviso');
      cerrarTarea?.();
      cerrarTarea = null;
      nativo.callar();
    }
    return;
  }

  const bajando = queda.find((una) => una.estado === 'bajando');
  const otras = queda.length - 1;
  const cola = otras > 0 ? ` · y ${otras} más` : '';

  const titulo = bajando ? bajando.titulo : queda[0]!.titulo;
  // Sin tamaño no hay porcentaje: el panel no siempre manda `Content-Length`,
  // y un número inventado en la barra es el que luego nadie se cree. La barra
  // se queda en indefinida, que es exactamente lo que se sabe.
  const avance = bajando?.total ? Math.round((bajando.bytes / bajando.total) * 100) : -1;
  const detalle = bajando
    ? `${avance < 0 ? 'Bajando' : `${avance} %`}${cola}`
    : `Esperando una ranura libre${cola}`;

  const linea = `${titulo}|${detalle}|${avance}`;
  if (linea === ultimo) return;
  // Solo al encender: el texto cambia con cada porcentaje y eso llenaría el
  // registro de líneas iguales justo cuando hace falta leerlo.
  if (ultimo === '') console.log(`[descarga] aviso puesto: ${titulo}`);
  ultimo = linea;

  pedirPermiso();
  nativo.avisar(titulo, detalle, avance);
}

/**
 * La tarea sin interfaz, registrada en `index.js`.
 *
 * No hace nada: **existir es su trabajo**. Mientras su promesa no se cumpla,
 * React Native mantiene andando el reloj de los temporizadores y el sistema
 * mantiene el aparato despierto. Se cumple cuando la cola se queda vacía, y
 * entonces el servicio se para solo y el aviso desaparece.
 */
export function tareaDeDescargas(): Promise<void> {
  // Puede llegar tarde: entre pedir el servicio y que arranque la tarea, la
  // cola ha podido vaciarse. Entonces no hay nada que mantener vivo.
  if (!hayFaena) {
    console.log('[descarga] la tarea llegó tarde: ya no queda nada');
    return Promise.resolve();
  }
  console.log('[descarga] tarea en marcha: el reloj sigue andando');
  return new Promise<void>((listo) => {
    cerrarTarea = listo;
  });
}
