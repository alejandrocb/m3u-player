/**
 * La misma película dos veces porque a una le falta el año.
 *
 * La identidad de una película es **título más año**, que es lo que permite
 * distinguir los cuatro *Robin Hood*. La contrapartida es que el proveedor
 * manda la misma película escrita de las dos formas —*He-Man y los Masters del
 * Universo* y *He-Man y los Masters del Universo (2021)*— y salen dos fichas,
 * con la misma carátula, una al lado de la otra.
 *
 * Aquí se decide **qué pares son la misma**, que es la parte delicada; juntar
 * los campos lo hace quien llama, que es quien sabe si son películas o series.
 *
 * La regla es prudente a propósito: la que no lleva año se funde con la que sí
 * **solo si hay una sola candidata**. Con dos —*Robin Hood (2018)* y *Robin
 * Hood (2010)*— no hay forma de saber de cuál de las dos es la suelta, y
 * meterla en la equivocada es peor que dejar el duplicado: el duplicado se ve
 * y se entiende, y lo otro es una ficha que lleva a otra película.
 */

import { slug } from './normalize.ts';

export interface ConAnio {
  id: string;
  title: string;
  year: number | null;
}

/** Los pares a juntar: la ficha sin año y aquella de la que es. */
export function duplicadasSinAnio<T extends ConAnio>(fichas: Iterable<T>): Array<{ suelta: T; destino: T }> {
  const todas = [...fichas];

  const conAnio = new Map<string, T[]>();
  for (const ficha of todas) {
    if (ficha.year === null) continue;
    const clave = slug(ficha.title);
    const mismas = conAnio.get(clave);
    if (mismas) mismas.push(ficha);
    else conAnio.set(clave, [ficha]);
  }

  const parejas: Array<{ suelta: T; destino: T }> = [];
  for (const suelta of todas) {
    if (suelta.year !== null) continue;
    const candidatas = conAnio.get(slug(suelta.title));
    if (candidatas?.length !== 1) continue;
    parejas.push({ suelta, destino: candidatas[0]! });
  }

  return parejas;
}
