/**
 * El servidor, montado pero sin arrancar.
 *
 * Va aparte de `index.ts` para que los tests puedan levantarlo en un puerto
 * cualquiera y hablarle con peticiones de verdad. Probar el emparejamiento
 * llamando a las funciones por dentro dejaría sin comprobar justo lo que más
 * se rompe: las rutas, los códigos de estado y quién puede llamar a qué.
 */

import { createServer } from 'node:http';
import type { Server } from 'node:http';

import { manejarAdmin } from './admin.ts';
import { manejarApi } from './api.ts';
import { json } from './http.ts';
import type { Panel } from './panel.ts';

export function crearServidor(panel: Panel, codigoInicial: () => string | null): Server {
  return createServer((req, res) => {
    // Solo la ruta: por la dirección no viaja ningún dato de nadie, así que
    // lo que venga detrás de la interrogación sobra.
    const ruta = new URL(req.url ?? '/', 'http://interno').pathname;

    void (async () => {
      try {
        if (await manejarApi(panel, req, res, ruta)) return;
        if (await manejarAdmin(panel, req, res, ruta, codigoInicial)) return;

        json(res, 404, { error: 'no existe' });
      } catch (fallo) {
        // Al registro va el fallo entero; al cliente, nada. Un mensaje
        // detallado es un mapa del servidor para quien esté buscando.
        console.error('[sync] fallo atendiendo', ruta, fallo);
        if (!res.headersSent) json(res, 500, { error: 'fallo del servidor' });
        else res.end();
      }
    })();
  });
}
