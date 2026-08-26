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

import { esRecomendable, fold, parseName, slug } from '@m3u/core';
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

/**
 * El género de una película, que el catálogo no trae.
 *
 * `get_vod_streams` da título, cartel, nota y año, y nada más: el género está
 * en la ficha larga, que es una petición por título. Para 18.000 no vale, pero
 * para las que llenan la pantalla de inicio —lo último que ha entrado y lo
 * mejor valorado— sí, y hechas aquí se pagan una vez al día para toda la casa.
 *
 * De las series no hace falta: `get_series` ya lo trae, así que el aparato lo
 * guarda al importar.
 */
export interface Genero {
  /** El mismo `slug(título-año)` que calcula el aparato. */
  id: string;
  genero: string;
}

export interface Preparado {
  /**
   * Con qué versión de este preparador se hizo.
   *
   * Al cambiarla, el trabajo diario rehace lo guardado aunque sea de hace un
   * rato: si no, un cambio aquí no se notaría hasta el día siguiente y
   * depurarlo sería insoportable.
   */
  version: number;
  portadas: Portada[];
  generos: Genero[];
}

export const VERSION = 4;

/**
 * De cuántas películas se averigua el género, por cada criterio.
 *
 * Son peticiones al panel, una por película, así que el número es un
 * compromiso. Sesenta y no veinte porque **el catálogo del aparato puede
 * llevar hasta tres días guardado**: lo que aquí es "lo más reciente" ya es
 * más nuevo que nada de lo que él tiene, y con el corte justo no coincidía
 * ninguna.
 */
const CON_GENERO = 60;

/** Cuántas se preparan de cada clase. La aplicación turna entre ellas. */
const CUANTAS = 6;

/** Por cuántas se pregunta para sacar esas seis. */
const CANDIDATAS = 20;

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
export async function prepararPortadas(url: string, opciones: OpcionesPortadas = {}): Promise<Preparado> {
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
    (candidata) =>
      juntar(candidata.panelIds, async (panelId) => {
        const info = (await cliente.vodInfo(panelId)).info;
        if (!info) return null;
        return {
          imagen: primeraImagen(info.backdrop_path),
          sinopsis: info.plot?.trim() || null,
          reparto: info.cast?.trim() || null,
          genero: info.genre?.trim() || null,
        };
      }),
    opciones,
  );

  const deSeries = await elegir(
    candidatasDeSerie(series, desde),
    CUANTAS,
    (candidata) =>
      juntar(candidata.panelIds, async (panelId) => {
        const info = (await cliente.seriesInfo(panelId)).info;
        if (!info) return null;
        return {
          imagen: primeraImagen(info.backdrop_path),
          sinopsis: info.plot?.trim() || null,
          reparto: info.cast?.trim() || null,
          genero: info.genre?.trim() || null,
        };
      }),
    opciones,
  );

  /*
    Y los géneros de las que van a salir en los carruseles del inicio: lo
    último que ha entrado y lo mejor valorado, que es exactamente lo que pinta
    el aparato. Se calculan con el mismo criterio a los dos lados, así que
    coinciden casi siempre; lo que no coincida sale sin género y ya está.
  */
  const generos = await averiguarGeneros(cliente, peliculas, dePeliculas);

  return { version: VERSION, portadas: [...dePeliculas, ...deSeries], generos };
}

/**
 * El género de las películas que llenan el inicio.
 *
 * Las que ya se preguntaron para la portada no se vuelven a preguntar: su
 * ficha ya trajo el género.
 */
async function averiguarGeneros(
  cliente: XtreamClient,
  peliculas: XtreamVodStream[],
  yaSabidas: Portada[],
): Promise<Genero[]> {
  const generos = new Map<string, string>();
  for (const portada of yaSabidas) {
    if (portada.genero) generos.set(portada.id, portada.genero);
  }

  const fichas = peliculas.map((stream) => {
    const parsed = parseName(stream.name);
    const titulo = parsed.title || stream.name;
    const anio = Number(stream.year) || parsed.year || null;
    return {
      id: slug(`${titulo}-${anio ?? ''}`),
      panelId: stream.stream_id,
      titulo,
      anio,
      entrada: Number(stream.added) || 0,
      valoracion: nota(stream.rating) ?? 0,
      // La clave con la que ordena el aparato cuando hay empate.
      clave: fold(titulo),
    };
  });

  /*
    Ordenado **igual que lo ordena el aparato**, desempate incluido
    (`added DESC, sort_title` y `rating DESC, sort_title`). No es un detalle:
    hay cientos de películas con un 10 pelado, y sin el mismo desempate cada
    lado se queda con un puñado distinto de ellas. El aparato acaba pidiendo
    géneros que nadie ha averiguado.
  */
  const recientes = [...fichas]
    .sort((a, b) => b.entrada - a.entrada || a.clave.localeCompare(b.clave))
    .slice(0, CON_GENERO);
  // Y las de la fila de recomendadas, con el mismo criterio que el aparato:
  // filtradas por `esRecomendable` y ordenadas por año, entrada y nota.
  const recomendadas = fichas
    .filter((ficha) => esRecomendable(ficha.titulo, ficha.valoracion))
    .sort(
      (a, b) =>
        (b.anio ?? 0) - (a.anio ?? 0) ||
        b.entrada - a.entrada ||
        b.valoracion - a.valoracion ||
        a.clave.localeCompare(b.clave),
    )
    .slice(0, CON_GENERO);

  for (const ficha of [...recientes, ...recomendadas]) {
    if (generos.has(ficha.id)) continue;
    // Se marca antes de preguntar: si el panel no da género, tampoco hay que
    // volver a preguntar por ella al llegarnos por la otra lista.
    generos.set(ficha.id, '');
    try {
      const genero = (await cliente.vodInfo(ficha.panelId)).info?.genre?.trim();
      if (genero) generos.set(ficha.id, genero);
    } catch {
      // Una película sin género no rompe nada: la ficha sale sin él.
    }
  }

  return [...generos].filter(([, genero]) => genero).map(([id, genero]) => ({ id, genero }));
}

