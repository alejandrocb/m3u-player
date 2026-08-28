import assert from 'node:assert/strict';
import test from 'node:test';

import { Navegador } from '../src/navegacion.ts';

/*
  Las pantallas que hay son tres: el inicio —que se filtra con las pestañas y
  no se apila—, una serie y el buscador. Las rejillas de películas, series y
  directo se fueron cuando el inicio pasó a ser filas: eran el mismo contenido
  con otra cara.
*/
const DOCTOR_WHO = { tipo: 'serie', serieId: 'doctor-who', titulo: 'Doctor Who' } as const;

test('arranca en el inicio', () => {
  const nav = new Navegador();
  assert.deepEqual(nav.actual, { tipo: 'inicio' });
  assert.equal(nav.profundidad, 1);
});

test('atrás en la raíz pide salir, y no vacía la pila', () => {
  const nav = new Navegador();
  assert.equal(nav.atras(), 'salir');
  assert.equal(nav.profundidad, 1);
  assert.deepEqual(nav.actual, { tipo: 'inicio' });
});

test('se entra y se vuelve por donde se vino', () => {
  const nav = new Navegador();
  nav.entrar({ tipo: 'buscador', texto: '' });
  nav.entrar(DOCTOR_WHO);

  assert.equal(nav.profundidad, 3);
  assert.equal(nav.atras(), 'retrocedido');
  assert.deepEqual(nav.actual, { tipo: 'buscador', texto: '' });
  assert.equal(nav.atras(), 'retrocedido');
  assert.deepEqual(nav.actual, { tipo: 'inicio' });
  assert.equal(nav.atras(), 'salir');
});

test('el foco de cada pantalla se recuerda al volver', () => {
  const nav = new Navegador();
  // Se baja hasta el resultado 137 del buscador y se entra en una serie.
  nav.entrar({ tipo: 'buscador', texto: 'who' });
  nav.recordarFoco(137);
  nav.entrar(DOCTOR_WHO, 137);

  nav.atras();
  // Al volver, el cursor sigue en la 137 y no al principio.
  assert.equal(nav.focoGuardado(), 137);
});

test('dos temporadas de la misma serie recuerdan focos distintos', () => {
  const nav = new Navegador();
  nav.entrar({ tipo: 'serie', serieId: 's', titulo: 'S', temporada: 1 });
  nav.recordarFoco(5);
  // Cambiar de temporada reemplaza la pantalla, no apila otra.
  nav.reemplazar({ tipo: 'serie', serieId: 's', titulo: 'S', temporada: 2 });
  assert.equal(nav.focoGuardado(), 0);

  nav.reemplazar({ tipo: 'serie', serieId: 's', titulo: 'S', temporada: 1 });
  assert.equal(nav.focoGuardado(), 5);
});

test('volver al inicio deja la pila en su fondo', () => {
  const nav = new Navegador();
  nav.entrar({ tipo: 'buscador', texto: '' });
  nav.entrar(DOCTOR_WHO);
  nav.aInicio();
  assert.equal(nav.profundidad, 1);
  assert.equal(nav.atras(), 'salir');
});

test('la ruta se puede leer entera para pintar migas', () => {
  const nav = new Navegador();
  nav.entrar({ tipo: 'buscador', texto: '' });
  nav.entrar(DOCTOR_WHO);
  assert.deepEqual(
    nav.ruta.map((pantalla) => pantalla.tipo),
    ['inicio', 'buscador', 'serie'],
  );
});
