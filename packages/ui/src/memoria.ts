/**
 * El puerto `Biblioteca` resuelto en memoria, a partir de una `Library` del core.
 *
 * Sirve para dos cosas: arrancar la app en una plataforma donde todavía no hay
 * base de datos —hoy Android TV— y escribir tests de interfaz con datos reales
 * sin montar SQLite.
 *
 * No sustituye al almacén: la lista real son 218.000 entradas, y tenerlas en
 * memoria cuesta cientos de megas. Para listas pequeñas y para pruebas, va bien.
 */

import type { Episode, Library, Season, Series } from '@m3u/core';

import type {
  Ambito,
  Biblioteca,
  Orden,
  CanalFicha,
  EpisodioDeSerieFicha,
  EpisodioFicha,
  GrupoFicha,
  Pagina,
  PeliculaFicha,
  Resultado,
  SerieFicha,
  TemporadaFicha,
  Variante,
} from './puerto.ts';

/** Episodio con el número que lo identifica de cara a la interfaz. */
interface EpisodioIndexado {
  id: number;
  serie: Series;
  episodio: Episode;
}

export interface OpcionesMemoria {
  /**
   * Trae las temporadas de una serie la primera vez que se abre.
   *
   * Con un panel Xtream, el catálogo llega sin episodios: son 6.598 peticiones,
   * una por serie. Se piden al entrar en cada una y se quedan guardadas, que es
   * como se comportan los reproductores del ramo.
   */
  traerTemporadas?: (serie: Series) => Promise<Season[]>;
}

/**
 * Ordena por título, por nota o por lo último que entró en el catálogo.
 *
 * Lo que no tiene el dato va al final en los dos últimos casos: no tener nota
 * no es lo mismo que tenerla mala, ni no saber cuándo entró es ser lo más
 * viejo.
 */
function ordenar<T extends { title: string; rating: number | null; added: number | null }>(
  fichas: T[],
  orden?: Orden,
): T[] {
  if (orden === 'valoracion') return [...fichas].sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1));
  if (orden === 'reciente') return [...fichas].sort((a, b) => (b.added ?? -1) - (a.added ?? -1));
  return fichas;
}

