/**
 * De dónde salen los datos al conectar con una lista.
 *
 * La regla es: si hay catálogo guardado de esa lista y no está viejo, se usa
 * tal cual y el arranque es inmediato. Si no, se importa del panel y se guarda.
 * Importar tarda unos 50 segundos; leer de la base, nada.
 *
 * El catálogo se trae de `player_api.php`, no del M3U: esos 71 MB de texto,
 * como cadena de JavaScript, no caben en el montón de una tablet —lo probamos
 * y se cerró por falta de memoria—.
 *
 * De las series solo se guardan los títulos. Sus temporadas se piden al abrir
 * cada una y se guardan desde entonces: son 6.598, y traerlas todas serían
 * 6.598 viajes al panel.
 */

import { buildLibrary, parseM3U } from '@m3u/core';
import { XtreamClient, construirCatalogo, credentialsFromUrl, temporadasDeSerie } from '@m3u/core/xtream';
import type { Library } from '@m3u/core';
import type { AlmacenPerfiles, Biblioteca, Cuenta, DetallePelicula, Programacion } from '@m3u/ui';

import { abrirBase, estadoGuardado, guardarCatalogo } from './basedatos';
import { bibliotecaEnBase } from './biblioteca-base';
import { perfilesEnBase } from './perfiles-base';
import { programacionDelPanel } from './programacion';

/** Cuántos días vale un catálogo antes de volver a pedirlo. */
export const DIAS_FRESCURA = 3;

export interface Medicion {
  total: number;
  via: 'guardada' | 'panel' | 'm3u';
  /** Cuándo se importó el catálogo que se está usando. */
  importada: string;
  /** Días que tiene el catálogo. 0 si se acaba de traer. */
  dias: number;
  canales: number;
  peliculas: number;
  series: number;
  entradas: number;
}

export interface Cargada {
  biblioteca: Biblioteca;
  /** Perfiles, historial y favoritos: viven en la misma base. */
  perfiles: AlmacenPerfiles;
  /** La parrilla del directo, que se pide al panel y no se guarda. */
  programacion: Programacion;
  medicion: Medicion;
}

export interface Avance {
  seccion: string;
  hecho: number;
  total: number;
}

export interface OpcionesCarga {
  /** El botón de actualizar: reimporta aunque lo guardado esté fresco. */
  forzar?: boolean;
}

export async function cargarCatalogo(
  cuenta: Cuenta,
  avisar: (avance: Avance) => void,
  opciones: OpcionesCarga = {},
): Promise<Cargada> {
  const arranque = Date.now();
  const { db, conBusquedaRapida } = abrirBase();
  const credenciales = credentialsFromUrl(cuenta.url);

  const cliente = credenciales ? new XtreamClient(credenciales, { timeoutMs: 30_000 }) : null;
  const perfiles = perfilesEnBase(db);
  const biblioteca = bibliotecaEnBase(db, {
    conBusquedaRapida,
    // Las temporadas que falten se piden al panel al abrir la serie.
    traerTemporadas: (panelIds, titulo) =>
      cliente ? temporadasDeSerie(cliente, panelIds, titulo) : Promise.resolve([]),
    // Y la ficha larga de una película, para la que preside el inicio.
    traerDetalle: (panelIds) => (cliente ? detalleDePelicula(cliente, panelIds) : Promise.resolve(null)),
  });

  const guardado = estadoGuardado(db, cuenta.id);
  if (guardado && guardado.dias < DIAS_FRESCURA && !opciones.forzar) {
    const totales = await biblioteca.totales();
    return {
      biblioteca,
      perfiles,
      programacion: programacionDelPanel(cliente, biblioteca),
      medicion: {
        total: Date.now() - arranque,
        via: 'guardada',
        importada: guardado.importada,
        dias: guardado.dias,
        canales: totales.canales,
        peliculas: totales.peliculas,
        series: totales.series,
        entradas: totales.canales + totales.peliculas + totales.series,
      },
    };
  }

  const library = cliente
    ? await construirCatalogo(cliente, {
        avance: (hecho, total, seccion) => avisar({ seccion, hecho, total }),
      })
    : await descargarM3U(cuenta.url, avisar);

  avisar({ seccion: 'Guardando', hecho: 1, total: 1 });
  guardarCatalogo(db, library, cuenta.id, conBusquedaRapida);

  return {
    biblioteca,
    perfiles,
    programacion: programacionDelPanel(cliente, biblioteca),
    medicion: {
      total: Date.now() - arranque,
      via: cliente ? 'panel' : 'm3u',
      importada: new Date().toISOString(),
      dias: 0,
      canales: library.stats.channels,
      peliculas: library.stats.movies,
      series: library.stats.series,
      // Fichas ya fusionadas, para que la cifra sea la misma se venga del
      // panel o de la base. `stats.entries` cuenta entradas del proveedor,
      // que son más porque incluyen las repetidas por calidad.
      entradas: library.stats.channels + library.stats.movies + library.stats.series,
    },
  };
}

/**
 * Camino para listas M3U sueltas, sin API detrás. Sirve para listas pequeñas;
 * con una grande, este aparato se queda sin memoria.
 */
async function descargarM3U(url: string, avisar: (avance: Avance) => void): Promise<Library> {
  avisar({ seccion: 'Descargando la lista', hecho: 0, total: 1 });
  const respuesta = await fetch(url, { headers: { 'User-Agent': 'VLC/3.0.20 LibVLC/3.0.20' } });
  if (!respuesta.ok) {
    throw new Error(
      respuesta.status === 403
        ? 'El servidor rechazó la conexión (403). Puede ser el límite de conexiones: cierra otras reproducciones y espera unos segundos.'
        : `El servidor respondió ${respuesta.status}.`,
    );
  }

  const texto = await respuesta.text();
  if (!texto.trim().startsWith('#EXTM3U')) {
    throw new Error('Lo que devuelve esa dirección no parece una lista M3U.');
  }

  avisar({ seccion: 'Montando la biblioteca', hecho: 1, total: 1 });
  return buildLibrary(parseM3U(texto).entries);
}

/**
 * La sinopsis, el reparto y la imagen apaisada de una película.
 *
 * El proveedor manda una entrada por calidad, así que una película puede tener
 * varios identificadores de panel. Se prueban en orden y se para en el primero
 * que conteste algo: los demás darían lo mismo.
 */
async function detalleDePelicula(cliente: XtreamClient, panelIds: number[]): Promise<DetallePelicula | null> {
  for (const panelId of panelIds) {
    const respuesta = await cliente.vodInfo(panelId);
    const info = respuesta.info;
    if (!info) continue;

    const sinopsis = info.plot?.trim() || null;
    const reparto = info.cast?.trim() || null;
    // `backdrop_path` llega como lista aunque traiga una sola imagen.
    const fondo = info.backdrop_path?.find((una) => typeof una === 'string' && una.trim()) ?? null;
    const genero = info.genre?.trim() || null;

    if (sinopsis || reparto || fondo || genero) return { sinopsis, reparto, fondo, genero };
  }
  return null;
}
