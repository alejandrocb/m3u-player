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
