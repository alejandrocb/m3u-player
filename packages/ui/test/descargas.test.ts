/**
 * La cola de descargas, con un transporte de mentira.
 *
 * Lo que hay que dejar clavado es lo que se pierde si se rompe: que **se
 * reanuda por donde iba** —lo que la hace la única cosa que se puede expulsar
 * sin coste—, que **el árbitro manda**, y que cerrar la aplicación con algo a
 * medias no deja una descarga "bajando" que nadie está bajando.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { Arbitro, ENFRIAMIENTO_MS } from '../src/arbitro.ts';
import { ColaDeDescargas, claveDeDescarga, ficheroDe } from '../src/descargas.ts';
import type { AlmacenDescargas, Descarga, Transferencia } from '../src/descargas.ts';

/** Un transporte que no toca ficheros: guarda las órdenes para dispararlas a mano. */
function transporteFalso() {
  const ordenes: Array<Parameters<Transferencia['empezar']>[0]> = [];
  const cancelaciones: string[] = [];

  const transferencia: Transferencia = {
    empezar(orden) {
      ordenes.push(orden);
      return () => cancelaciones.push(orden.descarga.id);
    },
  };

  return { transferencia, ordenes, cancelaciones, ultima: () => ordenes[ordenes.length - 1]! };
}

function almacenFalso(inicial: Descarga[] = []) {
  const filas = new Map(inicial.map((descarga) => [descarga.id, descarga]));
  const almacen: AlmacenDescargas = {
    async leer() {
      return [...filas.values()].map((descarga) => ({ ...descarga }));
    },
    async guardar(descarga) {
      filas.set(descarga.id, { ...descarga });
    },
    async borrar(id) {
      filas.delete(id);
    },
  };
  return { almacen, filas };
}

function pelicula(id: string, titulo = 'Una película') {
  return {
    id: claveDeDescarga('pelicula', id),
    clase: 'pelicula' as const,
    itemId: id,
    titulo,
    serieId: null,
    url: `http://panel/movie/u/p/${id}.mkv`,
    fichero: ficheroDe(claveDeDescarga('pelicula', id), 'mkv'),
  };
}

function montar(inicial: Descarga[] = []) {
  const transporte = transporteFalso();
  const { almacen, filas } = almacenFalso(inicial);
  const arbitro = new Arbitro(1);
  let reloj = 1_000;
  const cola = new ColaDeDescargas({
    arbitro,
    transferencia: transporte.transferencia,
    almacen,
    ahora: () => reloj,
  });

  /*
    Soltar una ranura la deja enfriando treinta segundos —lo que tarda el
    panel en darla por libre—, así que encadenar dos descargas exige pasar ese
    rato. En la vida real ni se nota: una película tarda minutos.
  */
  const pasarElEnfriamiento = async (): Promise<void> => {
    reloj += ENFRIAMIENTO_MS + 1;
    await cola.reintentar();
  };

  return { cola, arbitro, transporte, filas, pasarElEnfriamiento };
}

test('lo añadido arranca solo y se apunta en la base', async () => {
  const { cola, transporte, filas } = montar();
  await cola.anadir(pelicula('el-aviso-2018'));

  assert.equal(cola.de('pelicula:el-aviso-2018')?.estado, 'bajando');
  assert.equal(transporte.ordenes.length, 1);
  assert.equal(transporte.ultima().desde, 0, 'empieza por el principio');
  assert.ok(filas.has('pelicula:el-aviso-2018'), 'queda guardada para el próximo arranque');
});

test('una cada vez: la segunda espera a que acabe la primera', async () => {
  const { cola, transporte, pasarElEnfriamiento } = montar();
  await cola.anadir(pelicula('una'));
  await cola.anadir(pelicula('otra'));

  assert.equal(transporte.ordenes.length, 1);
  assert.equal(cola.de('pelicula:otra')?.estado, 'en cola');

  transporte.ultima().alTerminar();
  await new Promise((sigue) => setTimeout(sigue, 0));
  assert.equal(cola.de('pelicula:una')?.estado, 'hecha');

  await pasarElEnfriamiento();
  assert.equal(transporte.ordenes.length, 2, 'la siguiente arranca sola');
  assert.equal(cola.de('pelicula:otra')?.estado, 'bajando');
});

test('se reanuda por el byte donde iba, no desde el principio', async () => {
  /*
    Es lo que permite que la descarga sea la primera a la que se echa cuando
    hace falta la conexión: no se pierde nada. Los ficheros del panel aceptan
    `Range`, así que se pide desde donde estaba.
  */
  const { cola, transporte, pasarElEnfriamiento } = montar();
  await cola.anadir(pelicula('a-medias'));

  transporte.ultima().alAvanzar(400_000_000, 1_200_000_000);
  await cola.pausar('pelicula:a-medias');
  assert.deepEqual(transporte.cancelaciones, ['pelicula:a-medias']);

  await cola.anadir(pelicula('a-medias'));
  await pasarElEnfriamiento();
  assert.equal(transporte.ultima().desde, 400_000_000);
  assert.equal(cola.de('pelicula:a-medias')?.total, 1_200_000_000, 'el tamaño no se olvida');
});

