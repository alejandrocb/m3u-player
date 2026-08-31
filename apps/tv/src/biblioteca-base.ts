/**
 * El puerto `Biblioteca` servido desde la base del aparato.
 *
 * Las consultas son las mismas que en el escritorio, contra el mismo esquema.
 * La diferencia está en las series: sus temporadas no se importan —serían
 * 6.598 peticiones—, así que la primera vez que se abre una se piden al panel
 * y se guardan aquí. La segunda visita ya sale de la base.
 */

import type { DB } from '@op-engineering/op-sqlite';

import type { Season } from '@m3u/core';
import { claveDeEpisodio, filtroRecomendadaSQL, fold, leerClaveDeEpisodio, ordenRecomendadaSQL } from '@m3u/core';
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

import { panelIdsDe } from './basedatos';

type Fila = Record<string, unknown>;

function filas(db: DB, sql: string, params: unknown[] = []): Fila[] {
  return (db.executeSync(sql, params).rows ?? []) as Fila[];
}

export interface OpcionesBase {
  /** Trae del panel las temporadas de una serie que aún no están guardadas. */
  /** El título va para poder quitarlo del nombre de cada episodio. */
  traerTemporadas: (panelIds: number[], tituloSerie: string) => Promise<Season[]>;
  /**
   * Trae del panel la ficha larga de una película: sinopsis, reparto y fondo.
   *
   * Va como opción, igual que las temporadas, porque el almacén no sabe hablar
   * con el panel: solo guarda lo que le den.
   */
  traerDetalle: (panelIds: number[]) => Promise<FichaLarga | null>;
  /** Lo mismo para una serie, con `get_series_info`. */
  traerFichaSerie: (panelIds: number[]) => Promise<FichaLarga | null>;
  /** Falso si no hubo FTS5: entonces se busca con LIKE. */
  conBusquedaRapida: boolean;
}

/**
 * El `ORDER BY` de cada criterio, con el prefijo de la tabla si hace falta.
 *
 * Lo que no tiene el dato va al final salvo ordenando por título: no tener
 * nota no es tenerla mala, ni no saber cuándo entró es ser lo más viejo.
 */
function ordenDe(orden: Pagina['orden'], prefijo = ''): string {
  if (orden === 'recomendada') return ordenRecomendadaSQL(prefijo);
  if (orden === 'valoracion') {
    return `${prefijo}rating IS NULL, ${prefijo}rating DESC, ${prefijo}sort_title`;
  }
  if (orden === 'reciente') {
    return `${prefijo}added IS NULL, ${prefijo}added DESC, ${prefijo}sort_title`;
  }
  return `${prefijo}sort_title`;
}

/** Fichas sueltas por identificador, para el grupo de favoritos. */
function porId(db: DB, tabla: string, columnas: string, ids: string[]): Fila[] {
  if (ids.length === 0) return [];
  const huecos = ids.map(() => '?').join(', ');
  return filas(db, `SELECT ${columnas} FROM ${tabla} WHERE id IN (${huecos})`, ids);
}

/**
 * El identificador de panel de una película, sacado de la URL de su variante.
 *
 * Al importar solo se guardan los de las series, que son los que hacían falta
 * para pedir episodios. Los de las películas no hay que guardarlos: van dentro
 * de la propia dirección de reproducción —`/movie/usuario/clave/12345.mkv`—,
 * así que basta con leer el último tramo.
 *
 * Se devuelven todos los de sus calidades: el proveedor manda una entrada por
 * cada una y cualquiera sirve para preguntar por la ficha.
 */
function panelIdsDePelicula(db: DB, id: string): number[] {
  const urls = filas(db, "SELECT url FROM variant WHERE owner_kind = 'movie' AND owner_id = ? ORDER BY rank", [id]);

  const ids: number[] = [];
  for (const fila of urls) {
    const ultimo = String(fila.url ?? '').split('/').pop() ?? '';
    const numero = Number(ultimo.replace(/\.[a-z0-9]+$/i, ''));
    if (Number.isInteger(numero) && numero > 0 && !ids.includes(numero)) ids.push(numero);
  }
  return ids;
}

