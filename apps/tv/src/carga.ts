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
import { XtreamClient, construirCatalogo, credentialsFromUrl, fichaDeSerie, temporadasDeSerie } from '@m3u/core/xtream';
import type { Library } from '@m3u/core';
import type {
  AlmacenPerfiles,
  Biblioteca,
  Cuenta,
  FichaLarga,
  FichasNuevas,
  Programacion,
  ProgramaRemoto,
} from '@m3u/ui';

import { abrirBase, estadoGuardado, guardarCatalogo, meta, ponerMeta } from './basedatos';
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
  /**
   * Cuántas conexiones simultáneas admite la cuenta, según el panel.
   *
   * No se supone: la primera cuenta del proveedor daba 1 y la segunda, 3. Es
   * lo que reparte el árbitro. `null` si el panel no contestó.
   */
  conexiones: number | null;
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
  /**
   * La parrilla que prepara el servidor de la casa.
   *
   * Es opcional porque no todas las casas tienen servidor: sin esto, la
   * programación se le pide al panel canal a canal, como siempre.
   */
  parrilla?: () => Promise<ProgramaRemoto[]>;
  /**
   * Las fichas largas que el servidor de la casa lleva averiguadas.
   *
   * También opcional, y por lo mismo: sin servidor, cada ficha se le pregunta
   * al panel cuando se abre, que es una petición y 400 ms.
   */
  fichas?: (desde: number) => Promise<FichasNuevas>;
}

/** Por dónde iba la recogida de fichas. Es la marca de agua del servidor. */
const MARCA_FICHAS = 'fichas:desde';

/**
 * Cuántas vueltas se dan como mucho en una recogida.
 *
 * El servidor manda mil por respuesta y el catálogo son 24.000, así que la
 * primera vez hacen falta unas cuantas vueltas. El tope está para que un
 * servidor que devolviera siempre lo mismo no dejara la aplicación dando
 * vueltas sin arrancar: lo que falte se recoge en la sesión siguiente.
 */
const VUELTAS = 30;

/**
 * Recoge del servidor las fichas nuevas y las anota en la base.
 *
 * Se pide "lo posterior a la última vez" y no todo, y se vuelve a pedir
 * mientras las respuestas lleguen llenas: es como se sabe que ya no queda
 * nada. Si algo falla, se queda como estaba: esto adorna la ficha, no sostiene
 * la pantalla.
 */
async function recogerFichas(
  db: ReturnType<typeof abrirBase>['db'],
  biblioteca: Biblioteca,
  pedir: (desde: number) => Promise<FichasNuevas>,
): Promise<void> {
  try {
    let desde = Number(meta(db, MARCA_FICHAS)) || 0;
    let traidas = 0;

    for (let vuelta = 0; vuelta < VUELTAS; vuelta += 1) {
      const nuevas = await pedir(desde);
      if (nuevas.fichas.length === 0) break;

      await biblioteca.guardarFichas(nuevas.fichas);
      traidas += nuevas.fichas.length;

      // La marca no avanza: sin ella la siguiente vuelta pediría lo mismo.
      if (nuevas.hasta <= desde) break;
      desde = nuevas.hasta;
      ponerMeta(db, MARCA_FICHAS, String(desde));
    }

    if (traidas > 0) console.log(`[fichas] ${traidas} del servidor, hasta ${desde}`);
  } catch (fallo) {
    console.warn('[fichas] no se pudieron recoger', fallo);
  }
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
    // Y la ficha larga, para lo que preside el inicio: de una película con
    // `get_vod_info` y de una serie con `get_series_info`.
    traerDetalle: (panelIds) => (cliente ? detalleDePelicula(cliente, panelIds) : Promise.resolve(null)),
    traerFichaSerie: (panelIds) => (cliente ? fichaDeSerie(cliente, panelIds) : Promise.resolve(null)),
  });

  /*
    El handshake, solo para saber cuántas conexiones da la cuenta. Es una
    petición barata y se pide siempre, también cuando el catálogo ya está
    guardado: el proveedor puede cambiar el límite y el árbitro reparte con lo
    que diga el panel, no con lo que hubiera la primera vez.
  */
  const conexiones = cliente
    ? await cliente
        .info()
        .then(({ user_info }) => Number(user_info.max_connections) || null)
        .catch(() => null)
    : null;

  const guardado = estadoGuardado(db, cuenta.id);
  if (guardado && guardado.dias < DIAS_FRESCURA && !opciones.forzar) {
    if (opciones.fichas) await recogerFichas(db, biblioteca, opciones.fichas);
    const totales = await biblioteca.totales();
    return {
      biblioteca,
      perfiles,
      programacion: programacionDelPanel({ cliente, biblioteca, parrilla: opciones.parrilla }),
      medicion: {
        total: Date.now() - arranque,
        via: 'guardada',
        importada: guardado.importada,
        dias: guardado.dias,
        canales: totales.canales,
        peliculas: totales.peliculas,
        series: totales.series,
        entradas: totales.canales + totales.peliculas + totales.series,
        conexiones,
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

  /*
    Después de importar, y desde el principio: el catálogo recién traído no
    lleva ninguna ficha, así que hay que volver a pedirlas todas. Reimportar no
    es olvidar lo que el servidor sabe.
  */
  if (opciones.fichas) {
    ponerMeta(db, MARCA_FICHAS, '0');
    await recogerFichas(db, biblioteca, opciones.fichas);
  }

  return {
    biblioteca,
    perfiles,
    programacion: programacionDelPanel({ cliente, biblioteca, parrilla: opciones.parrilla }),
    medicion: {
      total: Date.now() - arranque,
      via: cliente ? 'panel' : 'm3u',
      importada: new Date().toISOString(),
      dias: 0,
      canales: library.stats.channels,
      peliculas: library.stats.movies,
      series: library.stats.series,
      conexiones,
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
async function detalleDePelicula(cliente: XtreamClient, panelIds: number[]): Promise<FichaLarga | null> {
  for (const panelId of panelIds) {
    const respuesta = await cliente.vodInfo(panelId);
    const info = respuesta.info;
    if (!info) continue;

    const sinopsis = info.plot?.trim() || null;
    const reparto = info.cast?.trim() || null;
    // `backdrop_path` llega como lista aunque traiga una sola imagen.
    const fondo = info.backdrop_path?.find((una) => typeof una === 'string' && una.trim()) ?? null;
    const genero = info.genre?.trim() || null;
    // El tráiler no se reproduce aquí: se abre en YouTube, que además no gasta
    // conexión del panel.
    const trailer = info.youtube_trailer?.trim() || null;

    if (sinopsis || reparto || fondo || genero || trailer) {
      return { sinopsis, reparto, fondo, genero, trailer };
    }
  }
  return null;
}
