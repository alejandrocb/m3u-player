#!/usr/bin/env node
/**
 * ¿Se puede saber dónde empieza la intro de una serie sin analizar el audio?
 *
 * Mide lo único que puede resolverlo barato: **si los ficheros del panel traen
 * capítulos marcados**. Coge una serie, se baja la cabecera de tres episodios
 * —unos megas, no el episodio— y dice qué contenedor son y qué capítulos
 * llevan dentro.
 *
 * Uso:
 *   node tools/probe/src/intro.ts '<url de get.php>' [texto de la serie]
 *
 * Sin texto coge la primera serie que devuelva el panel. La URL lleva usuario
 * y contraseña, así que **nunca se imprime entera**: se redacta igual que en
 * el resto del `probe`.
 */

import { XtreamClient, credentialsFromUrl } from '@m3u/core/xtream';

import { capitulosDe } from './capitulos.ts';

const USER_AGENT = 'VLC/3.0.20 LibVLC/3.0.20';

/** Cuántos episodios se miran. Con tres se ve si es cosa de uno o de todos. */
const CUANTOS = 3;

function redactar(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.searchParams.has('password')) parsed.searchParams.set('password', '***');
    if (parsed.searchParams.has('username')) parsed.searchParams.set('username', '***');
    return parsed.toString();
  } catch {
    return '(url ilegible)';
  }
}

/** La URL de un episodio, que el panel no da hecha. */
function urlDeEpisodio(base: string, usuario: string, clave: string, id: string, extension: string): string {
  return `${base}/series/${usuario}/${clave}/${id}.${extension || 'mkv'}`;
}

async function main(): Promise<void> {
  const [url, buscado] = process.argv.slice(2);
  if (!url) {
    console.error('Falta la URL de la lista.');
    process.exitCode = 1;
    return;
  }

  const credenciales = credentialsFromUrl(url);
  if (!credenciales) {
    console.error('La URL no lleva usuario y contraseña.');
    process.exitCode = 1;
    return;
  }

  console.log(`Lista: ${redactar(url)}\n`);
  const cliente = new XtreamClient(credenciales, { userAgent: USER_AGENT, timeoutMs: 30_000 });

  const series = await cliente.series();
  const elegida = buscado
    ? series.find((una) => una.name?.toLowerCase().includes(buscado.toLowerCase()))
    : series[0];
  if (!elegida) {
    console.error(buscado ? `No hay ninguna serie que contenga "${buscado}".` : 'El panel no devolvió series.');
    process.exitCode = 1;
    return;
  }

  console.log(`Serie: ${elegida.name}`);
  const info = await cliente.seriesInfo(elegida.series_id);
  const temporadas = Object.entries(info.episodes ?? {});
  const [numero, episodios] = temporadas[0] ?? [];
  if (!episodios || episodios.length === 0) {
    console.error('Esa serie no trae episodios.');
    process.exitCode = 1;
    return;
  }
  console.log(`Temporada ${numero}: ${episodios.length} episodios\n`);

  for (const episodio of episodios.slice(0, CUANTOS)) {
    const destino = urlDeEpisodio(
      credenciales.base,
      credenciales.username,
      credenciales.password,
      String(episodio.id),
      String(episodio.container_extension ?? 'mkv'),
    );

    const nombre = episodio.title || `Episodio ${episodio.episode_num}`;
    try {
      const leido = await capitulosDe(destino);
      const cuantos = leido.nombres.length;
      console.log(`  ${nombre}`);
      console.log(
        `    ${leido.contenedor}, ${(leido.leidos / 1024 / 1024).toFixed(1)} MB leídos · ` +
          `capítulos: ${leido.tieneCapitulos ? 'sí' : 'no'}${cuantos > 0 ? ` (${cuantos} nombres)` : ''}`,
      );
      if (cuantos > 0) console.log(`    ${leido.nombres.slice(0, 8).join(' | ')}`);
    } catch (fallo) {
      console.log(`  ${nombre}: no se pudo leer (${(fallo as Error).message})`);
    }
  }

  console.log(
    '\nSi arriba pone "capítulos: sí" y salen nombres tipo "Intro" u "Opening",\n' +
      'la intro se puede sacar del propio fichero, sin analizar el audio.',
  );
}

main().catch((error) => {
  console.error(`\nError: ${(error as Error).message}`);
  process.exitCode = 1;
});
