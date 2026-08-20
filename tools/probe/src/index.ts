#!/usr/bin/env node
/**
 * Diagnóstico de una lista antes de construir nada encima.
 *
 * Responde a tres preguntas:
 *   1. ¿Responde player_api.php, o hay que tirar de M3U?
 *   2. ¿Cuántas conexiones simultáneas permite la cuenta? (manda en las descargas)
 *   3. ¿Cómo clasifica el core la lista real, y qué se le escapa?
 *
 * Uso:
 *   npm run probe -- "http://servidor:8080/get.php?username=U&password=P&type=m3u_plus"
 *   npm run probe -- --m3u lista.m3u
 *   npm run probe -- <url> --json informe.json --no-cache
 */

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { classify } from '@m3u/core';
import type { Library, RawEntry } from '@m3u/core';
import { buildLibrary, epgUrlFromHeader, parseM3U } from '@m3u/core/m3u';
import { XtreamClient, credentialsFromUrl } from '@m3u/core/xtream';

const CACHE_DIR = '.probe-cache';
const USER_AGENT = 'VLC/3.0.20 LibVLC/3.0.20';

interface Options {
  url: string | null;
  m3uFile: string | null;
  jsonOut: string | null;
  useCache: boolean;
}

function parseArgs(argv: string[]): Options {
  const options: Options = { url: null, m3uFile: null, jsonOut: null, useCache: true };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--m3u') options.m3uFile = argv[++i] ?? null;
    else if (arg === '--json') options.jsonOut = argv[++i] ?? null;
    else if (arg === '--no-cache') options.useCache = false;
    else if (!arg.startsWith('-')) options.url = arg;
  }
  return options;
}

/** Nunca imprimir la contraseña por consola ni dejarla en un informe. */
function redact(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.searchParams.has('password')) parsed.searchParams.set('password', '***');
    if (parsed.searchParams.has('username')) parsed.searchParams.set('username', '***');
    return parsed.toString();
  } catch {
    return url;
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (!options.url && !options.m3uFile) {
    console.error('Falta la URL de la lista (o --m3u <fichero>).');
    process.exitCode = 1;
    return;
  }

  if (options.url) {
    console.log(`Lista: ${redact(options.url)}\n`);
    await probeXtream(options.url);
  }

  const text = options.m3uFile
    ? await readFile(options.m3uFile, 'utf8')
    : await fetchPlaylist(options.url!, options.useCache);

  const doc = parseM3U(text);
  const library = buildLibrary(doc.entries);

  reportPlaylist(doc.header, doc.entries, doc.malformed, library);

  if (options.jsonOut) {
    await writeFile(options.jsonOut, JSON.stringify(library, null, 2), 'utf8');
    console.log(`\nInforme completo escrito en ${options.jsonOut}`);
  }
}

/** Paso 1: ¿tiene el panel la API abierta? */
async function probeXtream(url: string): Promise<void> {
  const creds = credentialsFromUrl(url);
  if (!creds) {
    console.log('La URL no lleva username/password: no parece un panel Xtream. Se usará solo el M3U.\n');
    return;
  }

  const client = new XtreamClient(creds, { userAgent: USER_AGENT });
  console.log('== player_api.php ==');
  try {
    const { user_info, server_info } = await client.info();
    const expires = user_info.exp_date
      ? new Date(Number(user_info.exp_date) * 1000).toISOString().slice(0, 10)
      : 'sin caducidad';

    console.log(`  API disponible. Cuenta ${user_info.status}, caduca ${expires}.`);
    console.log(`  Conexiones: ${user_info.active_cons} activas de ${user_info.max_connections} permitidas.`);
    if (Number(user_info.max_connections) <= 1) {
      console.log('  AVISO: con una sola conexión, descargar bloquea la reproducción. La cola tendrá que serializarse.');
    }
    if (server_info.server_protocol) console.log(`  Protocolo: ${server_info.server_protocol}`);
    console.log(`  EPG XMLTV: ${redact(client.epgUrl())}`);

    const [live, vod, series] = await Promise.all([
      client.liveCategories().catch(() => []),
      client.vodCategories().catch(() => []),
      client.seriesCategories().catch(() => []),
    ]);
    console.log(`  Categorías: ${live.length} de directo, ${vod.length} de películas, ${series.length} de series.`);

    if (series.length > 0) {
      // La prueba que de verdad importa: si get_series_info responde, no hay
      // que reconstruir temporadas a base de regex sobre los nombres.
      const list = await client.series().catch(() => []);
      const first = list[0];
      if (first) {
        const info = await client.seriesInfo(first.series_id);
        const seasons = Object.keys(info.episodes ?? {}).length;
        console.log(`  get_series_info OK: "${first.name}" trae ${seasons} temporada(s) ya estructuradas.`);
      }
    }
  } catch (error) {
    console.log(`  NO disponible (${(error as Error).message}).`);
    console.log('  Se usará el parseo del M3U como plan B.');
  }
  console.log();
}