test('la conexión la reparte el árbitro: sin ranura no arranca', async () => {
  const { cola, arbitro, transporte } = montar();

  // La única ranura, ocupada por lo que se está viendo.
  arbitro.pedir('reproductor', 'reproducir', 1_000);

  await cola.anadir(pelicula('espera'));
  assert.equal(transporte.ordenes.length, 0, 'no se cuela delante de la película');
  assert.equal(cola.de('pelicula:espera')?.estado, 'en cola');

  // Al cerrar el reproductor y avisar, la descarga entra... cuando enfríe.
  arbitro.soltar('reproductor', 1_000);
  await cola.reintentar();
  assert.equal(transporte.ordenes.length, 0, 'la ranura recién soltada aún enfría');

  await cola.reintentar();
  assert.equal(transporte.ordenes.length, 0);
});

test('expulsada por el árbitro no es fallida: vuelve a la cola', async () => {
  const { cola, transporte } = montar();
  await cola.anadir(pelicula('la-que-cede'));
  transporte.ultima().alAvanzar(100, null);

  cola.expulsar('pelicula:la-que-cede');

  assert.equal(cola.de('pelicula:la-que-cede')?.estado, 'en cola');
  assert.equal(cola.de('pelicula:la-que-cede')?.error, null, 'ceder la ranura no es un error');
  assert.deepEqual(transporte.cancelaciones, ['pelicula:la-que-cede']);
});

test('al arrancar, lo que se quedó bajando vuelve a la cola', async () => {
  /*
    Al cerrar la aplicación no queda nada bajando, pero en la base sí quedó
    escrito "bajando". Sin esto, esa descarga se quedaría para siempre en un
    estado que no se corresponde con nada y no arrancaría jamás.
  */
  const aMedias: Descarga = {
    ...pelicula('la-de-anoche'),
    estado: 'bajando',
    bytes: 900,
    total: 5_000,
    creada: '2026-09-05T20:00:00.000Z',
    error: null,
  };

  const { cola, transporte } = montar([aMedias]);
  await cola.cargar();

  assert.equal(cola.de('pelicula:la-de-anoche')?.estado, 'bajando', 'ha arrancado de nuevo');
  assert.equal(transporte.ultima().desde, 900, 'y sigue por donde iba');
});

test('lo hecho no se vuelve a bajar al pedirlo otra vez', async () => {
  const { cola, transporte } = montar();
  await cola.anadir(pelicula('ya-esta'));
  transporte.ultima().alTerminar();
  await new Promise((sigue) => setTimeout(sigue, 0));

  await cola.anadir(pelicula('ya-esta'));
  assert.equal(transporte.ordenes.length, 1, 'no se pide otra vez');
  assert.equal(cola.de('pelicula:ya-esta')?.estado, 'hecha');
});

test('lo fallido se reintenta al volver a pedirlo', async () => {
  const { cola, transporte, pasarElEnfriamiento } = montar();
  await cola.anadir(pelicula('la-que-falla'));
  transporte.ultima().alFallar('se cortó la red');
  await new Promise((sigue) => setTimeout(sigue, 0));

  assert.equal(cola.de('pelicula:la-que-falla')?.estado, 'fallida');
  assert.equal(cola.de('pelicula:la-que-falla')?.error, 'se cortó la red');

  await cola.anadir(pelicula('la-que-falla'));
  await pasarElEnfriamiento();
  assert.equal(transporte.ordenes.length, 2);
  assert.equal(cola.de('pelicula:la-que-falla')?.error, null);
});

test('quitar una borra su fila y deja paso a la siguiente', async () => {
  const { cola, transporte, filas, pasarElEnfriamiento } = montar();
  await cola.anadir(pelicula('fuera'));
  await cola.anadir(pelicula('detras'));

  await cola.quitar('pelicula:fuera');
  await pasarElEnfriamiento();

  assert.equal(cola.de('pelicula:fuera'), undefined);
  assert.ok(!filas.has('pelicula:fuera'));
  assert.equal(cola.de('pelicula:detras')?.estado, 'bajando');
  assert.deepEqual(transporte.cancelaciones, ['pelicula:fuera']);
});

test('el nombre del fichero no lleva la extensión de la URL', () => {
  // La extensión de la URL miente: hay `.mkv` que por dentro son MP4. La pone
  // quien haya mirado los primeros bytes.
  assert.equal(ficheroDe('pelicula:el-aviso-2018', 'mp4'), 'pelicula-el-aviso-2018.mp4');
  assert.equal(ficheroDe('episodio:doctor-who-2005:s1e7', '.mkv'), 'episodio-doctor-who-2005-s1e7.mkv');
});
