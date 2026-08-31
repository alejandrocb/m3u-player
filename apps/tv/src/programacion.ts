/**
 * La programación de los canales, por dos caminos y en este orden.
 *
 * 1. **La parrilla que prepara el servidor de la casa.** Se trae el EPG entero
 *    del panel una vez y manda el resumen: lo que echan ahora y lo siguiente
 *    en cada canal. Son decenas de kilobytes en **una sola petición**, así que
 *    con eso puesto la parrilla aparece al instante y sin preguntar nada al
 *    panel.
 * 2. **El panel, canal a canal**, para lo que el servidor no tenga: casas sin
 *    servidor, un servidor que aún no ha preparado esa lista, o un canal que
 *    no salía en el EPG cuando se preparó. Medido, `get_short_epg` son 3,4 KB
 *    por canal —seis programas— frente a los 186 KB de
 *    `get_simple_data_table`, que trae la semana entera; con el foco
 *    moviéndose, solo el primero es viable.
 *
 * Lo pedido al panel se cachea en memoria mientras dure la sesión: recorrer la
 * lista arriba y abajo no puede convertirse en una petición por pulsación.
 * Media hora es margen de sobra, porque lo que se enseña son programas de una
 * o dos horas.
 *
 * **Un canal sin programación no es un fallo.** En la lista real, 272 de los
 * 463 canales no traen `tvg-id` —los de eventos: NBA, NFL, jornadas de liga—
 * y no tienen EPG por ninguno de los dos caminos. La ficha tiene que quedar
 * bien sin ella.
 */

import { idDeCanalPorTvg, programasDesde, streamIdDeUrl } from '@m3u/core';
import type { Programa } from '@m3u/core';
import type { XtreamClient } from '@m3u/core/xtream';
import type { Biblioteca, Programacion, ProgramaRemoto } from '@m3u/ui';

/** Cuánto vale lo ya pedido al panel. Un programa dura más que esto. */
const FRESCURA_MS = 30 * 60 * 1000;

/**
 * Cuánto vale la parrilla del servidor.
 *
 * Menos que lo del panel porque aquí no cuesta una petición por canal: es una
 * sola para todos, y así lo que se enseña no se queda atrás cuando termina un
 * programa.
 */
const FRESCURA_SERVIDOR_MS = 10 * 60 * 1000;

/** Cuántos programas se piden al panel: el actual y unos cuantos por delante. */
const CUANTOS = 8;

interface Guardado {
  programas: Programa[];
  pedido: number;
}

export interface OpcionesProgramacion {
  cliente: XtreamClient | null;
  biblioteca: Biblioteca;
  /** De dónde sale la parrilla preparada. Sin esto se pregunta solo al panel. */
  parrilla?: () => Promise<ProgramaRemoto[]>;
}

/**
 * Pasa lo que manda el servidor a la forma en que lo usa la interfaz.
 *
 * Y traduce el identificador, que es la parte que no se ve: el EPG habla de
 * `tvg-id` pelados —`La1.es`— y la biblioteca guarda sus canales como
 * `tvg:La1.es`, para que un canal sin `tvg-id` que se llamara igual no se
 * llevara por delante el historial de otro. Sin esta traducción la parrilla
 * llega entera y no casa con un solo canal, que es exactamente lo que pasó la
 * primera vez.
 */
function comoProgramas(remotos: ProgramaRemoto[]): Map<string, Programa[]> {
  const porCanal = new Map<string, Programa[]>();
  for (const remoto of remotos) {
    const desde = new Date(remoto.desde);
    const hasta = new Date(remoto.hasta);
    // Una fecha ilegible tumbaría la comparación con la hora del aparato.
    if (Number.isNaN(desde.getTime()) || Number.isNaN(hasta.getTime())) continue;

    const canalId = idDeCanalPorTvg(remoto.canal);
    const suyos = porCanal.get(canalId) ?? [];
    suyos.push({
      titulo: remoto.titulo,
      descripcion: remoto.sinopsis,
      desde,
      hasta,
    });
    porCanal.set(canalId, suyos);
  }
  for (const suyos of porCanal.values()) suyos.sort((a, b) => a.desde.getTime() - b.desde.getTime());
  return porCanal;
}