interface Candidata {
  clase: 'pelicula' | 'serie';
  id: string;
  /**
   * Todas las entradas del panel de este título.
   *
   * El proveedor manda una por calidad y **no todas traen lo mismo**: hay
   * variantes con imagen y sin sinopsis. Se prueban en orden hasta juntar las
   * dos, que es lo que hace también el aparato cuando pregunta por su cuenta.
   */
  panelIds: number[];
  titulo: string;
  anio: number | null;
  valoracion: number | null;
  /** Cuándo entró en el catálogo, en segundos de época. */
  entrada: number;
}

/**
 * El orden de lo recomendado: año, luego lo último que entró, luego la nota.
 *
 * El mismo que usa el aparato en su SQL. La nota va la última porque en esta
 * lista está inflada: sirve para descartar —eso lo hace `esRecomendable`— y no
 * para ordenar.
 */
function porOrden(a: Candidata, b: Candidata): number {
  return (
    (b.anio ?? 0) - (a.anio ?? 0) || b.entrada - a.entrada || (b.valoracion ?? 0) - (a.valoracion ?? 0)
  );
}

/** Cuántas variantes se prueban antes de darse por satisfecho. */
const VARIANTES = 3;

interface Datos {
  imagen: string | null;
  sinopsis: string | null;
  reparto: string | null;
  genero: string | null;
}

/** Junta lo que traigan las variantes de un título, hasta tener lo que hace falta. */
async function juntar(ids: number[], pedir: (panelId: number) => Promise<Datos | null>): Promise<Datos | null> {
  let junto: Datos = { imagen: null, sinopsis: null, reparto: null, genero: null };

  for (const panelId of ids.slice(0, VARIANTES)) {
    let traido: Datos | null = null;
    try {
      traido = await pedir(panelId);
    } catch {
      continue;
    }
    if (!traido) continue;

    junto = {
      imagen: junto.imagen ?? traido.imagen,
      sinopsis: junto.sinopsis ?? traido.sinopsis,
      reparto: junto.reparto ?? traido.reparto,
      genero: junto.genero ?? traido.genero,
    };
    // Con imagen y sinopsis ya está: preguntar más son peticiones de balde.
    if (junto.imagen && junto.sinopsis) break;
  }

  return junto.imagen ? junto : null;
}

function nota(valor: string | undefined): number | null {
  const numero = Number(valor);
  return Number.isFinite(numero) && numero > 0 ? numero : null;
}

function primeraImagen(lista: string[] | undefined): string | null {
  return lista?.find((una) => typeof una === 'string' && una.trim()) ?? null;
}

function candidatasDePelicula(streams: XtreamVodStream[], desde: number): Candidata[] {
  // El proveedor manda una entrada por calidad: se agrupan por identidad y se
  // guardan todas, que es de donde salen las variantes que se prueban.
  const porTitulo = new Map<string, Candidata>();

  for (const stream of streams) {
    const parsed = parseName(stream.name);
    const titulo = parsed.title || stream.name;
    const anio = Number(stream.year) || parsed.year || null;
    if (anio === null || anio < desde) continue;

    const valoracion = nota(stream.rating);
    if (!esRecomendable(titulo, valoracion)) continue;

    const id = slug(`${titulo}-${anio}`);
    const ya = porTitulo.get(id);
    if (ya) {
      if (!ya.panelIds.includes(stream.stream_id)) ya.panelIds.push(stream.stream_id);
      continue;
    }
    porTitulo.set(id, {
      clase: 'pelicula',
      id,
      panelIds: [stream.stream_id],
      titulo,
      anio,
      valoracion,
      entrada: Number(stream.added) || 0,
    });
  }

  return [...porTitulo.values()].sort(porOrden).slice(0, CANDIDATAS);
}

function candidatasDeSerie(fichas: XtreamSeries[], desde: number): Candidata[] {
  // Aquí la repetición no es por calidad sino por categoría: el proveedor
  // reparte la misma serie entre varias y cada una trae su identificador.
  const porTitulo = new Map<string, Candidata>();

  for (const ficha of fichas) {
    const parsed = parseName(ficha.name);
    const titulo = parsed.title || ficha.name;
    const anio = Number((ficha.releaseDate ?? '').slice(0, 4)) || parsed.year || null;
    if (anio === null || anio < desde) continue;

    const valoracion = nota(ficha.rating);
    if (!esRecomendable(titulo, valoracion)) continue;

    const id = slug(`${titulo}-${anio}`);
    const ya = porTitulo.get(id);
    if (ya) {
      if (!ya.panelIds.includes(ficha.series_id)) ya.panelIds.push(ficha.series_id);
      continue;
    }
    porTitulo.set(id, {
      clase: 'serie',
      id,
      panelIds: [ficha.series_id],
      titulo,
      anio,
      valoracion,
      // En series no hay `added`: lo que sube es `last_modified`, que además
      // se mueve cuando le añaden episodios. Para "lo último" viene mejor.
      entrada: Number(ficha.last_modified) || 0,
    });
  }

  return [...porTitulo.values()].sort(porOrden).slice(0, CANDIDATAS);
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
  ficha: (candidata: Candidata) => Promise<Datos | null>,
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
