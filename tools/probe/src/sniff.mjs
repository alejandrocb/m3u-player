/**
 * ¿De qué son realmente los ficheros del proveedor?
 *
 * La extensión de la URL miente: hay .mkv que por dentro son MP4. Esto importa
 * para dos cosas — qué reproductor hace falta, y con qué extensión guardar las
 * descargas para que Jellyfin/Kodi las lean.
 *
 * Se piden solo los primeros bytes con Range, sin descargar el fichero. Las
 * peticiones van de una en una a propósito: la cuenta admite una sola conexión.
 *
 *   node tools/probe/src/sniff.mjs .probe-cache/<lista>.m3u [cuantos]
 */

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

const [, , listPath, countArg] = process.argv;
if (!listPath) {
  console.error('Uso: node tools/probe/src/sniff.mjs <lista.m3u> [cuantos]');
  process.exit(1);
}
const sampleSize = Number(countArg ?? 8);

/** Firma del contenedor en los primeros bytes. */
function identify(bytes) {
  if (bytes.length >= 4 && bytes.readUInt32BE(0) === 0x1a45dfa3) return 'Matroska (MKV/WebM)';
  if (bytes.length >= 12 && bytes.toString('latin1', 4, 8) === 'ftyp') {
    return `MP4 (${bytes.toString('latin1', 8, 12).trim()})`;
  }
  if (bytes.length >= 1 && bytes[0] === 0x47) return 'MPEG-TS';
  if (bytes.length >= 3 && bytes.toString('latin1', 0, 3) === 'FLV') return 'FLV';
  if (bytes.length >= 4 && bytes.toString('latin1', 0, 4) === 'RIFF') return 'AVI';
  if (bytes.length >= 7 && bytes.toString('latin1', 0, 7) === '#EXTM3U') return 'lista HLS (no es un fichero)';
  return `desconocido (${bytes.subarray(0, 8).toString('hex')})`;
}

/** Reparte la muestra entre películas y episodios para que sea representativa. */
async function collect() {
  const rl = createInterface({ input: createReadStream(listPath, 'utf8'), crlfDelay: Infinity });
  const movies = [];
  const episodes = [];
  const wanted = Math.ceil(sampleSize / 2);
  // Saltar entradas para no quedarse siempre con las primeras de la lista.
  let seenMovies = 0;
  let seenEpisodes = 0;
  let name = null;

  for await (const line of rl) {
    if (line.startsWith('#EXTINF:')) {
      name = line.slice(line.lastIndexOf(',') + 1).trim();
      continue;
    }
    if (line.startsWith('#') || !line.trim()) continue;

    const url = line.trim();
    if (/\/movie\//.test(url)) {
      seenMovies++;
      if (movies.length < wanted && seenMovies % 1500 === 0) movies.push({ name, url, kind: 'película' });
    } else if (/\/series\//.test(url)) {
      seenEpisodes++;
      if (episodes.length < wanted && seenEpisodes % 12000 === 0) episodes.push({ name, url, kind: 'episodio' });
    }
    name = null;

    if (movies.length >= wanted && episodes.length >= wanted) break;
  }

  return [...movies, ...episodes];
}

const samples = await collect();
console.log(`Comprobando ${samples.length} ficheros (de uno en uno, la cuenta admite una conexión)\n`);

const tally = new Map();

for (const sample of samples) {
  const extension = sample.url.split('.').pop()?.toLowerCase() ?? '?';
  try {
    const response = await fetch(sample.url, {
      headers: { Range: 'bytes=0-63', 'User-Agent': 'VLC/3.0.20 LibVLC/3.0.20' },
    });
    if (!response.ok && response.status !== 206) {
      console.log(`  HTTP ${response.status}  .${extension.padEnd(4)}  ${sample.name?.slice(0, 45)}`);
      continue;
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    const container = identify(bytes);
    const acceptsRange = response.headers.get('content-range') !== null || response.status === 206;

    tally.set(`.${extension} -> ${container}`, (tally.get(`.${extension} -> ${container}`) ?? 0) + 1);
    console.log(
      `  .${extension.padEnd(4)} es ${container.padEnd(22)} range:${acceptsRange ? 'sí' : 'NO'}  ${sample.kind}  ${sample.name?.slice(0, 40)}`,
    );
  } catch (error) {
    console.log(`  fallo   .${extension.padEnd(4)}  ${error.message}`);
  }
}

console.log('\nResumen:');
for (const [key, count] of [...tally.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${count}x  ${key}`);
}
