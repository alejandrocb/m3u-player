/**
 * El módulo que Metro resuelve a `servidor.local.js` o a `servidor.ejemplo.js`
 * según cuál exista. Ver `metro.config.js`.
 */
declare module 'servidor-sync' {
  /** Dirección del servidor, o cadena vacía para pedirla al emparejar. */
  export const SERVIDOR: string;
}
