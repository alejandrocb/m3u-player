/**
 * Los temas: el género de verdad de una película o una serie.
 *
 * No es lo mismo que la categoría del proveedor. La categoría es dónde ha
 * colocado él la ficha en su lista —"PELICULAS ACCION", "TV Series NETFLIX"—
 * y el tema es de qué va: drama, comedia, documental. El panel lo manda en un
 * solo campo y con varios dentro, separados como le parece:
 *
 *     "Drama, Romance"      "Acción / Aventura"      "Comedia"
 *
 * Así que hay que partirlo. Y hay que juntar las escrituras que dicen lo
 * mismo, que el panel manda "Ciencia ficción", "Ciencia Ficción" y
 * "CIENCIA FICCION" para las mismas películas: sin eso salen tres filas con
 * el mismo contenido repartido.
 */

import { fold } from './normalize.ts';

/** Un tema y cuántas fichas lo llevan. */
export interface Tema {
  nombre: string;
  fichas: number;
}

/**
 * Lo que no es un tema aunque venga en ese campo.
 *
 * El panel rellena el hueco con lo que sea cuando no lo sabe, y esas palabras
 * acabarían siendo una fila del inicio.
 */
const NO_SON_TEMAS = new Set(['n/a', 'na', 'sin genero', 'desconocido', 'otros', 'varios', '-']);

/** Los temas que lleva una ficha, ya partidos y limpios. */
export function temasDe(genero: string | null | undefined): string[] {
  if (!genero) return [];

  const partes = genero
    .split(/[,/|;&]|\bY\b/i)
    .map((parte) => parte.trim().replace(/\s+/g, ' '))
    .filter((parte) => parte.length > 1 && !NO_SON_TEMAS.has(fold(parte)));

  // Sin repetidos dentro de la misma ficha: "Drama, drama" cuenta una vez.
  const vistos = new Set<string>();
  return partes.filter((parte) => {
    const clave = fold(parte);
    if (vistos.has(clave)) return false;
    vistos.add(clave);
    return true;
  });
}

/**
 * Cuenta los temas de un montón de fichas agrupadas por su cadena de género.
 *
 * Se le pasa lo que devuelve un `GROUP BY genre` —cada cadena distinta con
 * cuántas fichas la llevan— y no fila a fila: las cadenas distintas son unos
 * cientos y las fichas dieciocho mil.
 *
 * El nombre que sale es **el más frecuente** de los que dicen lo mismo, que es
 * casi siempre el que está bien escrito: las mayúsculas a gritos y los
 * despistes sin tilde son minoría.
 */
export function contarTemas(agrupados: Array<{ genero: string; fichas: number }>): Tema[] {
  const cuenta = new Map<string, { fichas: number; nombres: Map<string, number> }>();

  for (const { genero, fichas } of agrupados) {
    for (const tema of temasDe(genero)) {
      const clave = fold(tema);
      const junto = cuenta.get(clave) ?? { fichas: 0, nombres: new Map() };
      junto.fichas += fichas;
      junto.nombres.set(tema, (junto.nombres.get(tema) ?? 0) + fichas);
      cuenta.set(clave, junto);
    }
  }

  return [...cuenta.values()]
    .map(({ fichas, nombres }) => ({
      nombre: [...nombres.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]![0],
      fichas,
    }))
    .sort((a, b) => b.fichas - a.fichas || a.nombre.localeCompare(b.nombre));
}
