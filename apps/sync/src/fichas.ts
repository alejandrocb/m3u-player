/**
 * La ficha larga de películas y series, averiguada poco a poco.
 *
 * `get_vod_streams` trae título, cartel, nota y año, y **nada más**: el
 * género, la sinopsis, el reparto, la imagen apaisada y el tráiler están en
 * `get_vod_info`, que es una petición por película. Con 18.042 en la lista
 * real, preguntarlas todas de una vez no es una opción —ni por tiempo ni por
 * educación con el proveedor—, así que el servidor va rellenando un puñado al
 * día y lo guarda para siempre.
 *
 * Por eso hace falta saber **qué ya se preguntó**: se apunta también lo que el
 * panel dejó en blanco, o cada pasada volvería a preguntar por las mismas y no
 * avanzaría nunca.
 *
 * El orden es por lo último que ha entrado, que es lo que la gente mira antes
 * y lo que llena los carruseles del inicio: así la mejora se nota desde el
 * primer día en vez de al final del recorrido.
 *
 * **Se pregunta a dos sitios, en este orden.** Primero a TMDb, que no limita
 * conexiones y devuelve una lista cerrada de géneros en español; lo que no
 * sepa o no case por título, al panel, que de su propio catálogo sabe más que
 * nadie. Sin token de TMDb queda solo el panel, que es como empezó esto.
 *
 * **De las series no se pregunta al panel.** Su ficha está en
 * `get_series_info`, que devuelve además la lista entera de episodios: pedirla
 * 6.500 veces por una sinopsis sería bajarse el catálogo de capítulos completo
 * para tirarlo. Su género, además, ya viene con el catálogo.
 */

import { fold, parseName, slug } from '@m3u/core';
import { XtreamClient, credentialsFromUrl } from '@m3u/core/xtream';
import type { XtreamSeries, XtreamVodStream } from '@m3u/core/xtream';

import type { ClaseTmdb, Tmdb } from './tmdb.ts';

/**
 * Cuántas se preguntan a la vez.
 *
 * TMDb aguanta de sobra y el panel las contesta como cualquier otra petición
 * de su API —no son conexiones de vídeo—, pero tampoco hay prisa: de cinco en
 * cinco, el catálogo entero sale en una tarde sin que nadie se queje.
 */
const A_LA_VEZ = 5;

/** Lo que se averigua de una ficha. Puede venir todo vacío. */
export interface FichaAveriguada {
  id: string;
  clase: ClaseTmdb;
  genero: string;
  sinopsis?: string;
  reparto?: string;
  fondo?: string;
  trailer?: string;
}

export interface OpcionesFichas {
  /** Lo ya preguntado, con respuesta o sin ella: no se vuelve a preguntar. */
  conocidas: Set<string>;
  /** Cuántas se preguntan en esta pasada. */
  cuantas: number;
  /** TMDb, si hay token. Sin él se pregunta solo al panel. */
  tmdb?: Tmdb;
  /**
   * Se avisa nada más saber cuántas quedan, antes de empezar a preguntar.
   *
   * Una pasada tarda varios minutos y quien mira el registro necesita saber
   * que ha empezado: sin esto, lo único que se ve es un servidor callado, y
   * eso no se distingue de que algo vaya mal.
   */
  avisar?: (pendientes: number, deEstaVez: number) => void;
  fetch?: typeof globalThis.fetch;
}

/**
 * La nota del panel, que llega como texto y a veces sobre cinco.
 *
 * Copiado de `portadas.ts` a propósito: aquí solo hace falta para desempatar
 * el orden, y compartirlo obligaría a exportar media docena de ayudantes.
 */
function comoFicha(stream: XtreamVodStream): Candidata {
  const parsed = parseName(stream.name);
  const titulo = parsed.title || stream.name;
  const anio = Number(stream.year) || parsed.year || null;
  return {
    id: slug(`${titulo}-${anio ?? ''}`),
    clase: 'pelicula',
    panelId: stream.stream_id,
    titulo,
    anio,
    entrada: Number(stream.added) || 0,
    clave: fold(titulo),
  };
}

/**
 * Lo mismo para una serie.
 *
 * Las series no traen `added` sino `last_modified`, que sube cuando les añaden
 * episodios: para "lo último que ha entrado" viene incluso mejor.
 */
function comoFichaDeSerie(serie: XtreamSeries): Candidata {
  const parsed = parseName(serie.name);
  const titulo = parsed.title || serie.name;
  const anio = Number(serie.releaseDate?.slice(0, 4)) || parsed.year || null;
  return {
    id: slug(`${titulo}-${anio ?? ''}`),
    clase: 'serie',
    panelId: serie.series_id,
    titulo,
    anio,
    entrada: Number(serie.last_modified) || 0,
    clave: fold(titulo),
  };
}

interface Candidata {
  id: string;
  clase: ClaseTmdb;
  panelId: number;
  /** El título limpio, sin calidad ni códec: es con lo que se busca en TMDb. */
  titulo: string;
  anio: number | null;
  entrada: number;
  clave: string;
}

