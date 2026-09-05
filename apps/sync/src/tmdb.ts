/**
 * TMDb: la ficha larga de una película o una serie, por título y año.
 *
 * El panel sabe el género de casi todo lo suyo —el 97 % de lo que se le
 * pregunta—, pero cuesta una petición por título y hay que ir con cuidado con
 * sus conexiones. TMDb no tiene ese problema y además devuelve **una lista
 * cerrada de géneros** en español: "Ciencia ficción" siempre se escribe igual,
 * que es justo lo que hace falta para que las filas del inicio salgan limpias.
 * Del panel viene texto libre, y por eso hubo que juntar a mano las tres
 * formas de escribir lo mismo.
 *
 * Son **dos peticiones por título**: la búsqueda, que ya trae el género, la
 * sinopsis y la imagen apaisada, y la ficha, que añade el reparto y el
 * tráiler. Se piden juntas porque quien mira una película quiere las dos
 * cosas, y volver mañana a por la mitad que falta costaría otra búsqueda.
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
  id?: number;
  /** En las series se llama `name`, y el año va en `first_air_date`. */
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  release_date?: string;
  first_air_date?: string;
  overview?: string;
  backdrop_path?: string | null;
  genre_ids?: number[];
  vote_average?: number;
  vote_count?: number;
  popularity?: number;
}

/** Lo que TMDb sabe de una ficha. Todo puede faltar. */
export interface FichaTmdb {
  genero: string;
  sinopsis?: string;
  reparto?: string;
  fondo?: string;
  trailer?: string;
  /**
   * La nota de TMDb, cuántos la han votado y su popularidad.
   *
   * Vienen en la misma respuesta de la búsqueda, así que no cuestan nada. La
   * del proveedor no sirve para ordenar —reparte dieces a mansalva y un 10
   * quiere decir que no la ha votado nadie—; con los votos delante sí se puede
   * distinguir un 8 de mil personas de un 10 de dos.
   */
  nota?: number;
  votos?: number;
  popularidad?: number;
}

export type ClaseTmdb = 'pelicula' | 'serie';

export interface Tmdb {
  /**
   * La ficha de una película o una serie, o `null` si no se sabe cuál es.
   *
   * `null` significa "TMDb no la conoce o no me fío de la coincidencia", y es
   * lo que hace que se le pregunte al panel a continuación.
   */
  fichaDe(titulo: string, anio: number | null, clase: ClaseTmdb): Promise<FichaTmdb | null>;
}

/**
 * El ancho con el que se pide la imagen apaisada.
 *
 * 1280 es de sobra para el fondo de una televisión —se pinta oscurecido y
 * detrás de un degradado— y pesa la cuarta parte que el original.
 */
const IMAGENES = 'https://image.tmdb.org/t/p/w1280';

/** Cuántos nombres del reparto se guardan. Los demás no caben en la ficha. */
const CUANTOS_ACTORES = 6;

/** ¿Dicen lo mismo los dos títulos, mirando solo las letras? */
function casan(uno: string | undefined, otro: string): boolean {
  return uno !== undefined && fold(uno) === fold(otro);
}

/**
 * El título de un resultado, que cambia de nombre entre películas y series.
 *
 * TMDb llama `title` a una película y `name` a una serie, y lo mismo con la
 * fecha. Es la única diferencia real entre las dos búsquedas.
 */
function tituloDe(uno: Resultado): string[] {
  return [uno.title, uno.name, uno.original_title, uno.original_name].filter(
    (texto): texto is string => texto !== undefined,
  );
}