/**
 * La condición que acompaña al orden, si es que lleva alguna.
 *
 * Solo `recomendada` filtra: descarta lo que no merece recomendarse. Los
 * demás órdenes devuelven el catálogo entero, así que aquí no hay nada que
 * poner y la consulta se queda como estaba.
 */
function filtroDe(orden: Pagina['orden'], prefijo = ''): string | null {
  return orden === 'recomendada' ? filtroRecomendadaSQL(prefijo) : null;
}

type SitioDeEpisodio = { serieId: string; temporada: number; numero: number };

/** De la clave de un episodio al número de fila con el que se guardaron sus URLs. */
function filaDeEpisodio(db: DB, clave: string): string | null {
  const sitio = leerClaveDeEpisodio(clave);
  if (!sitio) return null;

  const fila = filas(db, 'SELECT id FROM episode WHERE series_id = ? AND season = ? AND episode = ?', [
    sitio.serieId,
    sitio.temporada,
    sitio.numero,
  ])[0];
  return fila ? String(fila.id) : null;
}

/** SQL devuelve un `IN` en el orden que quiere; el perfil los quiere por fecha. */
function enElOrdenPedido<T extends { id: string }>(ids: string[], fichas: T[]): T[] {
  const porClave = new Map(fichas.map((ficha) => [ficha.id, ficha]));
  return ids.map((id) => porClave.get(id)).filter((ficha): ficha is T => ficha !== undefined);
}

