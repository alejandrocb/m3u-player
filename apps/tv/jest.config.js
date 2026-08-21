module.exports = {
  preset: 'react-native',
  // Jest no transforma `node_modules` por defecto, y varias dependencias se
  // publican en módulos ES: sin esto, el test se cae con "Cannot use import
  // statement outside a module" al cargar op-sqlite.
  // Los módulos nativos se sustituyen por dobles: no existen fuera del aparato.
  moduleNameMapper: {
    '^@op-engineering/op-sqlite$': '<rootDir>/__mocks__/@op-engineering/op-sqlite.js',
    '^react-native-keychain$': '<rootDir>/__mocks__/react-native-keychain.js',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(?:@react-native|react-native|@op-engineering|react-native-video|react-native-keychain|react-native-safe-area-context)/)',
  ],
};