function estrenoDe(uno: Resultado): string | undefined {
  return uno.release_date ?? uno.first_air_date;
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
  const nombres: Partial<Record<ClaseTmdb, Promise<Map<number, string>>>> = {};

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

  function tabla(clase: ClaseTmdb): Promise<Map<number, string>> {
    /*
      Se guarda la promesa y no el resultado: las fichas se preguntan de cinco
      en cinco, así que las cinco primeras llegan aquí a la vez y con el
      resultado a secas las cinco pedirían la lista.
    */
    nombres[clase] ??= (async () => {
      const datos = await pedir(`/genre/${clase === 'serie' ? 'tv' : 'movie'}/list?language=${IDIOMA}`);
      const lista = (datos?.genres as Array<{ id: number; name: string }> | undefined) ?? [];
      return new Map(lista.map((genero) => [genero.id, genero.name]));
    })();
    return nombres[clase];
  }

  /** El resultado en el que se puede confiar, si hay alguno. */
  function elMejor(resultados: Resultado[], titulo: string, anio: number | null): Resultado | null {
    const porTitulo = resultados.find((uno) => tituloDe(uno).some((suyo) => casan(suyo, titulo)));
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

  /** Busca y devuelve el resultado del que fiarse, si lo hay. */
  async function encontrar(titulo: string, anio: number | null, clase: ClaseTmdb): Promise<Resultado | null> {
    const donde = clase === 'serie' ? 'tv' : 'movie';
    const porAnio = clase === 'serie' ? 'first_air_date_year' : 'year';
    const consulta = `query=${encodeURIComponent(titulo)}&language=${IDIOMA}&include_adult=false`;

    // Con el año primero, que es lo que distingue los cuatro "Robin Hood".
    if (anio !== null) {
      const datos = await pedir(`/search/${donde}?${consulta}&${porAnio}=${anio}`);
      const elegido = elMejor((datos?.results as Resultado[] | undefined) ?? [], titulo, anio);
      if (elegido) return elegido;
    }

    /*
      Y si no, sin año, pero entonces el título tiene que cuadrar y el año no
      puede andar lejos: las reposiciones y los remontajes cambian de fecha por
      uno o dos, no por veinte.
    */
    const datos = await pedir(`/search/${donde}?${consulta}`);
    const cerca = ((datos?.results as Resultado[] | undefined) ?? []).filter((uno) => {
      const suyo = anioDe(estrenoDe(uno));
      return anio === null || suyo === null || Math.abs(suyo - anio) <= 2;
    });
    return cerca.find((uno) => tituloDe(uno).some((suyo) => casan(suyo, titulo))) ?? null;
  }

  /**
   * El reparto y el tráiler, que la búsqueda no trae.
   *
   * Va en una sola petición con `append_to_response`: pedir los créditos y los
   * vídeos por separado serían tres viajes por película en vez de dos.
   */
  async function elResto(id: number, clase: ClaseTmdb): Promise<{ reparto?: string; trailer?: string }> {
    const donde = clase === 'serie' ? 'tv' : 'movie';
    const creditos = clase === 'serie' ? 'aggregate_credits' : 'credits';
    const datos = await pedir(`/${donde}/${id}?language=${IDIOMA}&append_to_response=videos,${creditos}`);
    if (!datos) return {};

    const reparto = (
      (datos[creditos] as { cast?: Array<{ name?: string }> } | undefined)?.cast ?? []
    )
      .slice(0, CUANTOS_ACTORES)
      .map((quien) => quien.name)
      .filter((nombre): nombre is string => typeof nombre === 'string' && nombre.length > 0)
      .join(', ');

    /*
      De los vídeos, el primer tráiler de YouTube. Lo demás que cuelga ahí
      —escenas, entrevistas, carteles animados— no es lo que uno espera al
      darle a "Tráiler".
    */
    const videos = (datos.videos as { results?: Array<Record<string, unknown>> } | undefined)?.results ?? [];
    const trailer = videos.find(
      (video) => video.site === 'YouTube' && (video.type === 'Trailer' || video.type === 'Teaser'),
    )?.key;

    return {
      reparto: reparto || undefined,
      trailer: typeof trailer === 'string' ? trailer : undefined,
    };
  }

  return {
    async fichaDe(titulo: string, anio: number | null, clase: ClaseTmdb): Promise<FichaTmdb | null> {
      const limpio = titulo.trim();
      if (!limpio) return null;

      const elegido = await encontrar(limpio, anio, clase);
      if (!elegido) return null;

      const nombresDe = await tabla(clase);
      const genero = (elegido.genre_ids ?? [])
        .map((id) => nombresDe.get(id))
        .filter((nombre): nombre is string => nombre !== undefined)
        .join(', ');

      // El reparto y el tráiler solo si hay a quién preguntárselos.
      const resto = elegido.id !== undefined ? await elResto(elegido.id, clase) : {};

      return {
        genero,
        sinopsis: elegido.overview?.trim() || undefined,
        fondo: elegido.backdrop_path ? `${IMAGENES}${elegido.backdrop_path}` : undefined,
        // Un cero de votos es "nadie la ha votado", no un cero de nota: se
        // guarda como si no hubiera nota, que es lo que es.
        nota: elegido.vote_count ? elegido.vote_average : undefined,
        votos: elegido.vote_count || undefined,
        popularidad: elegido.popularity || undefined,
        ...resto,
      };
    },
  };
}
