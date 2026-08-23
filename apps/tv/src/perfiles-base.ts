/**
 * Perfiles, historial y favoritos guardados en el aparato.
 *
 * Implementa el puerto `AlmacenPerfiles` de `@m3u/ui` sobre el SQLite de
 * Android. Estas tablas **no se tocan al reimportar el catálogo**: el "seguir
 * viendo" de cada uno tiene que sobrevivir a los refrescos de la lista.
 *
 * Y son las que se comparten entre aparatos, así que aquí no se borra nada de
 * verdad: cada baja deja una lápida (`deleted`) con su fecha. Un `DELETE` a
 * secas no deja nada que contarle al otro aparato, que subiría la fila otra
 * vez tan tranquilo —quitas una película de favoritos y al día siguiente ha
 * vuelto—. Por lo mismo, toda escritura sella `updated` y `origin`: son la
 * fecha y el aparato con los que se decide quién gana en `fusionar`.
 */

import type { DB } from '@op-engineering/op-sqlite';

import type { Ajustes, AlmacenPerfiles, Avance, Cambio, ClaseMedio, Favorito, Perfil } from '@m3u/ui';
import { ajustesDesde, claveDeMedio, colorLibre, idDePerfil, proporcionVista } from '@m3u/ui';
import type { BaseSQL } from '@m3u/storage/sincronizar';
import { aplicarCambios, cambiosDesde } from '@m3u/storage/sincronizar';

type Fila = Record<string, unknown>;

/** Lo que admite op-sqlite como parámetro de una consulta. */
type Valor = string | number | null;

function filas(db: DB, sql: string, params: Valor[] = []): Fila[] {
  return (db.executeSync(sql, params).rows ?? []) as Fila[];
}

function ahora(): string {
  return new Date().toISOString();
}

/**
 * Quién es este aparato, para desempatar cambios simultáneos.
 *
 * Se inventa una vez y se guarda: tiene que sobrevivir a los reinicios, o dos
 * arranques del mismo aparato parecerían dos aparatos distintos y el
 * desempate dejaría de ser estable.
 */
export function idDeAparato(db: DB): string {
  const guardado = filas(db, "SELECT value FROM meta WHERE key = 'aparato'")[0];
  if (guardado) return guardado.value as string;

  const id = `a-${Math.random().toString(36).slice(2, 10)}`;
  db.executeSync("INSERT INTO meta (key, value) VALUES ('aparato', ?)", [id]);
  return id;
}

function aPerfil(fila: Fila): Perfil {
  return {
    id: fila.id as string,
    nombre: fila.name as string,
    color: fila.color as string,
    creado: fila.created as string,
  };
}

function aAvance(fila: Fila): Avance {
  return {
    clase: fila.kind as ClaseMedio,
    itemId: fila.item_id as string,
    titulo: fila.title as string,
    segundos: Number(fila.seconds),
    duracion: Number(fila.duration),
    visto: fila.updated as string,
  };
}

