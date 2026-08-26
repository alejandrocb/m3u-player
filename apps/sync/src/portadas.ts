/**
 * Las sugerencias que presiden el inicio, preparadas en el servidor.
 *
 * Por qué aquí y no en el aparato: sacar una portada decente cuesta **una
 * petición por candidata** —`get_vod_info` o `get_series_info`— y encima
 * bastantes no traen imagen apaisada, así que hay que preguntar por más de
 * las que salen. Eso, multiplicado por tres aparatos de la casa y por cada
 * arranque, es un rato de espera y de peticiones repetidas contra el panel.
 *
 * El servidor lo hace **una vez al día para toda la casa**, y de paso puede
 * permitirse lo que un televisor no: comprobar que la imagen es de verdad
 * apaisada antes de proponerla, midiéndola.
 *
 * Lo que sale de aquí son **datos, no interfaz**: títulos, notas y una
 * imagen. Cómo se pinta eso es cosa de la aplicación, y si el servidor no
 * contesta, el aparato lo resuelve por su cuenta como siempre.
 *
 * Los identificadores se calculan igual que en el aparato (`slug(título-año)`,
 * el mismo código de `@m3u/core`), y por eso valen para reproducir: el
 * aparato busca en su base por ese identificador y encuentra la ficha.
 */

import { parseName, slug } from '@m3u/core';
import { XtreamClient, credentialsFromUrl } from '@m3u/core/xtream';
import type { XtreamSeries, XtreamVodStream } from '@m3u/core/xtream';

import { esApaisada, medirRemota } from './imagen.ts';

export interface Portada {
  clase: 'pelicula' | 'serie';
  /** El mismo que calcula el aparato al importar: `slug(título-año)`. */
  id: string;
  titulo: string;
  anio: number | null;
  valoracion: number | null;
  /** Apaisada y comprobada. Sin esto no habría sugerencia. */
  imagen: string;
  sinopsis: string | null;
  reparto: string | null;
  genero: string | null;
}

/** Cuántas se preparan de cada clase. La aplicación turna entre ellas. */
const CUANTAS = 6;

/** Por cuántas se pregunta para sacar esas seis. */
const CANDIDATAS = 20;

/** Nota mínima para merecer la portada. La misma que usa el aparato. */
const NOTA = 7;

export interface OpcionesPortadas {
  fetch?: typeof globalThis.fetch;
  /** Para los tests, que no quieren esperar a un reloj de verdad. */
  ahora?: Date;
}

/**
 * Prepara las portadas de una lista.
 *
 * Dos peticiones para el catálogo —todas las películas y todas las series, sin
 * categoría— y luego una por candidata hasta juntar las que hacen falta. Si el
 * panel falla, devuelve lo que llevara: media portada es mejor que ninguna.
 */
export async function prepararPortadas(url: string, opciones: OpcionesPortadas = {}): Promise<Portada[]> {
  const credenciales = credentialsFromUrl(url);
  if (!credenciales) throw new Error('la URL de la lista no lleva usuario y contraseña');

  const cliente = new XtreamClient(credenciales, { fetch: opciones.fetch, timeoutMs: 30_000 });
  const ahora = opciones.ahora ?? new Date();
  const desde = ahora.getFullYear() - 1;

  const [peliculas, series] = await Promise.all([
    cliente.vodStreams().catch(() => [] as XtreamVodStream[]),
    cliente.series().catch(() => [] as XtreamSeries[]),
  ]);

  const dePeliculas = await elegir(
    candidatasDePelicula(peliculas, desde),
    CUANTAS,
    async (candidata) => {
      const info = (await cliente.vodInfo(candidata.panelId)).info;
      if (!info) return null;
      return {
        imagen: primeraImagen(info.backdrop_path),
        sinopsis: info.plot?.trim() || null,
        reparto: info.cast?.trim() || null,
        genero: info.genre?.trim() || null,
      };
    },
    opciones,
  );

  const deSeries = await elegir(
    candidatasDeSerie(series, desde),
    CUANTAS,
    async (candidata) => {
      const info = (await cliente.seriesInfo(candidata.panelId)).info;
      if (!info) return null;
      return {
        imagen: primeraImagen(info.backdrop_path),
        sinopsis: info.plot?.trim() || null,
        reparto: info.cast?.trim() || null,
        genero: info.genre?.trim() || null,
      };
    },
    opciones,
  );

  return [...dePeliculas, ...deSeries];
}

