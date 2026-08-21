/**
 * La programación de los canales, pedida al panel según hace falta.
 *
 * No se guarda con el catálogo a propósito: caduca cada pocos minutos y
 * ocuparía más que la biblioteca entera. Medido contra el panel real,
 * `get_short_epg` son 3,4 KB por canal —seis programas— y
 * `get_simple_data_table` 186 KB para ese mismo canal, con la semana completa.
 * Con una lista de canales y el foco moviéndose, solo el primero es viable.
 *
 * Se cachea en memoria mientras dure la sesión: recorrer la lista arriba y
 * abajo no puede convertirse en una petición por pulsación. Media hora es
 * margen de sobra, porque lo que se enseña son programas de una o dos horas.
 */

import { programasDesde, streamIdDeUrl } from '@m3u/core';
import type { Programa } from '@m3u/core';
import type { XtreamClient } from '@m3u/core/xtream';
import type { Biblioteca, Programacion } from '@m3u/ui';

/** Cuánto vale lo ya pedido. Un programa dura más que esto. */
const FRESCURA_MS = 30 * 60 * 1000;

/** Cuántos programas se piden: el actual y unos cuantos por delante. */
const CUANTOS = 8;

interface Guardado {
  programas: Programa[];
  pedido: number;
}

export function programacionDelPanel(
  cliente: XtreamClient | null,
  biblioteca: Biblioteca,
): Programacion {
  const cache = new Map<string, Guardado>();
  /** Peticiones en vuelo, para que dos focos seguidos no pidan lo mismo. */
  const enCurso = new Map<string, Promise<Programa[]>>();

  const pedir = async (canalId: string): Promise<Programa[]> => {
    if (!cliente) return [];

    // El `stream_id` no está en la biblioteca: vive dentro de la URL.
    const variantes = await biblioteca.variantes('canal', canalId);
    const streamId = variantes[0] ? streamIdDeUrl(variantes[0].url) : null;
    if (!streamId) return [];

    const respuesta = await cliente.shortEpg(streamId, CUANTOS);
    return programasDesde(respuesta?.epg_listings);
  };

  return {
    async deCanal(canalId: string): Promise<Programa[]> {
      const guardado = cache.get(canalId);
      if (guardado && Date.now() - guardado.pedido < FRESCURA_MS) return guardado.programas;

      const yaPedido = enCurso.get(canalId);
      if (yaPedido) return yaPedido;

      const peticion = pedir(canalId)
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
