/**
 * Doble de op-sqlite para los tests.
 *
 * El de verdad es código nativo y no existe fuera del aparato: sin esto, el
 * test se cae con "Base module not found" nada más importar la app.
 */
const base = { rows: [], insertId: 1, rowsAffected: 0 };

module.exports = {
  open: () => ({
    executeSync: () => base,
    execute: async () => base,
    close: () => {},
  }),
};
