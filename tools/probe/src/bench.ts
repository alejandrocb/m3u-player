#!/usr/bin/env node
/**
 * Mide el almacenamiento contra la lista real.
 *
 * Lo que se quiere saber: cuánto tarda una importación completa, cuánto ocupa
 * en disco, y si las consultas que va a hacer la interfaz son instantáneas con
 * 200.000 entradas dentro. Si una consulta tarda más de unos milisegundos, la
 * interfaz se notará pastosa por muy virtualizada que esté la lista.
 *
 *   node tools/probe/src/bench.ts .probe-cache/<lista>.m3u
 */

import { readFileSync, rmSync, statSync } from 'node:fs';

import { buildLibrary, parseM3U } from '@m3u/core/m3u';
import { LibraryStore } from '@m3u/storage';

const listPath = process.argv[2];
if (!listPath) {
  console.error('Uso: node tools/probe/src/bench.ts <lista.m3u>');
  process.exit(1);
}

const dbPath = '.probe-cache/biblioteca.db';
for (const suffix of ['', '-wal', '-shm']) {
  try {
    rmSync(dbPath + suffix);
  } catch {
    // No existía: es lo normal en la primera ejecución.
  }
}

function timed<T>(label: string, work: () => T): T {
  const started = performance.now();
  const result = work();
  console.log(`  ${label.padEnd(28)} ${Math.round(performance.now() - started)} ms`);
  return result;
}

console.log('== Carga ==');
const text = timed('leer el fichero', () => readFileSync(listPath, 'utf8'));
const doc = timed('parsear el M3U', () => parseM3U(text));
const library = timed('construir la biblioteca', () => buildLibrary(doc.entries));

const store = LibraryStore.open(dbPath);
const report = timed('importar a SQLite', () => store.import(library));

console.log('\n== Resultado ==');
console.log(`  ${report.channels} canales, ${report.groups} grupos`);
console.log(`  ${report.movies} películas`);
console.log(`  ${report.series} series, ${report.episodes} episodios`);
console.log(`  ${report.variants} variantes de calidad`);
console.log(`  base de datos: ${(statSync(dbPath).size / 1024 / 1024).toFixed(1)} MB`);

console.log('\n== Consultas de la interfaz ==');
const groups = timed('listar grupos', () => store.groups());
timed('canales de un grupo', () => store.channelsInGroup(groups[0]?.name ?? ''));
timed('primera página de pelis', () => store.movies({ limit: 60 }));
timed('página 100 de pelis', () => store.movies({ limit: 60, offset: 6000 }));
timed('primera página de series', () => store.series({ limit: 60 }));

const someSeries = store.series({ limit: 1 })[0];
if (someSeries) {
  timed('temporadas de una serie', () => store.seasons(someSeries.id));
  timed('episodios de una temporada', () => store.episodes(someSeries.id, 1));
}

const hits = timed('búsqueda global', () => store.search('senor'));
console.log(`\n  "senor" -> ${hits.length} resultados; el primero: ${hits[0]?.title ?? 'ninguno'} (${hits[0]?.kind})`);

const partial = store.search('breaking');
console.log(`  "breaking" -> ${partial.length} resultados; el primero: ${partial[0]?.title ?? 'ninguno'}`);

store.close();
