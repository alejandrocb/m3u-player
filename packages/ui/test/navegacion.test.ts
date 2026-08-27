import assert from 'node:assert/strict';
import test from 'node:test';

import { Navegador } from '../src/navegacion.ts';

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
  nav.entrar({ tipo: 'peliculas' });
  nav.entrar({ tipo: 'series' });
  nav.entrar({ tipo: 'serie', serieId: 'doctor-who', titulo: 'Doctor Who' });

  assert.equal(nav.profundidad, 4);
  assert.equal(nav.atras(), 'retrocedido');
  assert.deepEqual(nav.actual, { tipo: 'series' });
  assert.equal(nav.atras(), 'retrocedido');
  assert.deepEqual(nav.actual, { tipo: 'peliculas' });
  assert.equal(nav.atras(), 'retrocedido');
  assert.deepEqual(nav.actual, { tipo: 'inicio' });
  assert.equal(nav.atras(), 'salir');
});

test('el foco de cada pantalla se recuerda al volver', () => {
  const nav = new Navegador();
  // El usuario baja hasta la película 137 de la rejilla y entra en la ficha.
  nav.entrar({ tipo: 'peliculas' });
  nav.recordarFoco(137);
  nav.entrar({ tipo: 'serie', serieId: 'x', titulo: 'X' }, 137);

  nav.atras();
  // Al volver, el cursor sigue en la 137 y no al principio de 18.000 fichas.
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

test('cada categoría recuerda su propio foco', () => {
  const nav = new Navegador();
  nav.entrar({ tipo: 'peliculas' });
  nav.recordarFoco(3);
  nav.reemplazar({ tipo: 'peliculas', grupo: 'Estrenos' });
  assert.equal(nav.focoGuardado(), 0, 'cada una recuerda el suyo');
});

test('volver al inicio deja la pila en su fondo', () => {
  const nav = new Navegador();
  nav.entrar({ tipo: 'directo' });
  nav.entrar({ tipo: 'peliculas', grupo: 'Estrenos' });
  nav.aInicio();
  assert.equal(nav.profundidad, 1);
  assert.equal(nav.atras(), 'salir');
});

test('la ruta se puede leer entera para pintar migas', () => {
  const nav = new Navegador();
  nav.entrar({ tipo: 'directo' });
  nav.entrar({ tipo: 'peliculas', grupo: 'Estrenos' });
  assert.deepEqual(
    nav.ruta.map((pantalla) => pantalla.tipo),
    ['inicio', 'directo', 'peliculas'],
  );
});
