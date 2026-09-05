/**
 * TMDb: el género de una película, buscándola por título y año.
 *
 * El panel sabe el género de casi todo lo suyo —el 97 % de lo que se le
 * pregunta—, pero cuesta una petición por título y hay que ir con cuidado con
 * sus conexiones. TMDb no tiene ese problema y además devuelve **una lista
 * cerrada de géneros** en español: "Ciencia ficción" siempre se escribe igual,
 * que es justo lo que hace falta para que las filas del inicio salgan limpias.
 * Del panel viene texto libre, y por eso hubo que juntar a mano las tres
 * formas de escribir lo mismo.
 *
 * Lo difícil no es pedir el dato, es **casar nuestra película con la suya**. El
 * proveedor escribe los títulos como le parece, así que se busca por título y
 * año y se exige que el título cuadre: ante la duda, mejor quedarse sin género
 * que ponerle a una película el de otra. Lo que no case se le acaba
 * preguntando al panel, que de su propio catálogo sabe más que nadie.
 *
 * La clave no está en el repositorio: la lee el servidor de la variable
 * `TMDB_TOKEN`, que se pone en un fichero del VPS. Va en la cabecera y no en
 * la dirección, para que no acabe escrita en ningún registro.
 */

import { fold } from '@m3u/core';

const RAIZ = 'https://api.themoviedb.org/3';

/** En español, que es lo que se pinta en las filas. */
const IDIOMA = 'es-ES';

/** Cuánto se espera si TMDb pide calma, antes del único reintento. */
const ESPERA_MS = 1_000;

/**
 * Cuánto se espera a una respuesta antes de darla por perdida.
 *
 * `fetch` no trae plazo por su cuenta: sin esto, una petición que se quede
 * colgada deja la pasada entera parada para siempre, y por fuera solo se ve
 * un servidor callado. Perder una película no cuesta nada, se pregunta
 * mañana.
 */
const PLAZO_MS = 15_000;

interface Resultado {
  title?: string;
  original_title?: string;
  release_date?: string;
  genre_ids?: number[];
}

export interface Tmdb {
  /**
   * El género de una película, o cadena vacía si no se sabe.
   *
   * Vacío significa "TMDb no la conoce o no me fío de la coincidencia", y es
   * lo que hace que se le pregunte al panel a continuación.
   */
  generoDe(titulo: string, anio: number | null): Promise<string>;
}

/** ¿Dicen lo mismo los dos títulos, mirando solo las letras? */
function casan(uno: string | undefined, otro: string): boolean {
  return uno !== undefined && fold(uno) === fold(otro);
}

/** El año de una fecha de estreno de TMDb ("2018-09-21"). */
function anioDe(fecha: string | undefined): number | null {
  const anio = Number(fecha?.slice(0, 4));
  return Number.isFinite(anio) && anio > 1800 ? anio : null;
}

export function crearTmdb(token: string, opciones: { fetch?: typeof globalThis.fetch } = {}): Tmdb {
  const buscar = opciones.fetch ?? globalThis.fetch;

  /*
    Los nombres de los géneros se piden una sola vez: la búsqueda devuelve
    números —28, 35, 18— y la lista que los traduce cambia una vez cada varios
    años.
  */
  let nombres: Promise<Map<number, string>> | null = null;

  async function pedir(ruta: string): Promise<Record<string, unknown> | null> {
    for (let intento = 0; intento < 2; intento += 1) {
      const respuesta = await buscar(`${RAIZ}${ruta}`, {
        headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
        signal: AbortSignal.timeout(PLAZO_MS),
      });

      // 429 es "vas muy rápido", no un fallo: se espera y se repite una vez.
      if (respuesta.status === 429 && intento === 0) {
        await new Promise((sigue) => setTimeout(sigue, ESPERA_MS));
        continue;
      }
      if (!respuesta.ok) return null;
      return (await respuesta.json()) as Record<string, unknown>;
    }
    return null;
  }

  function tabla(): Promise<Map<number, string>> {
    /*
      Se guarda la promesa y no el resultado: las películas se preguntan de
      cinco en cinco, así que las cinco primeras llegan aquí a la vez y con el
      resultado a secas las cinco pedirían la lista.
    */
    nombres ??= (async () => {
      const datos = await pedir(`/genre/movie/list?language=${IDIOMA}`);
      const lista = (datos?.genres as Array<{ id: number; name: string }> | undefined) ?? [];
      return new Map(lista.map((genero) => [genero.id, genero.name]));
    })();
    return nombres;
  }

  /** El resultado en el que se puede confiar, si hay alguno. */
  function elMejor(resultados: Resultado[], titulo: string, anio: number | null): Resultado | null {
    const porTitulo = resultados.find(
      (uno) => casan(uno.title, titulo) || casan(uno.original_title, titulo),
    );
    if (porTitulo) return porTitulo;

    /*
      Sin coincidencia de título solo se acepta una cosa: que la búsqueda
      llevara año y haya devuelto **un único** candidato. Con dos ya no se sabe
      cuál es, y ponerle a una película el género de otra es peor que dejarla
      sin género.
    */
    if (anio !== null && resultados.length === 1) return resultados[0] ?? null;
    return null;
  }

  return {
    async generoDe(titulo: string, anio: number | null): Promise<string> {
      const limpio = titulo.trim();
      if (!limpio) return '';

      const consulta = `query=${encodeURIComponent(limpio)}&language=${IDIOMA}&include_adult=false`;

      // Con el año primero, que es lo que distingue los cuatro "Robin Hood".
      let datos = anio !== null ? await pedir(`/search/movie?${consulta}&year=${anio}`) : null;
      let resultados = (datos?.results as Resultado[] | undefined) ?? [];
      let elegido = elMejor(resultados, limpio, anio);

      if (!elegido) {
        // Y si no, sin año, pero entonces el título tiene que cuadrar y el año
        // no puede andar lejos: las reposiciones y los remontajes cambian de
        // fecha por uno o dos, no por veinte.
        datos = await pedir(`/search/movie?${consulta}`);
        resultados = (datos?.results as Resultado[] | undefined) ?? [];
        const cerca = resultados.filter((uno) => {
          const suyo = anioDe(uno.release_date);
          return anio === null || suyo === null || Math.abs(suyo - anio) <= 2;
        });
        elegido = cerca.find((uno) => casan(uno.title, limpio) || casan(uno.original_title, limpio)) ?? null;
      }
      if (!elegido) return '';

      const nombresDe = await tabla();
      return (elegido.genre_ids ?? [])
        .map((id) => nombresDe.get(id))
        .filter((nombre): nombre is string => nombre !== undefined)
        .join(', ');
    },
  };
}
