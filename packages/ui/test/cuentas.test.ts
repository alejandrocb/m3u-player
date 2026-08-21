import assert from 'node:assert/strict';
import test from 'node:test';

import { GestorCuentas, esXtream, hostDe } from '../src/cuentas.ts';
import type { AlmacenCuentas, EstadoCuentas } from '../src/cuentas.ts';

/** Almacén de mentira, con un contador para comprobar que se persiste. */
function almacen(inicial: EstadoCuentas | null = null) {
  let guardado = inicial;
  let escrituras = 0;
  const espia: AlmacenCuentas & { escrituras: () => number; contenido: () => EstadoCuentas | null } = {
    async leer() {
      return guardado;
    },
    async guardar(estado) {
      guardado = estado;
      escrituras++;
    },
    escrituras: () => escrituras,
    contenido: () => guardado,
  };
  return espia;
}

// Reloj de mentira: los tests no deben depender de la hora del equipo.
function reloj() {
  let n = 0;
  return () => `2026-08-20T00:00:${String(n++).padStart(2, '0')}.000Z`;
}

const URL_M3U = 'http://servidor:8080/get.php?username=u&password=p&type=m3u_plus';

test('sin nada guardado, arranca vacío y sin sesión', async () => {
  const gestor = await GestorCuentas.abrir(almacen(), { ahora: reloj() });
  assert.deepEqual(gestor.cuentas, []);
  assert.equal(gestor.activa, null);
});

test('dar de alta una lista la deja guardada y sin conectar', async () => {
  const espia = almacen();
  const gestor = await GestorCuentas.abrir(espia, { ahora: reloj() });

  const cuenta = await gestor.anadir({ nombre: 'Casa', url: URL_M3U });
  assert.equal(cuenta.nombre, 'Casa');
  assert.equal(cuenta.tipo, 'xtream', 'una URL con usuario y contraseña es un panel');
  assert.equal(cuenta.ultimoUso, null);
  assert.equal(gestor.activa, null, 'dar de alta no conecta');
  assert.equal(espia.escrituras(), 1);
});

test('la sesión sobrevive al arranque siguiente', async () => {
  const espia = almacen();
  const primero = await GestorCuentas.abrir(espia, { ahora: reloj() });
  const cuenta = await primero.anadir({ nombre: 'Casa', url: URL_M3U });
  await primero.conectar(cuenta.id);

  // Se cierra la app y se vuelve a abrir: debe entrar directo a esa lista.
  const segundo = await GestorCuentas.abrir(espia, { ahora: reloj() });
  assert.equal(segundo.activa?.id, cuenta.id);
});

test('cerrar sesión deja las listas pero sin ninguna conectada', async () => {
  const espia = almacen();
  const gestor = await GestorCuentas.abrir(espia, { ahora: reloj() });
  const cuenta = await gestor.anadir({ nombre: 'Casa', url: URL_M3U });
  await gestor.conectar(cuenta.id);
  await gestor.cerrarSesion();

  assert.equal(gestor.activa, null);
  assert.equal(gestor.cuentas.length, 1, 'la lista sigue dada de alta');
});

test('las listas se ordenan por uso reciente', async () => {
  const gestor = await GestorCuentas.abrir(almacen(), { ahora: reloj() });
  const casa = await gestor.anadir({ nombre: 'Casa', url: URL_M3U });
  const otra = await gestor.anadir({ nombre: 'Otra', url: 'http://otro:8080/lista.m3u' });

  await gestor.conectar(casa.id);
  await gestor.conectar(otra.id);

  assert.deepEqual(
    gestor.cuentas.map((cuenta) => cuenta.nombre),
    ['Otra', 'Casa'],
  );
});

test('dos listas con el mismo nombre no chocan', async () => {
  const gestor = await GestorCuentas.abrir(almacen(), { ahora: reloj() });
  const una = await gestor.anadir({ nombre: 'Casa', url: URL_M3U });
  const otra = await gestor.anadir({ nombre: 'Casa', url: 'http://otro:8080/lista.m3u' });
  assert.notEqual(una.id, otra.id);
});

test('borrar la lista conectada cierra la sesión', async () => {
  const gestor = await GestorCuentas.abrir(almacen(), { ahora: reloj() });
  const cuenta = await gestor.anadir({ nombre: 'Casa', url: URL_M3U });
  await gestor.conectar(cuenta.id);
  await gestor.borrar(cuenta.id);

  assert.equal(gestor.activa, null, 'no puede quedar apuntando a algo que ya no existe');
  assert.deepEqual(gestor.cuentas, []);
});

test('editar cambia el nombre sin tocar la URL', async () => {
  const gestor = await GestorCuentas.abrir(almacen(), { ahora: reloj() });
  const cuenta = await gestor.anadir({ nombre: 'Casa', url: URL_M3U });

  const editada = await gestor.editar(cuenta.id, { nombre: 'Salón' });
  assert.equal(editada.nombre, 'Salón');
  assert.equal(editada.url, URL_M3U);
});

test('sin nombre, se usa el servidor', async () => {
  const gestor = await GestorCuentas.abrir(almacen(), { ahora: reloj() });
  const cuenta = await gestor.anadir({ nombre: '  ', url: URL_M3U });
  assert.equal(cuenta.nombre, 'servidor:8080');
});

test('una URL vacía se rechaza', async () => {
  const gestor = await GestorCuentas.abrir(almacen(), { ahora: reloj() });
  await assert.rejects(() => gestor.anadir({ nombre: 'Casa', url: '   ' }), /no puede estar vacía/);
});

test('un almacén corrupto no impide arrancar', async () => {
  // Si el fichero guardado se estropea, es preferible empezar de cero a que la
  // app no abra.
  const roto = almacen({ cuentas: null as never, activaId: 'x' });
  const gestor = await GestorCuentas.abrir(roto, { ahora: reloj() });
  assert.deepEqual(gestor.cuentas, []);
  assert.equal(gestor.activa, null);
});

test('del servidor solo se enseña el host, nunca las credenciales', () => {
  assert.equal(hostDe(URL_M3U), 'servidor:8080');
  assert.equal(hostDe('https://panel.example.com/get.php?username=u&password=p'), 'panel.example.com');
});

test('se distingue un panel Xtream de un M3U suelto', () => {
  assert.equal(esXtream(URL_M3U), true);
  assert.equal(esXtream('http://servidor/lista.m3u'), false);
});
