/**
 * Emparejar un aparato con la casa.
 *
 * Lo que hay que dejar clavado es lo que se rompió de verdad: **el token se
 * entrega una sola vez**. El servidor lo da, marca el aparato como activo y
 * borra el código; a la siguiente pregunta con el mismo secreto contesta "no
 * te conozco". Así que si el aparato no consigue guardarlo, ese
 * emparejamiento está perdido, y callárselo lleva a pedir otro código, y otro,
 * y otro: en el servidor real se acumularon cuatro códigos sin validar y un
 * montón de validados que no sirvieron para nada.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { ClienteSync, ErrorDeEmparejamiento } from '../src/cliente-sync.ts';
import type { AlmacenSync, EstadoSync, RespuestaHttp } from '../src/cliente-sync.ts';

function clienteCon(almacen: AlmacenSync): ClienteSync {
  return new ClienteSync({
    almacen,
    perfiles: { cambiosDesde: async () => [], aplicarCambios: async () => {} },
    buscar: async (): Promise<RespuestaHttp> => ({
      ok: true,
      status: 200,
      json: async () => ({
        estado: 'aprobado',
        token: 'un-token-largo',
        aparato: { id: 'a1', nombre: 'Tablet' },
        grupo: { id: 'g1', nombre: 'Casa' },
        listas: [],
      }),
    }),
  });
}

test('al aprobarse, el emparejamiento se guarda con lo que hace falta', async () => {
  let guardado: EstadoSync | null = null;
  const cliente = clienteCon({
    leer: async () => guardado,
    guardar: async (estado) => {
      guardado = estado;
    },
    olvidar: async () => {
      guardado = null;
    },
  });

  const resultado = await cliente.comprobar('https://sync.ejemplo.com/', 'secreto-de-espera');

  assert.equal(resultado.estado, 'aprobado');
  assert.equal(guardado!.token, 'un-token-largo');
  // Sin la barra final: si no, se acaba pidiendo a `//api/sync`.
  assert.equal(guardado!.servidor, 'https://sync.ejemplo.com');
  assert.deepEqual(guardado!.grupo, { id: 'g1', nombre: 'Casa' });
  // Recién emparejado: se trae todo lo de la casa y tira lo suyo.
  assert.equal(guardado!.adoptar, true);
  assert.equal(guardado!.subida, '');
  assert.equal(guardado!.bajada, '');
});

/*
  Adoptar la casa vacía lo local, así que hay que volver a pedirlo todo.

  Entre emparejar y adoptar pasa un rato largo —elegir lista e importar el
  catálogo, minuto y medio— y en ese rato la sincronización periódica ya se ha
  traído la casa entera y ha adelantado su marca de bajada. Al vaciar, eso se
  borra; si la marca se quedara donde estaba, la vuelta siguiente pediría "lo
  posterior a esto" y esas filas quedarían detrás para siempre.

  Medido en el teléfono, que acabó pidiendo que te inventaras un perfil:

      [sync] 0 subidos, 200 bajados
      [perfiles] vaciados los locales
      [sync] 0 subidos, 1 bajados
*/
test('al adoptar la casa, la marca de bajada vuelve a cero', async () => {
  let guardado: EstadoSync | null = {
    servidor: 'https://sync.ejemplo.com',
    token: 'un-token',
    grupo: { id: 'g1', nombre: 'Casa' },
    subida: '2026-09-22T09:00:00.000Z',
    // Ya se había traído la casa entera antes de adoptar.
    bajada: '2026-09-22T11:33:56.000Z',
    adoptar: true,
  };
  const cliente = clienteCon({
    leer: async () => guardado,
    guardar: async (estado) => {
      guardado = estado;
    },
    olvidar: async () => {
      guardado = null;
    },
  });

  await cliente.adoptado();

  assert.equal(guardado!.adoptar, false, 'no se vacía dos veces');
  assert.equal(guardado!.bajada, '', 'y se vuelve a pedir todo');
  // Lo que este aparato tenga por subir no se toca: es suyo y no se ha ido.
  assert.equal(guardado!.subida, '2026-09-22T09:00:00.000Z');
});

test('sin nada que adoptar no se toca la marca', async () => {
  let guardado: EstadoSync | null = {
    servidor: 'https://sync.ejemplo.com',
    token: 'un-token',
    grupo: null,
    subida: '',
    bajada: '2026-09-22T11:33:56.000Z',
    adoptar: false,
  };
  const cliente = clienteCon({
    leer: async () => guardado,
    guardar: async (estado) => {
      guardado = estado;
    },
    olvidar: async () => {},
  });

  await cliente.adoptado();

  assert.equal(guardado!.bajada, '2026-09-22T11:33:56.000Z', 'volver a pedirlo todo cuesta');
});

test('si no se puede guardar, se dice: reintentar solo quema otro código', async () => {
  const cliente = clienteCon({
    leer: async () => null,
    // Es lo que pasa cuando el llavero del aparato falla.
    guardar: async () => {
      throw new Error('el llavero no acepta escrituras');
    },
    olvidar: async () => {},
  });

  const fallo = await cliente.comprobar('https://sync.ejemplo.com', 'secreto').catch((error: unknown) => error);

  assert.ok(fallo instanceof ErrorDeEmparejamiento, 'tiene su propio tipo, que no se confunde con un corte de red');
  assert.match(fallo.message, /llavero/);
});