export function bibliotecaEnMemoria(library: Library, opciones: OpcionesMemoria = {}): Biblioteca {
  // Los episodios necesitan un identificador propio, como el rowid que les da
  // SQLite. Aquí se numeran según van apareciendo y se guardan en un índice.
  const porId = new Map<number, EpisodioIndexado>();
  const indexadas = new Set<string>();
  let siguiente = 1;

  const indexar = (serie: Series): void => {
    if (indexadas.has(serie.id)) return;
    indexadas.add(serie.id);
    for (const temporada of serie.seasons) {
      for (const episodio of temporada.episodes) {
        porId.set(siguiente, { id: siguiente, serie, episodio });
        siguiente++;
      }
    }
  };

  for (const serieInicial of library.series) indexar(serieInicial);

  const serie = (id: string): Series | undefined => library.series.find((s) => s.id === id);

  /**
   * Devuelve la serie con sus temporadas, pidiéndolas si aún no están.
   * El resultado se guarda en la propia ficha: la segunda visita es inmediata.
   */
  const conTemporadas = async (id: string): Promise<Series | undefined> => {
    const encontrada = serie(id);
    if (!encontrada) return undefined;
    if (encontrada.seasons.length > 0 || !opciones.traerTemporadas) return encontrada;

    encontrada.seasons = await opciones.traerTemporadas(encontrada);
    indexadas.delete(encontrada.id);
    indexar(encontrada);
    return encontrada;
  };
  const normaliza = (texto: string): string => texto.toLowerCase();

  return {
    async grupos(): Promise<GrupoFicha[]> {
      return library.groups.map((grupo) => ({ nombre: grupo.name, canales: grupo.channelIds.length }));
    },

    async canalesDeGrupo(grupo: string): Promise<CanalFicha[]> {
      return library.channels
        .filter((canal) => canal.group === grupo)
        .map((canal) => ({ id: canal.id, nombre: canal.name, grupo: canal.group, logo: canal.logo }));
    },

    async canales(pagina: Pagina): Promise<CanalFicha[]> {
      return library.channels
        .slice(pagina.desde, pagina.desde + pagina.limite)
        .map((canal) => ({ id: canal.id, nombre: canal.name, grupo: canal.group, logo: canal.logo }));
    },

    async peliculas(pagina: Pagina): Promise<PeliculaFicha[]> {
      return ordenar(
        library.movies.filter((pelicula) => !pagina.grupo || pelicula.groups.includes(pagina.grupo)),
        pagina.orden,
      )
        .slice(pagina.desde, pagina.desde + pagina.limite)
        .map((pelicula) => ({
          id: pelicula.id,
          titulo: pelicula.title,
          anio: pelicula.year,
          valoracion: pelicula.rating,
          logo: pelicula.logo,
        }));
    },

    async series(pagina: Pagina): Promise<SerieFicha[]> {
      return ordenar(
        library.series.filter((serie) => !pagina.grupo || serie.groups.includes(pagina.grupo)),
        pagina.orden,
      )
        .slice(pagina.desde, pagina.desde + pagina.limite)
        .map((s) => ({ id: s.id, titulo: s.title, anio: s.year, valoracion: s.rating, logo: s.logo }));
    },

    async temporadas(serieId: string): Promise<TemporadaFicha[]> {
      const encontrada = await conTemporadas(serieId);
      return (
        encontrada?.seasons.map((temporada) => ({
          numero: temporada.number,
          episodios: temporada.episodes.length,
        })) ?? []
      );
    },

    async episodios(serieId: string, temporada: number): Promise<EpisodioFicha[]> {
      const encontrada = await conTemporadas(serieId);
      if (!encontrada) return [];

      const lista = encontrada.seasons.find((s) => s.number === temporada)?.episodes ?? [];
      return lista.map((episodio) => {
        const indexado = [...porId.values()].find(
          (candidato) =>
            candidato.serie.id === serieId &&
            candidato.episodio.season === episodio.season &&
            candidato.episodio.episode === episodio.episode,
        );
        return {
          id: indexado?.id ?? 0,
          temporada: episodio.season,
          numero: episodio.episode,
          titulo: episodio.title,
          imagen: episodio.logo,
          resumen: episodio.plot,
          valoracion: episodio.rating,
          anio: episodio.year,
          segundos: episodio.seconds,
        };
      });
    },

    async peliculasPorId(ids: string[]): Promise<PeliculaFicha[]> {
      const porClave = new Map(library.movies.map((pelicula) => [pelicula.id, pelicula]));
      return ids
        .map((id) => porClave.get(id))
        .filter((pelicula) => pelicula !== undefined)
        .map((pelicula) => ({
          id: pelicula.id,
          titulo: pelicula.title,
          anio: pelicula.year,
          valoracion: pelicula.rating,
          logo: pelicula.logo,
        }));
    },

    async episodiosPorId(ids: string[]): Promise<EpisodioDeSerieFicha[]> {
      // Los episodios ya están numerados en `porId`, que es el equivalente al
      // rowid que les da SQLite: se busca por ahí y no recorriendo series.
      const encontrados: EpisodioDeSerieFicha[] = [];
      for (const id of ids) {
        const indexado = porId.get(Number(id));
        if (!indexado) continue;
        encontrados.push({
          id: indexado.id,
          serieId: indexado.serie.id,
          serieTitulo: indexado.serie.title,
          serieLogo: indexado.serie.logo,
          temporada: indexado.episodio.season,
          numero: indexado.episodio.episode,
          titulo: indexado.episodio.title,
        });
      }
      return encontrados;
    },

    async seriesPorId(ids: string[]): Promise<SerieFicha[]> {
      const porClave = new Map(library.series.map((serie) => [serie.id, serie]));
      return ids
        .map((id) => porClave.get(id))
        .filter((serie) => serie !== undefined)
        .map((serie) => ({
          id: serie.id,
          titulo: serie.title,
          anio: serie.year,
          valoracion: serie.rating,
          logo: serie.logo,
        }));
    },

    async canalesPorId(ids: string[]): Promise<CanalFicha[]> {
      const porClave = new Map(library.channels.map((canal) => [canal.id, canal]));
      return ids
        .map((id) => porClave.get(id))
        .filter((canal) => canal !== undefined)
        .map((canal) => ({ id: canal.id, nombre: canal.name, grupo: canal.group, logo: canal.logo }));
    },

    async categorias(tipo: 'pelicula' | 'serie'): Promise<GrupoFicha[]> {
      // Las categorías salen de las fichas: el proveedor reparte la misma
      // película entre varias, así que se cuentan una vez por cada una.
      const cuenta = new Map<string, number>();
      const fichas = tipo === 'pelicula' ? library.movies : library.series;
      for (const ficha of fichas) {
        for (const grupo of ficha.groups) cuenta.set(grupo, (cuenta.get(grupo) ?? 0) + 1);
      }
      return [...cuenta.entries()]
        .map(([nombre, canales]) => ({ nombre, canales }))
        .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    },

    async buscar(texto: string, ambito?: Ambito): Promise<Resultado[]> {
      // Sin FTS5: una coincidencia por contenido basta para listas pequeñas.
      const aguja = normaliza(texto);
      if (!aguja) return [];

      const resultados: Resultado[] = [];
      const cabe = (tipo: 'canal' | 'pelicula' | 'serie', grupos: string[]): boolean =>
        (!ambito?.tipo || ambito.tipo === tipo) && (!ambito?.grupo || grupos.includes(ambito.grupo));

      for (const canal of library.channels) {
        if (cabe('canal', [canal.group]) && normaliza(canal.name).includes(aguja)) {
          resultados.push({ tipo: 'canal', id: canal.id, titulo: canal.name });
        }
      }
      for (const pelicula of library.movies) {
        if (cabe('pelicula', pelicula.groups) && normaliza(pelicula.title).includes(aguja)) {
          resultados.push({ tipo: 'pelicula', id: pelicula.id, titulo: pelicula.title });
        }
      }
      for (const s of library.series) {
        if (cabe('serie', s.groups) && normaliza(s.title).includes(aguja)) {
          resultados.push({ tipo: 'serie', id: s.id, titulo: s.title });
        }
      }
      return resultados;
    },

    async totales() {
      return {
        canales: library.channels.length,
        peliculas: library.movies.length,
        series: library.series.length,
        episodios: porId.size,
      };
    },

    async variantes(clase, id): Promise<Variante[]> {
      const aVariante = (variantes: { url: string; quality: string | null }[]): Variante[] =>
        variantes.map((variante) => ({ url: variante.url, calidad: variante.quality }));

      if (clase === 'canal') {
        const canal = library.channels.find((c) => c.id === id);
        return canal ? aVariante(canal.variants) : [];
      }
      if (clase === 'pelicula') {
        const pelicula = library.movies.find((p) => p.id === id);
        return pelicula ? aVariante(pelicula.variants) : [];
      }
      const indexado = porId.get(Number(id));
      return indexado ? aVariante(indexado.episodio.variants) : [];
    },
  };
}
