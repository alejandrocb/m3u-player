/** Doble del llavero de Android: en los tests no hay Keystore. */
module.exports = {
  getGenericPassword: async () => false,
  setGenericPassword: async () => true,
  resetGenericPassword: async () => true,
};
