/**
 * Puente entre la interfaz y el proceso principal.
 *
 * CommonJS a propósito: con `sandbox: true` —que es lo que queremos, porque la
 * interfaz no necesita Node— Electron no carga preloads como módulo ES.
 *
 * Se expone lo mínimo. La interfaz no puede tocar Node ni el sistema de
 * ficheros: solo pedir las acciones de esta lista.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('app', {
  /** Cierra la aplicación liberando la conexión del panel. */
  cerrar: () => ipcRenderer.send('app:cerrar'),
});
