const fs = require('node:fs');
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
 * Y `servidor-sync` es un módulo inventado que apunta a un fichero u otro
 * según exista: la dirección del servidor de sincronización es de cada
 * instalación y **no entra en el repositorio**, que es público. Sin
 * `servidor.local.js` se usa el de ejemplo y la app pide la dirección a mano.
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const raiz = path.resolve(__dirname, '..', '..');

const local = path.join(__dirname, 'servidor.local.js');
const servidor = fs.existsSync(local) ? local : path.join(__dirname, 'servidor.ejemplo.js');

const config = {
  watchFolders: [raiz],
  resolver: {
    nodeModulesPaths: [path.resolve(__dirname, 'node_modules'), path.resolve(raiz, 'node_modules')],
    unstable_enablePackageExports: true,
    resolveRequest: (contexto, modulo, plataforma) => {
      if (modulo === 'servidor-sync') return { type: 'sourceFile', filePath: servidor };
      return contexto.resolveRequest(contexto, modulo, plataforma);
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
