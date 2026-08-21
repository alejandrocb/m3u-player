/**
 * Dónde guarda Android las listas dadas de alta.
 *
 * Las URLs llevan el usuario y la contraseña del panel dentro, así que no van
 * a un fichero normal: se guardan con el llavero del sistema, que en Android
 * cifra contra el Keystore del aparato.
 *
 * Implementa el puerto `AlmacenCuentas` de `@m3u/ui`; en el escritorio habrá
 * otro sobre `safeStorage` de Electron, y la interfaz no notará la diferencia.
 */

import * as Keychain from 'react-native-keychain';

import type { AlmacenCuentas, EstadoCuentas } from '@m3u/ui';

/** Una sola entrada con todo el estado: las listas y cuál está conectada. */
const SERVICIO = 'com.m3utv.listas';
const USUARIO = 'listas';

export const almacenDeCuentas: AlmacenCuentas = {
  async leer(): Promise<EstadoCuentas | null> {
    try {
      const guardado = await Keychain.getGenericPassword({ service: SERVICIO });
      if (!guardado) return null;
      return JSON.parse(guardado.password) as EstadoCuentas;
    } catch (error) {
      // Un llavero ilegible no debe impedir abrir la app: se empieza de cero,
      // que es preferible a una pantalla en blanco.
      console.warn('[almacen] no se pudo leer el llavero', error);
      return null;
    }
  },

  async guardar(estado: EstadoCuentas): Promise<void> {
    await Keychain.setGenericPassword(USUARIO, JSON.stringify(estado), { service: SERVICIO });
  },
};
