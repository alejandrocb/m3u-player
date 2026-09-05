/**
 * El almacén de SQLite hablando el idioma de la interfaz.
 *
 * `packages/ui` define lo que necesita —el puerto `Biblioteca`— y aquí está la
 * implementación de escritorio. Cuando la app se porte a Android TV habrá otra
 * implementación sobre otro SQLite, y la interfaz no tendrá que enterarse.
 *
 * El puerto es asíncrono y `node:sqlite` es síncrono: envolver en promesas
 * sobra hoy, pero es lo que permite que la misma interfaz funcione mañana
 * contra un puente nativo, que nunca lo será.
 */

import type {
  Ambito,
  Biblioteca,
  CanalFicha,
  FichaLarga,
  EpisodioDeSerieFicha,
  EpisodioFicha,
  GrupoFicha,
  Pagina,
  PeliculaFicha,
  Resultado,
  SerieFicha,
  TemporadaFicha,
  Variante,
} from '@m3u/ui';

import type { LibraryStore, OwnerKind } from './store.ts';
import { leerClaveDeEpisodio } from '@m3u/core';

/** Traduce las clases que usa la interfaz a las del almacén. */
const DUENO: Record<'canal' | 'pelicula' | 'episodio', OwnerKind> = {
  canal: 'channel',
  pelicula: 'movie',
  episodio: 'episode',
};

/** El criterio de orden que pide la interfaz, en el idioma del almacén. */
function ordenDe(pagina: Pagina): { sort?: 'rating' | 'added' | 'recomendada' } {
  if (pagina.orden === 'recomendada') return { sort: 'recomendada' };
  if (pagina.orden === 'valoracion') return { sort: 'rating' };
  if (pagina.orden === 'reciente') return { sort: 'added' };
  return {};
}

