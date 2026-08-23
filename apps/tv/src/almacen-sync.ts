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
    await Keychain.setGenericPassword(USUARIO, JSON.stringify(estado), { service: SERVICIO });
  },

  async olvidar(): Promise<void> {
    await Keychain.resetGenericPassword({ service: SERVICIO });
  },
};
