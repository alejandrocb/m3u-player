/**
 * Dónde guarda Android el emparejamiento con el servidor.
 *
 * Lleva el token dentro, así que va al llavero del sistema y no a un fichero
 * normal, exactamente igual que las listas: quien se hiciera con él podría
 * leer y escribir el historial de toda la casa.
 *
 * Implementa el puerto `AlmacenSync` de `@m3u/ui`; en el escritorio habrá otro
 * sobre `safeStorage` de Electron.
 */

import * as Keychain from 'react-native-keychain';

import type { AlmacenSync, EstadoSync } from '@m3u/ui';

import { esLlaveroRoto, limpiarLlavero } from './llavero';

const SERVICIO = 'com.m3utv.sincronizacion';
const USUARIO = 'sincronizacion';

export const almacenDeSync: AlmacenSync = {
  async leer(): Promise<EstadoSync | null> {
    try {
      const guardado = await Keychain.getGenericPassword({ service: SERVICIO });
      if (!guardado) return null;
      return JSON.parse(guardado.password) as EstadoSync;
    } catch (error) {
      // Un llavero ilegible no debe impedir abrir la app: se queda sin
      // sincronizar, que es peor que con, pero mucho mejor que no arrancar.
      console.warn('[sync] no se pudo leer el llavero', error);
      return null;
    }
  },

  async guardar(estado: EstadoSync): Promise<void> {
    try {
      await Keychain.setGenericPassword(USUARIO, JSON.stringify(estado), { service: SERVICIO });
    } catch (error) {
      /*
        **El llavero roto se limpia aquí y no en otro sitio**, porque este es
        el único fallo del llavero que le cuesta algo a quien está delante: el
        token del emparejamiento se entrega una sola vez, así que perderlo
        obliga a aprobar otro código en la web. Pasó en la tablet Xiaomi, con
        "Unable to parse preferences proto": el fichero del llavero estaba
        corrupto y no se podía ni leer ni escribir nada.

        Con el fichero ilegible no hay nada que perder, así que se borra. Pero
        **hace falta reabrir la aplicación**: el almacén ya está montado en
        memoria con el error dentro, y hasta el siguiente arranque seguirá
        fallando. Por eso se dice en el mensaje en vez de reintentar aquí.
      */
      if (!esLlaveroRoto(error)) throw error;

      const limpiado = await limpiarLlavero();
      console.warn('[sync] el llavero estaba corrupto; limpiado:', limpiado);
      throw new Error(
        limpiado
          ? 'el llavero de este aparato estaba dañado. Ya está limpio: cierra la aplicación, vuelve a abrirla y empareja otra vez'
          : 'el llavero de este aparato está dañado y no se ha podido limpiar',
      );
    }
  },

  async olvidar(): Promise<void> {
    await Keychain.resetGenericPassword({ service: SERVICIO });
  },
};