/**
 * La ficha de una película según el panel.
 *
 * Trae lo mismo que TMDb salvo que el género es texto libre y la imagen
 * apaisada llega en una lista, que a veces está vacía y a veces trae el cartel
 * vertical. El tráiler puede venir como identificador pelado o como URL
 * entera, y aquí se guarda el identificador, que es lo que abre YouTube.
 */
async function delPanel(
  cliente: XtreamClient,
  panelId: number,
): Promise<{ genero: string; sinopsis?: string; reparto?: string; fondo?: string; trailer?: string }> {
  const info = (await cliente.vodInfo(panelId)).info;
  const trailer = info?.youtube_trailer?.trim();

  return {
    genero: info?.genre?.trim() ?? '',
    sinopsis: info?.plot?.trim() || undefined,
    reparto: info?.cast?.trim() || undefined,
    fondo: info?.backdrop_path?.[0]?.trim() || undefined,
    trailer: (trailer ? (trailer.match(/[\w-]{11}$/)?.[0] ?? trailer) : undefined) || undefined,
  };
}

/** Recorre en tandas, para no ir de una en una ni soltarlas todas de golpe. */
async function enTandas<T, R>(cosas: T[], cuantas: number, hacer: (cosa: T) => Promise<R>): Promise<R[]> {
  const hechas: R[] = [];
  for (let desde = 0; desde < cosas.length; desde += cuantas) {
    hechas.push(...(await Promise.all(cosas.slice(desde, desde + cuantas).map(hacer))));
  }
  return hechas;
}

/**
 * Pregunta por la ficha de unas cuantas que aún no la tengan.
 *
 * Devuelve también aquellas de las que nadie supo nada, vacías: es lo que
 * permite marcarlas como preguntadas y no volver sobre ellas.
 */
export async function rellenarFichas(
  url: string,
  opciones: OpcionesFichas,
): Promise<FichaAveriguada[]> {
  const credenciales = credentialsFromUrl(url);
  if (!credenciales) throw new Error('la URL de la lista no lleva usuario y contraseña');
  if (opciones.cuantas <= 0) return [];

  const cliente = new XtreamClient(credenciales, { fetch: opciones.fetch, timeoutMs: 30_000 });
  const [peliculas, series] = await Promise.all([
    cliente.vodStreams().catch(() => [] as XtreamVodStream[]),
    // Las series solo si hay TMDb: al panel no se le pregunta por ellas.
    opciones.tmdb ? cliente.series().catch(() => [] as XtreamSeries[]) : Promise.resolve([] as XtreamSeries[]),
  ]);

  /*
    Lo más reciente primero, con el mismo desempate que usa el aparato para
    ordenar: así lo que se rellena es justo lo que se está mirando.

    `Array.isArray` no sobra: un panel de mal humor contesta con un objeto de
    error donde debería ir la lista, y sin esto la pasada entera revienta con
    un "map is not a function" en vez de saltarse esa lista.
  */
  const ordenadas = [
    ...(Array.isArray(peliculas) ? peliculas.map(comoFicha) : []),
    ...(Array.isArray(series) ? series.map(comoFichaDeSerie) : []),
  ]
    .filter((ficha) => !opciones.conocidas.has(ficha.id))
    .sort((a, b) => b.entrada - a.entrada || a.clave.localeCompare(b.clave));

  /*
    Las calidades se juntan **antes** de repartir el presupuesto, no después.
    Una misma película viene dos o tres veces con el mismo identificador, así
    que contando entradas en vez de películas la pasada de quinientas se
    quedaba en la mitad y el recorrido duraría el doble.
  */
  const sinFicha = new Map<string, Candidata>();
  for (const ficha of ordenadas) if (!sinFicha.has(ficha.id)) sinFicha.set(ficha.id, ficha);

  const pendientes = new Map([...sinFicha].slice(0, opciones.cuantas));

  opciones.avisar?.(sinFicha.size, pendientes.size);

  const averiguadas = await enTandas([...pendientes.values()], A_LA_VEZ, async (ficha) => {
    try {
      /*
        TMDb primero: no gasta conexiones del proveedor y escribe los géneros
        siempre igual. Lo que no reconozca —títulos raros del proveedor, cine
        muy local— se lo acaba contestando el panel.
      */
      const deTmdb = opciones.tmdb
        ? await opciones.tmdb.fichaDe(ficha.titulo, ficha.anio, ficha.clase).catch(() => null)
        : null;
      if (deTmdb) return { id: ficha.id, clase: ficha.clase, ...deTmdb };

      // De una serie no se le pregunta al panel: su ficha viene con la lista
      // entera de episodios detrás.
      if (ficha.clase === 'serie') return { id: ficha.id, clase: ficha.clase, genero: '' };

      return { id: ficha.id, clase: ficha.clase, ...(await delPanel(cliente, ficha.panelId)) };
    } catch {
      // Un fallo suelto no interrumpe la pasada, pero tampoco se apunta: se
      // volverá a intentar mañana, que quizá el panel esté de mejor humor.
      return null;
    }
  });

  return averiguadas.filter((una): una is FichaAveriguada => una !== null);
}