async function fetchPlaylist(url: string, useCache: boolean): Promise<string> {
  const key = join(CACHE_DIR, `${hash(url)}.m3u`);

  if (useCache) {
    const cached = await stat(key).catch(() => null);
    if (cached) {
      const ageMin = Math.round((Date.now() - cached.mtimeMs) / 60_000);
      console.log(`Usando lista cacheada (${ageMin} min, ${mb(cached.size)}). --no-cache para refrescar.\n`);
      return readFile(key, 'utf8');
    }
  }

  console.log('Descargando lista...');
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!response.ok) throw new Error(`HTTP ${response.status} al descargar la lista`);
  const text = await response.text();
  console.log(`Descargados ${mb(Buffer.byteLength(text))}.\n`);

  await mkdir(dirname(key), { recursive: true });
  await writeFile(key, text, 'utf8');
  return text;
}

function reportPlaylist(
  header: Record<string, string>,
  entries: RawEntry[],
  malformed: number,
  library: Library,
): void {
  const stats = library.stats;

  console.log('== Lista M3U ==');
  const epg = epgUrlFromHeader(header);
  console.log(`  EPG declarado en la cabecera: ${epg ? redact(epg) : 'no'}`);
  if (malformed > 0) console.log(`  Líneas mal formadas: ${malformed}`);

  console.log(`\n  ${stats.entries} entradas ->`);
  console.log(
    `    Directo:   ${stats.channels} canales en ${stats.groups} grupos (${stats.channelEntries} entradas fusionadas)`,
  );
  console.log(`    Películas: ${stats.movies} (de ${stats.movieEntries} entradas)`);
  console.log(`    Series:    ${stats.series} series, ${stats.episodes} episodios (de ${stats.episodeEntries} entradas)`);
  console.log(`    Ocultas:   ${stats.junk} (anuncios y separadores)`);
  console.log(`    Dudosas:   ${stats.unknown} sin señal clara de clasificación`);

  console.log('\n== Grupos de canales ==');
  for (const group of library.groups.slice(0, 40)) {
    console.log(`  ${group.name.slice(0, 34).padEnd(36)} ${group.channelIds.length}`);
  }
  if (library.groups.length > 40) console.log(`  ... y ${library.groups.length - 40} más`);

  const merged = library.channels.filter((channel) => channel.variants.length > 1);
  console.log(`\n== Canales con varias calidades: ${merged.length} ==`);
  for (const channel of merged.slice(0, 10)) {
    console.log(`  ${channel.name.slice(0, 30).padEnd(32)} ${channel.variants.map((v) => v.quality ?? '?').join(' / ')}`);
  }

  console.log('\n== Series con más episodios ==');
  const top = [...library.series]
    .map((series) => ({
      series,
      count: series.seasons.reduce((total, season) => total + season.episodes.length, 0),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
  for (const { series, count } of top) {
    console.log(`  ${series.title.slice(0, 40).padEnd(42)} ${series.seasons.length} temp, ${count} eps`);
  }

  // Lo más valioso del informe: dónde falla el clasificador con TU lista.
  if (library.unclassified.length > 0) {
    console.log(`\n== Entradas sin clasificar con confianza: ${library.unclassified.length} ==`);
    for (const entry of library.unclassified.slice(0, 25)) {
      const group = entry.attrs['group-title'] ?? '(sin grupo)';
      const why = classify(entry).guessed ? 'sin señal' : 'grupo de series sin marca de episodio';
      console.log(`  [${why}] ${group} | ${entry.name}`);
    }
    if (library.unclassified.length > 25) {
      console.log(`  ... y ${library.unclassified.length - 25} más`);
    }
  }

  if (library.junk.length > 0) {
    console.log(`\n== Entradas ocultas: ${library.junk.length} ==`);
    for (const entry of library.junk.slice(0, 15)) {
      console.log(`  ${entry.name}`);
    }
  }
}

function hash(value: string): string {
  let result = 0;
  for (let i = 0; i < value.length; i++) result = (Math.imul(31, result) + value.charCodeAt(i)) | 0;
  return (result >>> 0).toString(16);
}

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

main().catch((error) => {
  console.error(`\nError: ${(error as Error).message}`);
  process.exitCode = 1;
});
