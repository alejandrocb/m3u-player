const path = require('node:path');

const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

/**
 * Metro dentro del monorepo.
 *
 * Por defecto solo mira su propia carpeta, así que hay que decirle dos cosas:
 * que vigile la raíz del repo (ahí viven `packages/core` y `packages/ui`, que
 * la app importa) y dónde están los `node_modules`, que npm iza a la raíz por
 * ser workspaces.
 *
 * `unstable_enablePackageExports` hace falta porque nuestros paquetes se
 * publican por `exports` apuntando a `.ts` directamente: no hay compilación,
 * y Babel se encarga de borrar los tipos.
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const raiz = path.resolve(__dirname, '..', '..');

const config = {
  watchFolders: [raiz],
  resolver: {
    nodeModulesPaths: [path.resolve(__dirname, 'node_modules'), path.resolve(raiz, 'node_modules')],
    unstable_enablePackageExports: true,
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
