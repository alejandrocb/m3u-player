/**
 * Arranque del servidor de sincronización.
 *
 * Un solo proceso que atiende dos cosas: las peticiones de los aparatos, bajo
 * `/api/`, y la web de administración en todo lo demás.
 *
 * **Sin ninguna dependencia.** HTTP con `node:http`, base con `node:sqlite`,
 * contraseñas con `node:crypto`, y el TypeScript se ejecuta directamente igual
 * que en el resto del proyecto. La imagen es Node y estos ficheros.
 *
 * Detrás de Caddy, que es quien da la cara a internet y quien pone el TLS.
 * Exponer esto directamente sería servir en claro los tokens y las URLs del
 * panel, que llevan usuario y contraseña dentro.
 */

import { codigoCorto } from './claves.ts';
import { Panel } from './panel.ts';
import { crearServidor } from './servidor.ts';
import { vigilarPortadas } from './tareas.ts';

const PUERTO = Number(process.env.PUERTO ?? 3300);
const ESCUCHA = process.env.ESCUCHA ?? '0.0.0.0';
const DATOS = process.env.DATOS ?? '/datos';

const panel = new Panel(DATOS);

/**
 * El código con el que se crea la primera cuenta.
 *
 * Vive en memoria y se escribe en el registro del contenedor, así que solo lo
 * ve quien puede leer los registros: tú. Una web de instalación abierta a
 * quien llegue primero es la forma clásica de perder un servidor recién
 * levantado. Al reiniciar cambia, y en cuanto hay cuenta deja de valer.
 */
let codigoInicial: string | null = null;
if (!panel.hayAdmin()) {
  codigoInicial = codigoCorto();
  console.log('');
  console.log('  ================================================');
  console.log('   No hay ninguna cuenta de administración.');
  console.log(`   Código de instalación:  ${codigoInicial}`);
  console.log('   Ábrelo en la web y crea tu usuario.');
  console.log('  ================================================');
  console.log('');
}

const servidor = crearServidor(panel, () => codigoInicial);

// El trabajo diario: preparar las portadas del inicio de cada lista.
const pararPortadas = vigilarPortadas(panel);

servidor.listen(PUERTO, ESCUCHA, () => {
  console.log(`[sync] escuchando en ${ESCUCHA}:${PUERTO}, datos en ${DATOS}`);
});

for (const senal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(senal, () => {
    console.log(`[sync] ${senal}, cerrando`);
    pararPortadas();
    servidor.close(() => {
      panel.cerrar();
      process.exit(0);
    });
  });
}
