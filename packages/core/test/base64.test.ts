/**
 * El base64 de casa, que existe porque Hermes no trae `atob` ni `btoa`.
 *
 * Lo usan el EPG —que recibe los títulos codificados— y "Ver en la tele",
 * que le pasa al lado nativo trozos de fichero: ahí un byte mal puesto
 * corrompe el vídeo, así que la vuelta entera tiene que ser exacta.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { base64DeBytes, bytesDeBase64 } from '../src/base64.ts';

test('ida y vuelta, con las tres longitudes posibles', () => {
  for (const bytes of [[0], [0, 255], [1, 2, 3], [0xae, 0x01, 0x00, 0x00, 0xec, 0x80]]) {
    assert.deepEqual(bytesDeBase64(base64DeBytes(bytes)), bytes, `falla con ${bytes.length} bytes`);
  }
});

test('lo mismo con un trozo largo de bytes cualesquiera', () => {
  const bytes = Array.from({ length: 1000 }, (_, i) => (i * 37) % 256);

  assert.deepEqual(bytesDeBase64(base64DeBytes(bytes)), bytes);
});

test('y el relleno se escribe como manda el formato', () => {
  assert.equal(base64DeBytes([...'hola'].map((letra) => letra.charCodeAt(0))), 'aG9sYQ==');
  assert.equal(base64DeBytes([...'hol'].map((letra) => letra.charCodeAt(0))), 'aG9s');
});

test('una cadena vacía no es base64, es que no hay nada', () => {
  // A propósito, y viene del EPG: ahí "no es base64" y "está vacío" se
  // distinguen, porque el panel manda títulos sin codificar mezclados con
  // los codificados.
  assert.equal(bytesDeBase64(''), null);
  assert.equal(base64DeBytes([]), '');
});