export function bibliotecaEnBase(db: DB, opciones: OpcionesBase): Biblioteca {
  /**
   * La ficha larga de una película o de una serie, con su caché en la base.
   *
   * Las dos tablas llevan las mismas cinco columnas y la misma regla, así que
   * comparten código: cambia la tabla, de dónde salen los identificadores del
   * panel y a quién se le pide.
   */
  const fichaLarga = async (
    tabla: 'movie' | 'series',
    id: string,
    idsDePanel: () => number[],
    traer: (panelIds: number[]) => Promise<FichaLarga | null>,
  ): Promise<FichaLarga | null> => {
    const guardado = filas(
      db,
      `SELECT plot, actors, backdrop, genre, trailer, detalle_pedido FROM ${tabla} WHERE id = ?`,
      [id],
    )[0];
    if (!guardado) return null;

    const deLaBase = (): FichaLarga => ({
      sinopsis: (guardado.plot as string) || null,
      reparto: (guardado.actors as string) || null,
      fondo: (guardado.backdrop as string) || null,
      genero: (guardado.genre as string) || null,
      trailer: (guardado.trailer as string) || null,
    });

    // Ya se preguntó una vez: se devuelve lo que hubiera, aunque fuera nada.
    // Sin esta marca, una película sin sinopsis se volvería a pedir al panel
    // en cada arranque, y son 400 ms cada vez.
    if (guardado.detalle_pedido) return deLaBase();

    const panelIds = idsDePanel();
    if (panelIds.length === 0) return deLaBase();

    let traido: FichaLarga | null = null;
    try {
      traido = await traer(panelIds);
    } catch (error) {
      // Sin red o con el panel caído, la portada sale sin sinopsis en vez de
      // no salir. Y no se marca como pedida: se reintentará.
      console.warn('[base] no se pudo traer la ficha de', id, error);
      return deLaBase();
    }

    // Una línea por ficha y solo la primera vez que se pregunta: sirve para
    // saber, en una instalación nueva, si el panel rellena estos campos.
    console.log(
      `[detalle] ${tabla} ${id}: sinopsis ${traido?.sinopsis ? 'sí' : 'no'}, reparto ${traido?.reparto ? 'sí' : 'no'}, fondo ${traido?.fondo ? 'sí' : 'no'}`,
    );
    db.executeSync(
      `UPDATE ${tabla} SET plot = ?, actors = ?, backdrop = ?, genre = ?, trailer = ?, detalle_pedido = ? WHERE id = ?`,
      [
        traido?.sinopsis ?? null,
        traido?.reparto ?? null,
        traido?.fondo ?? null,
        traido?.genero ?? null,
        traido?.trailer ?? null,
        new Date().toISOString(),
        id,
      ],
    );
    return traido ?? deLaBase();
  };

  /** Guarda las temporadas recién traídas para no volver a pedirlas. */
  const guardarTemporadas = (serieId: string, temporadas: Season[]): void => {
    db.executeSync('BEGIN IMMEDIATE');
    try {
      for (const temporada of temporadas) {
        for (const episodio of temporada.episodes) {
          const resultado = db.executeSync(
            `INSERT OR IGNORE INTO episode
               (series_id, season, episode, title, logo, plot, rating, year, seconds)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              serieId,
              episodio.season,
              episodio.episode,
              episodio.title,
              episodio.logo,
              episodio.plot,
              episodio.rating,
              episodio.year,
              episodio.seconds,
            ],
          );
          const id = resultado.insertId;
          if (id === undefined || id === null) continue;
          for (const variante of episodio.variants) {
            db.executeSync(
              'INSERT OR IGNORE INTO variant (owner_kind, owner_id, url, quality, rank) VALUES (?, ?, ?, ?, ?)',
              ['episode', String(id), variante.url, variante.quality, variante.rank],
            );
          }
        }
      }
      db.executeSync('COMMIT');
    } catch (error) {
      db.executeSync('ROLLBACK');
      throw error;
    }
  };

  /** Se asegura de que la serie tenga sus episodios, pidiéndolos si no están. */
  const asegurarEpisodios = async (serieId: string): Promise<void> => {
    const hay = filas(db, 'SELECT 1 FROM episode WHERE series_id = ? LIMIT 1', [serieId]);
    if (hay.length > 0) return;

    const panelIds = panelIdsDe(db, serieId);
    if (panelIds.length === 0) return;

    const titulo = (filas(db, 'SELECT title FROM series WHERE id = ?', [serieId])[0]?.title as string) ?? '';
    const temporadas = await opciones.traerTemporadas(panelIds, titulo);
    if (temporadas.length > 0) guardarTemporadas(serieId, temporadas);
  };

  return {
    async grupos(): Promise<GrupoFicha[]> {
      return filas(
        db,
        `SELECT g.name AS name, COUNT(c.id) AS canales
           FROM channel_group g
           LEFT JOIN channel c ON c.group_name = g.name
          GROUP BY g.name
          ORDER BY g.position`,
      ).map((fila) => ({ nombre: fila.name as string, canales: Number(fila.canales) }));
    },

    async canalesDeGrupo(grupo: string): Promise<CanalFicha[]> {
      return filas(db, 'SELECT id, name, group_name, logo FROM channel WHERE group_name = ? ORDER BY sort_name', [
        grupo,
      ]).map((fila) => ({
        id: fila.id as string,
        nombre: fila.name as string,
        grupo: fila.group_name as string,
        logo: (fila.logo as string) ?? null,
      }));
    },

    async canales(pagina: Pagina): Promise<CanalFicha[]> {
      return filas(db, 'SELECT id, name, group_name, logo FROM channel ORDER BY sort_name LIMIT ? OFFSET ?', [
        pagina.limite,
        pagina.desde,
      ]).map((fila) => ({
        id: fila.id as string,
        nombre: fila.name as string,
        grupo: fila.group_name as string,
        logo: (fila.logo as string) ?? null,
      }));
    },

    async peliculas(pagina: Pagina): Promise<PeliculaFicha[]> {
      const filtro = filtroDe(pagina.orden, 'm.');
      const consulta = pagina.grupo
        ? `SELECT m.id, m.title, m.year, m.rating, m.logo, m.genre
             FROM movie m
             JOIN item_group g ON g.kind = 'movie' AND g.item_id = m.id
            WHERE g.group_name = ?${filtro ? ` AND ${filtro}` : ''}
            ORDER BY ${ordenDe(pagina.orden, 'm.')}
            LIMIT ? OFFSET ?`
        : `SELECT id, title, year, rating, logo, genre FROM movie
            ${filtroDe(pagina.orden) ? `WHERE ${filtroDe(pagina.orden)}` : ''}
            ORDER BY ${ordenDe(pagina.orden)}
            LIMIT ? OFFSET ?`;
      const params = pagina.grupo
        ? [pagina.grupo, pagina.limite, pagina.desde]
        : [pagina.limite, pagina.desde];

      return filas(db, consulta, params).map((fila) => ({
        id: fila.id as string,
        titulo: fila.title as string,
        anio: (fila.year as number) ?? null,
        valoracion: (fila.rating as number) ?? null,
        logo: (fila.logo as string) ?? null,
        genero: (fila.genre as string) ?? null,
      }));
    },

    async series(pagina: Pagina): Promise<SerieFicha[]> {
      const filtro = filtroDe(pagina.orden, 's.');
      const consulta = pagina.grupo
        ? `SELECT s.id, s.title, s.year, s.rating, s.logo, s.genre
             FROM series s
             JOIN item_group g ON g.kind = 'series' AND g.item_id = s.id
            WHERE g.group_name = ?${filtro ? ` AND ${filtro}` : ''}
            ORDER BY ${ordenDe(pagina.orden, 's.')}
            LIMIT ? OFFSET ?`
        : `SELECT id, title, year, rating, logo, genre FROM series
            ${filtroDe(pagina.orden) ? `WHERE ${filtroDe(pagina.orden)}` : ''}
            ORDER BY ${ordenDe(pagina.orden)}
            LIMIT ? OFFSET ?`;
      const params = pagina.grupo
        ? [pagina.grupo, pagina.limite, pagina.desde]
        : [pagina.limite, pagina.desde];

      return filas(db, consulta, params).map((fila) => ({
        id: fila.id as string,
        titulo: fila.title as string,
        anio: (fila.year as number) ?? null,
        valoracion: (fila.rating as number) ?? null,
        logo: (fila.logo as string) ?? null,
        genero: (fila.genre as string) ?? null,
      }));
    },

    async temporadas(serieId: string): Promise<TemporadaFicha[]> {
      await asegurarEpisodios(serieId);
      return filas(
        db,
        'SELECT season, COUNT(*) AS episodios FROM episode WHERE series_id = ? GROUP BY season ORDER BY season',
        [serieId],
      ).map((fila) => ({ numero: Number(fila.season), episodios: Number(fila.episodios) }));
    },

    async episodios(serieId: string, temporada: number): Promise<EpisodioFicha[]> {
      await asegurarEpisodios(serieId);
      return filas(
        db,
        `SELECT id, season, episode, title, logo, plot, rating, year, seconds
           FROM episode WHERE series_id = ? AND season = ? ORDER BY episode`,
        [serieId, temporada],
      ).map((fila) => ({
        id: Number(fila.id),
        temporada: Number(fila.season),
        numero: Number(fila.episode),
        titulo: (fila.title as string) ?? null,
        imagen: (fila.logo as string) ?? null,
        resumen: (fila.plot as string) ?? null,
        valoracion: (fila.rating as number) ?? null,
        anio: (fila.year as number) ?? null,
        segundos: (fila.seconds as number) ?? null,
      }));
    },

    async peliculasPorId(ids: string[]): Promise<PeliculaFicha[]> {
      return enElOrdenPedido(
        ids,
        porId(db, 'movie', 'id, title, year, rating, logo, genre', ids).map((fila) => ({
          id: fila.id as string,
          titulo: fila.title as string,
          anio: (fila.year as number) ?? null,
          valoracion: (fila.rating as number) ?? null,
          logo: (fila.logo as string) ?? null,
          genero: (fila.genre as string) ?? null,
        })),
      );
    },

    async seriesPorId(ids: string[]): Promise<SerieFicha[]> {
      return enElOrdenPedido(
        ids,
        porId(db, 'series', 'id, title, year, rating, logo, genre', ids).map((fila) => ({
          id: fila.id as string,
          titulo: fila.title as string,
          anio: (fila.year as number) ?? null,
          valoracion: (fila.rating as number) ?? null,
          logo: (fila.logo as string) ?? null,
          genero: (fila.genre as string) ?? null,
        })),
      );
    },

    async episodiosPorClave(claves: string[]): Promise<EpisodioDeSerieFicha[]> {
      const donde = claves
        .map((clave) => ({ clave, sitio: leerClaveDeEpisodio(clave) }))
        .filter((una): una is { clave: string; sitio: SitioDeEpisodio } => una.sitio !== null);
      if (donde.length === 0) return [];

      /*
        Las series que este aparato no haya abierto nunca no tienen episodios
        guardados, así que se piden ahora.

        Es lo que hace que una serie empezada en la tele aparezca en una
        tablet recién puesta: hasta aquí llegaba la clave por la
        sincronización, pero no había fila que enseñar ni URL que reproducir.
        Son las de "seguir viendo", doce como mucho y casi siempre ninguna:
        `asegurarEpisodios` mira primero si ya están. Y van de una en una
        porque cada una escribe en la base.
      */
      for (const serieId of new Set(donde.map(({ sitio }) => sitio.serieId))) {
        try {
          await asegurarEpisodios(serieId);
        } catch (error) {
          // Sin red o con el panel caído se pinta lo que haya, como siempre.
          console.warn('[base] no se pudieron traer los episodios de', serieId, error);
        }
      }

      /*
        Un `OR` por episodio en vez de un `IN`: la clave son tres columnas y
        SQLite no admite tuplas en un `IN`. Son doce como mucho —los que caben
        en "seguir viendo"—, así que no hay nada que optimizar.

        El salto a `series` va aquí y no en quien llama: lo que hace falta para
        pintar un episodio fuera de su serie es la carátula de la serie.
      */
      const condicion = donde.map(() => '(e.series_id = ? AND e.season = ? AND e.episode = ?)').join(' OR ');
      const params = donde.flatMap(({ sitio }) => [sitio.serieId, sitio.temporada, sitio.numero]);

      const encontrados = filas(
        db,
        `SELECT e.series_id, e.season, e.episode, e.title, s.title AS serie, s.logo AS serie_logo
           FROM episode e JOIN series s ON s.id = e.series_id
          WHERE ${condicion}`,
        params,
      ).map((fila): EpisodioDeSerieFicha => ({
        clave: claveDeEpisodio(fila.series_id as string, Number(fila.season), Number(fila.episode)),
        serieId: fila.series_id as string,
        serieTitulo: fila.serie as string,
        serieLogo: (fila.serie_logo as string) ?? null,
        temporada: Number(fila.season),
        numero: Number(fila.episode),
        titulo: (fila.title as string) ?? null,
      }));

      // En el orden en que se pidieron, que es el del historial.
      const porClave = new Map(encontrados.map((ficha) => [ficha.clave, ficha]));
      return claves
        .map((clave) => porClave.get(clave))
        .filter((ficha): ficha is EpisodioDeSerieFicha => ficha !== undefined);
    },

    /*
      El capítulo que va después de otro.

      Primero en su misma temporada y, si era el último, el primero de la
      siguiente. Se ordena por temporada y número y se coge el primero que vaya
      por delante: así el salto de temporada sale gratis y no hay que preguntar
      cuántos capítulos tenía la anterior.

      Los episodios se piden al panel si esta serie no se ha abierto nunca en
      este aparato, igual que en `episodiosPorClave`: puede llegar por la
      sincronización una serie que aquí no se ha tocado.
    */
    async episodioSiguiente(clave: string): Promise<EpisodioDeSerieFicha | null> {
      const sitio = leerClaveDeEpisodio(clave);
      if (!sitio) return null;

      try {
        await asegurarEpisodios(sitio.serieId);
      } catch (error) {
        console.warn('[base] no se pudieron traer los episodios de', sitio.serieId, error);
      }

      const fila = filas(
        db,
        `SELECT e.series_id, e.season, e.episode, e.title, s.title AS serie, s.logo AS serie_logo
           FROM episode e JOIN series s ON s.id = e.series_id
          WHERE e.series_id = ?
            AND (e.season > ? OR (e.season = ? AND e.episode > ?))
          ORDER BY e.season, e.episode
          LIMIT 1`,
        [sitio.serieId, sitio.temporada, sitio.temporada, sitio.numero],
      )[0];
      if (!fila) return null;

      return {
        clave: claveDeEpisodio(fila.series_id as string, Number(fila.season), Number(fila.episode)),
        serieId: fila.series_id as string,
        serieTitulo: fila.serie as string,
        serieLogo: (fila.serie_logo as string) ?? null,
        temporada: Number(fila.season),
        numero: Number(fila.episode),
        titulo: (fila.title as string) ?? null,
      };
    },

    async detalleDePelicula(id: string): Promise<FichaLarga | null> {
      return fichaLarga('movie', id, () => panelIdsDePelicula(db, id), opciones.traerDetalle);
    },

    async guardarGeneros(pares: Array<{ id: string; genero: string }>): Promise<void> {
      if (pares.length === 0) return;

      db.executeSync('BEGIN IMMEDIATE');
      try {
        for (const { id, genero } of pares) {
          // Solo lo que falte: si esta película ya se preguntó por su cuenta
          // —presidió el inicio—, lo suyo es más completo que esto.
          db.executeSync("UPDATE movie SET genre = ? WHERE id = ? AND (genre IS NULL OR genre = '')", [genero, id]);
        }
        db.executeSync('COMMIT');
      } catch (error) {
        db.executeSync('ROLLBACK');
        console.warn('[base] no se pudieron guardar los géneros', error);
      }
    },

    async detalleDeSerie(id: string): Promise<FichaLarga | null> {
      // Los identificadores de panel de una serie sí se guardan al importar
      // —hacen falta para pedir las temporadas—, así que aquí no hay que
      // sacarlos de la URL como en las películas.
      return fichaLarga('series', id, () => panelIdsDe(db, id), opciones.traerFichaSerie);
    },

    async canalesPorId(ids: string[]): Promise<CanalFicha[]> {
      return enElOrdenPedido(
        ids,
        porId(db, 'channel', 'id, name, group_name, logo', ids).map((fila) => ({
          id: fila.id as string,
          nombre: fila.name as string,
          grupo: fila.group_name as string,
          logo: (fila.logo as string) ?? null,
        })),
      );
    },

    async gruposDe(clase, id): Promise<string[]> {
      // De un episodio valen las de su serie: es lo que uno elige ver.
      const serie = clase === 'episodio' ? leerClaveDeEpisodio(id)?.serieId : null;
      if (clase === 'episodio' && !serie) return [];

      if (clase === 'canal') {
        const fila = filas(db, 'SELECT group_name FROM channel WHERE id = ?', [id])[0];
        return fila ? [fila.group_name as string] : [];
      }

      const dueno = clase === 'serie' || clase === 'episodio' ? 'series' : 'movie';
      return filas(db, 'SELECT group_name FROM item_group WHERE kind = ? AND item_id = ?', [
        dueno,
        serie ?? id,
      ]).map((fila) => fila.group_name as string);
    },

    async categorias(tipo: 'pelicula' | 'serie'): Promise<GrupoFicha[]> {
      return filas(
        db,
        `SELECT group_name AS nombre, COUNT(*) AS fichas
           FROM item_group WHERE kind = ?
          GROUP BY group_name
          ORDER BY group_name`,
        [tipo === 'pelicula' ? 'movie' : 'series'],
      ).map((fila) => ({ nombre: fila.nombre as string, canales: Number(fila.fichas) }));
    },

    async buscar(texto: string, ambito?: Ambito): Promise<Resultado[]> {
      const limpio = fold(texto);
      if (!limpio) return [];

      const aResultado = (fila: Fila): Resultado => ({
        tipo: fila.kind === 'channel' ? 'canal' : fila.kind === 'movie' ? 'pelicula' : 'serie',
        id: fila.ref as string,
        titulo: fila.title as string,
      });

      // El índice de texto no sabe de categorías: se acota después.
      const enGrupo = ambito?.grupo
        ? new Set(
            filas(db, 'SELECT item_id FROM item_group WHERE group_name = ?', [ambito.grupo]).map(
              (fila) => fila.item_id as string,
            ),
          )
        : null;
      const acotar = (resultados: Resultado[]): Resultado[] =>
        resultados.filter(
          (resultado) =>
            (!ambito?.tipo || resultado.tipo === ambito.tipo) && (!enGrupo || enGrupo.has(resultado.id)),
        );

      if (opciones.conBusquedaRapida) {
        // Palabra a palabra y entrecomillado: FTS5 se atraganta con la
        // puntuación que escribe el usuario.
        const consulta = limpio
          .split(/\s+/)
          .filter(Boolean)
          .map((palabra, indice, todas) => (indice === todas.length - 1 ? `"${palabra}"*` : `"${palabra}"`))
          .join(' ');
        try {
          return acotar(
            filas(db, 'SELECT title, kind, ref FROM search WHERE search MATCH ? ORDER BY rank LIMIT 200', [
              consulta,
            ]).map(aResultado),
          );
        } catch (error) {
          console.warn('[base] la búsqueda rápida falló, se prueba con LIKE', error);
        }
      }

      const patron = `%${limpio}%`;
      return acotar(
        [
          ...filas(db, "SELECT name AS title, 'channel' AS kind, id AS ref FROM channel WHERE sort_name LIKE ? LIMIT 50", [patron]),
          ...filas(db, "SELECT title, 'movie' AS kind, id AS ref FROM movie WHERE sort_title LIKE ? LIMIT 50", [patron]),
          ...filas(db, "SELECT title, 'series' AS kind, id AS ref FROM series WHERE sort_title LIKE ? LIMIT 50", [patron]),
        ].map(aResultado),
      );
    },

    async totales() {
      const cuenta = (tabla: string): number =>
        Number((filas(db, `SELECT COUNT(*) AS n FROM ${tabla}`)[0]?.n as number) ?? 0);
      return {
        canales: cuenta('channel'),
        peliculas: cuenta('movie'),
        series: cuenta('series'),
        episodios: cuenta('episode'),
      };
    },

    async variantes(clase, id): Promise<Variante[]> {
      const dueno = clase === 'canal' ? 'channel' : clase === 'pelicula' ? 'movie' : 'episode';
      /*
        De un episodio llega su clave, y las variantes se guardan contra el
        número de fila: hay que traducir. Si esa serie todavía no se ha abierto
        en este aparato no hay fila que valga, y entonces no hay nada que
        reproducir —eso lo resuelve abrir la serie, que es cuando se piden sus
        episodios al panel—.
      */
      const owner = clase === 'episodio' ? filaDeEpisodio(db, id) : id;
      if (owner === null) return [];

      return filas(
        db,
        'SELECT url, quality FROM variant WHERE owner_kind = ? AND owner_id = ? ORDER BY rank DESC',
        [dueno, owner],
      ).map((fila) => ({ url: fila.url as string, calidad: (fila.quality as string) ?? null }));
    },
  };
}