export function bibliotecaDesde(store: LibraryStore): Biblioteca {
  /** De la clave de un episodio al número de fila con el que se guardó. */
  const episodioDeClave = (clave: string): string | null => {
    const donde = leerClaveDeEpisodio(clave);
    if (!donde) return null;
    const episodio = store.episodeAt(donde.serieId, donde.temporada, donde.numero);
    return episodio ? String(episodio.id) : null;
  };

  return {
    async grupos(): Promise<GrupoFicha[]> {
      return store.groups().map((grupo) => ({ nombre: grupo.name, canales: grupo.channels }));
    },

    async canalesDeGrupo(grupo: string): Promise<CanalFicha[]> {
      return store.channelsInGroup(grupo).map((canal) => ({
        id: canal.id,
        nombre: canal.name,
        grupo: canal.group,
        logo: canal.logo,
      }));
    },

    async canales(pagina: Pagina): Promise<CanalFicha[]> {
      return store.channels({ limit: pagina.limite, offset: pagina.desde }).map((canal) => ({
        id: canal.id,
        nombre: canal.name,
        grupo: canal.group,
        logo: canal.logo,
      }));
    },

    async peliculas(pagina: Pagina): Promise<PeliculaFicha[]> {
      return store
        .movies({
          limit: pagina.limite,
          offset: pagina.desde,
          ...(pagina.grupo ? { group: pagina.grupo } : {}),
          ...(pagina.tema ? { theme: pagina.tema } : {}),
          ...ordenDe(pagina),
        })
        .map((pelicula) => ({
          id: pelicula.id,
          titulo: pelicula.title,
          anio: pelicula.year,
          valoracion: pelicula.rating ?? null,
          logo: pelicula.logo,
          genero: null,
        }));
    },

    async series(pagina: Pagina): Promise<SerieFicha[]> {
      return store
        .series({
          limit: pagina.limite,
          offset: pagina.desde,
          ...(pagina.grupo ? { group: pagina.grupo } : {}),
          ...(pagina.tema ? { theme: pagina.tema } : {}),
          ...ordenDe(pagina),
        })
        .map((serie) => ({
          id: serie.id,
          titulo: serie.title,
          anio: serie.year,
          valoracion: serie.rating ?? null,
          logo: serie.logo,
          // El escritorio todavía no importa el género de las series.
          genero: null,
        }));
    },

    async temporadas(serieId: string): Promise<TemporadaFicha[]> {
      return store.seasons(serieId).map((temporada) => ({
        numero: temporada.season,
        episodios: temporada.episodes,
      }));
    },

    async episodios(serieId: string, temporada: number): Promise<EpisodioFicha[]> {
      return store.episodes(serieId, temporada).map((episodio) => ({
        id: episodio.id,
        temporada: episodio.season,
        numero: episodio.episode,
        titulo: episodio.title,
        imagen: episodio.logo,
        resumen: episodio.plot,
        valoracion: episodio.rating,
        anio: episodio.year,
        segundos: episodio.seconds,
      }));
    },

    async peliculasPorId(ids: string[]): Promise<PeliculaFicha[]> {
      return store.moviesById(ids).map((pelicula) => ({
        id: pelicula.id,
        titulo: pelicula.title,
        anio: pelicula.year,
        valoracion: pelicula.rating ?? null,
        logo: pelicula.logo,
        genero: null,
      }));
    },

    async episodioSiguiente(): Promise<EpisodioDeSerieFicha | null> {
      // El escritorio es un prototipo y no tiene "seguir viendo" por series:
      // cuando lo tenga, esto será la misma consulta que en Android.
      return null;
    },

    async episodiosPorClave(claves: string[]): Promise<EpisodioDeSerieFicha[]> {
      const fichas: EpisodioDeSerieFicha[] = [];
      for (const clave of claves) {
        const donde = leerClaveDeEpisodio(clave);
        if (!donde) continue;

        const episodio = store.episodeAt(donde.serieId, donde.temporada, donde.numero);
        if (!episodio) continue;

        fichas.push({
          clave,
          serieId: episodio.seriesId,
          serieTitulo: episodio.seriesTitle,
          serieLogo: episodio.seriesLogo,
          temporada: episodio.season,
          numero: episodio.episode,
          titulo: episodio.title,
        });
      }
      return fichas;
    },

    async detalleDePelicula(): Promise<FichaLarga | null> {
      // El escritorio todavía no habla con el panel: cuando tenga su propia
      // carga, esto irá a `get_vod_info` igual que en Android.
      return null;
    },

    async guardarFichas(): Promise<void> {
      // El escritorio no habla con el servidor de la casa todavía.
    },

    async gruposDe(): Promise<string[]> {
      // El escritorio todavía no ordena el inicio por lo que ves.
      return [];
    },

    async detalleDeSerie(): Promise<FichaLarga | null> {
      return null;
    },

    async seriesPorId(ids: string[]): Promise<SerieFicha[]> {
      return store.seriesById(ids).map((serie) => ({
        id: serie.id,
        titulo: serie.title,
        anio: serie.year,
        valoracion: serie.rating ?? null,
        logo: serie.logo,
        // El escritorio todavía no importa el género de las series.
          genero: null,
      }));
    },

    async canalesPorId(ids: string[]): Promise<CanalFicha[]> {
      return store.channelsById(ids).map((canal) => ({
        id: canal.id,
        nombre: canal.name,
        grupo: canal.group,
        logo: canal.logo,
      }));
    },

    async temas(tipo: 'pelicula' | 'serie'): Promise<GrupoFicha[]> {
      return store.themes(tipo === 'pelicula' ? 'movie' : 'series').map((tema) => ({
        nombre: tema.name,
        canales: tema.items,
      }));
    },

    async categorias(tipo: 'pelicula' | 'serie'): Promise<GrupoFicha[]> {
      return store.categories(tipo === 'pelicula' ? 'movie' : 'series').map((categoria) => ({
        nombre: categoria.name,
        canales: categoria.items,
      }));
    },

    async buscar(texto: string, ambito?: Ambito): Promise<Resultado[]> {
      const resultados = store.search(texto).map((hit) => ({
        tipo: (hit.kind === 'channel' ? 'canal' : hit.kind === 'movie' ? 'pelicula' : 'serie') as Resultado['tipo'],
        id: hit.id,
        titulo: hit.title,
      }));

      if (!ambito?.tipo && !ambito?.grupo) return resultados;

      // El índice de texto no sabe de categorías: se filtra después.
      const enGrupo = ambito.grupo ? new Set(store.itemsInGroup(ambito.grupo)) : null;
      return resultados.filter(
        (resultado) =>
          (!ambito.tipo || resultado.tipo === ambito.tipo) && (!enGrupo || enGrupo.has(resultado.id)),
      );
    },

    async totales() {
      const cuentas = store.counts();
      return {
        canales: cuentas.channels,
        peliculas: cuentas.movies,
        series: cuentas.series,
        episodios: cuentas.episodes,
      };
    },

    async variantes(clase, id): Promise<Variante[]> {
      // En un episodio lo que llega es su clave; las variantes se guardan
      // contra el número de fila, así que hay que traducir.
      const dueno = clase === 'episodio' ? episodioDeClave(id) : id;
      if (dueno === null) return [];

      return store.variants(DUENO[clase], dueno).map((variante) => ({
        url: variante.url,
        calidad: variante.quality,
      }));
    },
  };
}
