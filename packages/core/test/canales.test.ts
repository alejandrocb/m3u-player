/**
 * El identificador de un canal, que tiene que ser el mismo por los dos
 * caminos y casar con lo que dice el EPG.
 *
 * Esto nace de un fallo real: la parrilla llegaba entera del servidor y no se
 * pintaba en ninguna ficha. El EPG habla de `tvg-id` pelados —`24h`— y la
 * biblioteca guarda ese canal como `tvg:24h`, así que no casaba ni uno. Sin
 * esta comprobación el fallo es invisible: no hay error, simplemente no sale
 * la programación.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  claveDeParrilla,
  claveDeParrillaDeId,
  idDeCanalPorNombre,
  idDeCanalPorTvg,
} from '../src/canales.ts';
import { buildLibrary, parseM3U } from '../src/m3u/index.ts';

const M3U = `#EXTM3U
#EXTINF:-1 tvg-id="24h" group-title="NOTICIAS",24 Horas FHD
http://panel/live/u/p/101.ts
#EXTINF:-1 tvg-id="" group-title="DEPORTES",Deportes 1
http://panel/live/u/p/201.ts
`;

test('el canal con tvg-id se guarda con el prefijo, no pelado', () => {
  const library = buildLibrary(parseM3U(M3U).entries);
  const canal = library.channels.find((uno) => uno.tvgId === '24h')!;

  assert.equal(canal.id, idDeCanalPorTvg('24h'));
  // Y **no** el tvg-id a secas, que es justo lo que manda el EPG del panel:
  // quien case programas con canales tiene que traducir.
  assert.notEqual(canal.id, '24h');
});

test('el canal sin tvg-id se identifica por nombre y grupo', () => {
  const library = buildLibrary(parseM3U(M3U).entries);
  const canal = library.channels.find((uno) => uno.tvgId === null)!;

  assert.equal(canal.id, idDeCanalPorNombre('Deportes 1', 'DEPORTES'));
});

test('el grupo entra en la identidad del que no trae tvg-id', () => {
  // Dos "Deportes 1" en secciones distintas son dos canales, no uno.
  assert.notEqual(idDeCanalPorNombre('Deportes 1', 'FUTBOL'), idDeCanalPorNombre('Deportes 1', 'MOTOR'));
});

test('la clave laxa junta las calidades de la misma cadena', () => {
  // El EPG del panel trae una sola "Telecinco HD" y el catálogo tres.
  assert.equal(claveDeParrilla('Telecinco FHD'), claveDeParrilla('Telecinco HD'));
  assert.equal(claveDeParrilla('Telecinco SD'), claveDeParrilla('Telecinco HD'));
  assert.equal(claveDeParrilla('Telecinco 1080p'), claveDeParrilla('Telecinco'));
});

test('y también las mayúsculas, que el proveedor mezcla', () => {
  assert.equal(claveDeParrilla('BE MAD'), claveDeParrilla('Be Mad'));
});

test('pero no junta dos cadenas distintas', () => {
  assert.notEqual(claveDeParrilla('Telecinco'), claveDeParrilla('Cuatro'));
  assert.notEqual(claveDeParrilla('AMC Crime'), claveDeParrilla('AMC Break'));
});

test('la clave sale igual del identificador que del nombre', () => {
  assert.equal(claveDeParrillaDeId(idDeCanalPorTvg('Telecinco HD')), claveDeParrilla('Telecinco'));
  assert.equal(
    claveDeParrillaDeId(idDeCanalPorNombre('Telecinco SD', 'GENERALISTAS')),
    claveDeParrilla('Telecinco'),
  );
});