export function perfilesEnBase(db: DB): AlmacenPerfiles {
  const aparato = idDeAparato(db);

  const listar = (): Perfil[] =>
    filas(db, 'SELECT id, name, color, created FROM profile WHERE deleted = 0 ORDER BY created').map(aPerfil);

  /** Da de baja una fila sin quitarla de en medio. */
  const enterrar = (tabla: string, donde: string, params: Valor[]): void => {
    db.executeSync(`UPDATE ${tabla} SET deleted = 1, updated = ?, origin = ? WHERE ${donde}`, [
      ahora(),
      aparato,
      ...params,
    ]);
  };

  return {
    async perfiles(): Promise<Perfil[]> {
      return listar();
    },

    async crear(nombre: string, color?: string): Promise<Perfil> {
      const existentes = listar();
      const perfil: Perfil = {
        id: idDePerfil(nombre, existentes),
        nombre: nombre.trim() || 'Perfil',
        color: color || colorLibre(existentes),
        creado: ahora(),
      };
      // Al elegir el identificador solo se miran los perfiles vivos, así que
      // puede tocarle el de uno borrado hace tiempo: se reaprovecha la lápida
      // en vez de chocar con ella.
      db.executeSync(
        `INSERT INTO profile (id, name, color, created, updated, deleted, origin)
         VALUES (?, ?, ?, ?, ?, 0, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name, color = excluded.color, created = excluded.created,
           updated = excluded.updated, deleted = 0, origin = excluded.origin`,
        [perfil.id, perfil.nombre, perfil.color, perfil.creado, perfil.creado, aparato],
      );
      return perfil;
    },

    async renombrar(id: string, nombre: string): Promise<void> {
      db.executeSync('UPDATE profile SET name = ?, updated = ?, origin = ? WHERE id = ?', [
        nombre.trim() || 'Perfil',
        ahora(),
        aparato,
        id,
      ]);
    },

    async borrar(id: string): Promise<void> {
      // Se lleva por delante su historial, sus favoritos y sus ajustes.
      enterrar('progress', 'profile_id = ?', [id]);
      enterrar('favorite', 'profile_id = ?', [id]);
      enterrar('profile_setting', 'profile_id = ?', [id]);
      enterrar('profile', 'id = ?', [id]);
    },

    async anotarAvance(perfilId: string, avance: Avance): Promise<void> {
      db.executeSync(
        `INSERT INTO progress (profile_id, kind, item_id, seconds, duration, title, updated, deleted, origin)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
         ON CONFLICT(profile_id, kind, item_id) DO UPDATE SET
           seconds = excluded.seconds,
           duration = excluded.duration,
           title = excluded.title,
           updated = excluded.updated,
           deleted = 0,
           origin = excluded.origin`,
        [
          perfilId,
          avance.clase,
          avance.itemId,
          avance.segundos,
          avance.duracion,
          avance.titulo,
          avance.visto,
          aparato,
        ],
      );
    },

    async seguirViendo(perfilId: string, limite = 20): Promise<Avance[]> {
      return filas(
        db,
        `SELECT kind, item_id, title, seconds, duration, updated
           FROM progress WHERE profile_id = ? AND deleted = 0
          ORDER BY updated DESC LIMIT ?`,
        [perfilId, limite],
      ).map(aAvance);
    },

    async avanceDe(perfilId: string, clase: ClaseMedio, itemId: string): Promise<Avance | null> {
      const fila = filas(
        db,
        `SELECT kind, item_id, title, seconds, duration, updated
           FROM progress WHERE profile_id = ? AND kind = ? AND item_id = ? AND deleted = 0`,
        [perfilId, clase, itemId],
      )[0];
      return fila ? aAvance(fila) : null;
    },

    async avancesDe(
      perfilId: string,
      medios: Array<{ clase: ClaseMedio; id: string }>,
    ): Promise<Record<string, number>> {
      if (medios.length === 0) return {};

      // Una sola consulta con todos los identificadores de la pantalla.
      const huecos = medios.map(() => '?').join(', ');
      const encontrados = filas(
        db,
        `SELECT kind, item_id, title, seconds, duration, updated
           FROM progress WHERE profile_id = ? AND deleted = 0 AND item_id IN (${huecos})`,
        [perfilId, ...medios.map((medio) => medio.id)],
      ).map(aAvance);

      const avances: Record<string, number> = {};
      for (const avance of encontrados) {
        const proporcion = proporcionVista(avance);
        if (proporcion > 0) avances[claveDeMedio(avance.clase, avance.itemId)] = proporcion;
      }
      return avances;
    },

    async olvidarAvance(perfilId: string, clase: ClaseMedio, itemId: string): Promise<void> {
      enterrar('progress', 'profile_id = ? AND kind = ? AND item_id = ?', [perfilId, clase, itemId]);
    },

    async ajustes(perfilId: string): Promise<Ajustes> {
      const guardados: Record<string, string> = {};
      for (const fila of filas(db, 'SELECT key, value FROM profile_setting WHERE profile_id = ? AND deleted = 0', [
        perfilId,
      ])) {
        guardados[fila.key as string] = fila.value as string;
      }
      return ajustesDesde(guardados);
    },

    async guardarAjuste(perfilId: string, clave: string, valor: string): Promise<void> {
      db.executeSync(
        `INSERT INTO profile_setting (profile_id, key, value, updated, deleted, origin)
         VALUES (?, ?, ?, ?, 0, ?)
         ON CONFLICT(profile_id, key) DO UPDATE SET
           value = excluded.value, updated = excluded.updated, deleted = 0, origin = excluded.origin`,
        [perfilId, clave, valor, ahora(), aparato],
      );
    },

    async favoritos(perfilId: string): Promise<Favorito[]> {
      return filas(
        db,
        `SELECT kind, item_id, title, created FROM favorite
          WHERE profile_id = ? AND deleted = 0 ORDER BY created DESC`,
        [perfilId],
      ).map((fila) => ({
        clase: fila.kind as ClaseMedio,
        itemId: fila.item_id as string,
        titulo: fila.title as string,
        creado: fila.created as string,
      }));
    },

    async marcarFavorito(perfilId: string, favorito: Favorito): Promise<void> {
      // `created` es cuándo se marcó, que es por donde se ordenan; `updated`
      // es cuándo se tocó, que es lo que decide al sincronizar.
      db.executeSync(
        `INSERT INTO favorite (profile_id, kind, item_id, title, created, updated, deleted, origin)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?)
         ON CONFLICT(profile_id, kind, item_id) DO UPDATE SET
           title = excluded.title, created = excluded.created,
           updated = excluded.updated, deleted = 0, origin = excluded.origin`,
        [perfilId, favorito.clase, favorito.itemId, favorito.titulo, favorito.creado, ahora(), aparato],
      );
    },

    async desmarcarFavorito(perfilId: string, clase: ClaseMedio, itemId: string): Promise<void> {
      enterrar('favorite', 'profile_id = ? AND kind = ? AND item_id = ?', [perfilId, clase, itemId]);
    },

    async esFavorito(perfilId: string, clase: ClaseMedio, itemId: string): Promise<boolean> {
      return (
        filas(
          db,
          `SELECT 1 FROM favorite
            WHERE profile_id = ? AND kind = ? AND item_id = ? AND deleted = 0 LIMIT 1`,
          [perfilId, clase, itemId],
        ).length > 0
      );
    },

    async cambiosDesde(marca: string): Promise<Cambio[]> {
      return cambiosDesde(comoBaseSQL(db), marca);
    },

    async aplicarCambios(entrantes: Cambio[]): Promise<void> {
      aplicarCambios(comoBaseSQL(db), entrantes);
    },
  };
}

/**
 * El SQLite de Android con la cara que espera `@m3u/storage/sincronizar`.
 *
 * Son dos nombres distintos para lo mismo: así el SQL de la sincronización
 * vive en un solo sitio, se prueba con el SQLite de Node y sirve igual para
 * el escritorio cuando le toque.
 */
function comoBaseSQL(db: DB): BaseSQL {
  return {
    // El puerto habla de `unknown[]` porque no conoce a op-sqlite; lo que de
    // verdad viaja son los textos y números de las filas.
    filas: (sql, params) => filas(db, sql, (params ?? []) as Valor[]),
    ejecutar: (sql, params) => {
      db.executeSync(sql, (params ?? []) as Valor[]);
    },
  };
}