export function programacionDelPanel({
  cliente,
  biblioteca,
  parrilla,
}: OpcionesProgramacion): Programacion {
  const cache = new Map<string, Guardado>();
  /** Peticiones en vuelo, para que dos focos seguidos no pidan lo mismo. */
  const enCurso = new Map<string, Promise<Programa[]>>();

  /** La parrilla del servidor, con su hora de traída y su petición en vuelo. */
  let delServidor: Map<string, Programa[]> | null = null;
  let traida = 0;
  let trayendo: Promise<Map<string, Programa[]>> | null = null;

  const parrillaDelServidor = async (): Promise<Map<string, Programa[]>> => {
    if (!parrilla) return new Map();
    if (delServidor && Date.now() - traida < FRESCURA_SERVIDOR_MS) return delServidor;
    if (trayendo) return trayendo;

    trayendo = parrilla()
      .then((remotos) => {
        delServidor = comoProgramas(remotos);
        traida = Date.now();
        return delServidor;
      })
      .catch(() => new Map<string, Programa[]>())
      .finally(() => {
        trayendo = null;
      });

    return trayendo;
  };

  const pedirAlPanel = async (canalId: string): Promise<Programa[]> => {
    if (!cliente) return [];

    // El `stream_id` no está en la biblioteca: vive dentro de la URL.
    const variantes = await biblioteca.variantes('canal', canalId);
    const streamId = variantes[0] ? streamIdDeUrl(variantes[0].url) : null;
    if (!streamId) return [];

    const respuesta = await cliente.shortEpg(streamId, CUANTOS);
    return programasDesde(respuesta?.epg_listings);
  };

  return {
    /*
      Una fila entera: solo lo que el servidor haya preparado, sin preguntarle
      nada al panel. Con veinte canales a la vista, caer al panel sería
      veinte peticiones cada vez que se pinta la fila.
    */
    async deCanales(canalIds: string[]): Promise<Record<string, Programa[]>> {
      const preparada = await parrillaDelServidor();
      const ahora = new Date();
      const salida: Record<string, Programa[]> = {};
      for (const canalId of canalIds) {
        const suyos = preparada.get(canalId);
        // Lo que ya terminó del todo no se enseña: es peor que no enseñar
        // nada, porque parece que están echando algo que acabó hace horas.
        if (suyos?.some((programa) => programa.hasta > ahora)) salida[canalId] = suyos;
      }
      return salida;
    },

    async deCanal(canalId: string): Promise<Programa[]> {
      /*
        Primero lo preparado: si el servidor tiene este canal, no se le
        pregunta nada al panel. Se comprueba que además siga vigente —el
        resumen trae lo de ahora y lo siguiente, así que si todo lo suyo ya
        terminó es que la parrilla se ha quedado vieja— y entonces se cae al
        panel, que es quien sabe lo que hay ahora mismo.
      */
      const preparada = await parrillaDelServidor();
      const suyos = preparada.get(canalId);
      if (suyos?.length) {
        const ahora = new Date();
        if (suyos.some((programa) => programa.hasta > ahora)) return suyos;
      }

      const guardado = cache.get(canalId);
      if (guardado && Date.now() - guardado.pedido < FRESCURA_MS) return guardado.programas;

      const yaPedido = enCurso.get(canalId);
      if (yaPedido) return yaPedido;

      const peticion = pedirAlPanel(canalId)
        .then((programas) => {
          cache.set(canalId, { programas, pedido: Date.now() });
          return programas;
        })
        // Un canal sin EPG, o un panel que no responde, no puede tumbar la
        // pantalla del directo: se queda sin parrilla y ya.
        .catch(() => [])
        .finally(() => enCurso.delete(canalId));

      enCurso.set(canalId, peticion);
      return peticion;
    },
  };
}
