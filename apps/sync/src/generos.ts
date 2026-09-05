/**
 * El género de las películas, averiguado poco a poco.
 *
 * `get_vod_streams` trae título, cartel, nota y año, y **el género no**: está
 * en `get_vod_info`, que es una petición por película. Con 18.042 en la lista
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
 */

import { fold, parseName, slug } from '@m3u/core';
import { XtreamClient, credentialsFromUrl } from '@m3u/core/xtream';
import type { XtreamVodStream } from '@m3u/core/xtream';

/** Lo que se averigua de una película. El género puede venir vacío. */
export interface GeneroAveriguado {
  id: string;
  genero: string;
}

export interface OpcionesGeneros {
  /** Lo ya preguntado, con género o sin él: no se vuelve a preguntar. */
  conocidas: Set<string>;
  /** Cuántas se preguntan en esta pasada. */
  cuantas: number;
  fetch?: typeof globalThis.fetch;
}

/**
 * La nota del panel, que llega como texto y a veces sobre cinco.
 *
 * Copiado de `portadas.ts` a propósito: aquí solo hace falta para desempatar
 * el orden, y compartirlo obligaría a exportar media docena de ayudantes.
 */
function comoFicha(stream: XtreamVodStream): { id: string; panelId: number; entrada: number; clave: string } {
  const parsed = parseName(stream.name);
  const titulo = parsed.title || stream.name;
  const anio = Number(stream.year) || parsed.year || null;
  return {
    id: slug(`${titulo}-${anio ?? ''}`),
    panelId: stream.stream_id,
    entrada: Number(stream.added) || 0,
    clave: fold(titulo),
  };
}

/**
 * Pregunta por el género de unas cuantas películas que aún no lo tengan.
 *
 * Devuelve también las que el panel no supo contestar, con el género vacío:
 * es lo que permite marcarlas como preguntadas y no volver sobre ellas.
 */
export async function rellenarGeneros(
  url: string,
  opciones: OpcionesGeneros,
): Promise<GeneroAveriguado[]> {
  const credenciales = credentialsFromUrl(url);
  if (!credenciales) throw new Error('la URL de la lista no lleva usuario y contraseña');
  if (opciones.cuantas <= 0) return [];

  const cliente = new XtreamClient(credenciales, { fetch: opciones.fetch, timeoutMs: 30_000 });
  const peliculas = await cliente.vodStreams().catch(() => [] as XtreamVodStream[]);

  /*
    Lo más reciente primero, con el mismo desempate que usa el aparato para
    ordenar: así lo que se rellena es justo lo que se está mirando.
  */
  const ordenadas = peliculas
    .map(comoFicha)
    .filter((ficha) => !opciones.conocidas.has(ficha.id))
    .sort((a, b) => b.entrada - a.entrada || a.clave.localeCompare(b.clave));

  /*
    Las calidades se juntan **antes** de repartir el presupuesto, no después.
    Una misma película viene dos o tres veces con el mismo identificador, así
    que contando entradas en vez de películas la pasada de quinientas se
    quedaba en la mitad y el recorrido duraría el doble.
  */
  const pendientes = new Map<string, (typeof ordenadas)[number]>();
  for (const ficha of ordenadas) {
    if (!pendientes.has(ficha.id)) pendientes.set(ficha.id, ficha);
    if (pendientes.size >= opciones.cuantas) break;
  }

  const averiguadas: GeneroAveriguado[] = [];
  for (const ficha of pendientes.values()) {
    try {
      const genero = (await cliente.vodInfo(ficha.panelId)).info?.genre?.trim() ?? '';
      averiguadas.push({ id: ficha.id, genero });
    } catch {
      // Un fallo suelto no interrumpe la pasada, pero tampoco se apunta: se
      // volverá a intentar mañana, que quizá el panel esté de mejor humor.
    }
  }

  return averiguadas;
}