interface Candidata {
  clase: 'pelicula' | 'serie';
  id: string;
  panelId: number;
  titulo: string;
  anio: number | null;
  valoracion: number | null;
}

function nota(valor: string | undefined): number | null {
  const numero = Number(valor);
  return Number.isFinite(numero) && numero > 0 ? numero : null;
}

function primeraImagen(lista: string[] | undefined): string | null {
  return lista?.find((una) => typeof una === 'string' && una.trim()) ?? null;
}

function candidatasDePelicula(streams: XtreamVodStream[], desde: number): Candidata[] {
  const vistas = new Set<string>();
  return streams
    .map((stream) => {
      const parsed = parseName(stream.name);
      const titulo = parsed.title || stream.name;
      const anio = Number(stream.year) || parsed.year || null;
      return {
        clase: 'pelicula' as const,
        id: slug(`${titulo}-${anio ?? ''}`),
        panelId: stream.stream_id,
        titulo,
        anio,
        valoracion: nota(stream.rating),
      };
    })
    .filter((candidata) => {
      if (candidata.anio === null || candidata.anio < desde) return false;
      if ((candidata.valoracion ?? 0) < NOTA) return false;
      // El proveedor manda una entrada por calidad: la misma película sale
      // varias veces y bastaría con preguntar por una.
      if (vistas.has(candidata.id)) return false;
      vistas.add(candidata.id);
      return true;
    })
    .sort((a, b) => (b.valoracion ?? 0) - (a.valoracion ?? 0))
    .slice(0, CANDIDATAS);
}

function candidatasDeSerie(fichas: XtreamSeries[], desde: number): Candidata[] {
  const vistas = new Set<string>();
  return fichas
    .map((ficha) => {
      const parsed = parseName(ficha.name);
      const titulo = parsed.title || ficha.name;
      const anio = Number((ficha.releaseDate ?? '').slice(0, 4)) || parsed.year || null;
      return {
        clase: 'serie' as const,
        id: slug(`${titulo}-${anio ?? ''}`),
        panelId: ficha.series_id,
        titulo,
        anio,
        valoracion: nota(ficha.rating),
      };
    })
    .filter((candidata) => {
      if (candidata.anio === null || candidata.anio < desde) return false;
      if ((candidata.valoracion ?? 0) < NOTA) return false;
      if (vistas.has(candidata.id)) return false;
      vistas.add(candidata.id);
      return true;
    })
    .sort((a, b) => (b.valoracion ?? 0) - (a.valoracion ?? 0))
    .slice(0, CANDIDATAS);
}

/**
 * Va pidiendo fichas hasta juntar las que hacen falta.
 *
 * En fila y no en paralelo a propósito: se para en cuanto tiene bastantes, y
 * lo normal es que le lleguen las primeras. Preguntar por las veinte para
 * quedarse con seis serían catorce peticiones al panel para nada.
 */
async function elegir(
  candidatas: Candidata[],
  cuantas: number,
  ficha: (candidata: Candidata) => Promise<{
    imagen: string | null;
    sinopsis: string | null;
    reparto: string | null;
    genero: string | null;
  } | null>,
  opciones: OpcionesPortadas,
): Promise<Portada[]> {
  const elegidas: Portada[] = [];

  for (const candidata of candidatas) {
    if (elegidas.length >= cuantas) break;

    let traida;
    try {
      traida = await ficha(candidata);
    } catch {
      continue;
    }
    if (!traida?.imagen) continue;

    // Y se comprueba que la imagen sea de verdad apaisada: algunos paneles
    // meten el cartel vertical en el campo del fondo.
    if (!esApaisada(await medirRemota(traida.imagen, { fetch: opciones.fetch }))) continue;

    elegidas.push({
      clase: candidata.clase,
      id: candidata.id,
      titulo: candidata.titulo,
      anio: candidata.anio,
      valoracion: candidata.valoracion,
      imagen: traida.imagen,
      sinopsis: traida.sinopsis,
      reparto: traida.reparto,
      genero: traida.genero,
    });
  }

  return elegidas;
}
