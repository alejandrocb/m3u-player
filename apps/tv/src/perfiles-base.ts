/**
 * Perfiles, historial y favoritos guardados en el aparato.
 *
 * Implementa el puerto `AlmacenPerfiles` de `@m3u/ui` sobre el SQLite de
 * Android. Estas tablas **no se tocan al reimportar el catálogo**: el "seguir
 * viendo" de cada uno tiene que sobrevivir a los refrescos de la lista.
 */

import type { DB } from '@op-engineering/op-sqlite';

import type { Ajustes, AlmacenPerfiles, Avance, ClaseMedio, Favorito, Perfil } from '@m3u/ui';
import { ajustesDesde, claveDeMedio, colorLibre, idDePerfil, proporcionVista } from '@m3u/ui';

type Fila = Record<string, unknown>;

function filas(db: DB, sql: string, params: unknown[] = []): Fila[] {
  return (db.executeSync(sql, params).rows ?? []) as Fila[];
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
  const listar = (): Perfil[] =>
    filas(db, 'SELECT id, name, color, created FROM profile ORDER BY created').map(aPerfil);

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
        creado: new Date().toISOString(),
      };
      db.executeSync('INSERT INTO profile (id, name, color, created) VALUES (?, ?, ?, ?)', [
        perfil.id,
        perfil.nombre,
        perfil.color,
        perfil.creado,
      ]);
      return perfil;
    },

    async renombrar(id: string, nombre: string): Promise<void> {
      db.executeSync('UPDATE profile SET name = ? WHERE id = ?', [nombre.trim() || 'Perfil', id]);
    },

    async borrar(id: string): Promise<void> {
      // Se lleva por delante su historial, sus favoritos y sus ajustes.
      db.executeSync('DELETE FROM progress WHERE profile_id = ?', [id]);
      db.executeSync('DELETE FROM favorite WHERE profile_id = ?', [id]);
      db.executeSync('DELETE FROM profile_setting WHERE profile_id = ?', [id]);
      db.executeSync('DELETE FROM profile WHERE id = ?', [id]);
    },

    async anotarAvance(perfilId: string, avance: Avance): Promise<void> {
      db.executeSync(
        `INSERT INTO progress (profile_id, kind, item_id, seconds, duration, title, updated)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(profile_id, kind, item_id) DO UPDATE SET
           seconds = excluded.seconds,
           duration = excluded.duration,
           title = excluded.title,
           updated = excluded.updated`,
        [perfilId, avance.clase, avance.itemId, avance.segundos, avance.duracion, avance.titulo, avance.visto],
      );
    },

    async seguirViendo(perfilId: string, limite = 20): Promise<Avance[]> {
      return filas(
        db,
        `SELECT kind, item_id, title, seconds, duration, updated
           FROM progress WHERE profile_id = ?
          ORDER BY updated DESC LIMIT ?`,
        [perfilId, limite],
      ).map(aAvance);
    },

    async avanceDe(perfilId: string, clase: ClaseMedio, itemId: string): Promise<Avance | null> {
      const fila = filas(
        db,
        `SELECT kind, item_id, title, seconds, duration, updated
           FROM progress WHERE profile_id = ? AND kind = ? AND item_id = ?`,
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
           FROM progress WHERE profile_id = ? AND item_id IN (${huecos})`,
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
      db.executeSync('DELETE FROM progress WHERE profile_id = ? AND kind = ? AND item_id = ?', [
        perfilId,
        clase,
        itemId,
      ]);
    },

    async ajustes(perfilId: string): Promise<Ajustes> {
      const guardados: Record<string, string> = {};
      for (const fila of filas(db, 'SELECT key, value FROM profile_setting WHERE profile_id = ?', [perfilId])) {
        guardados[fila.key as string] = fila.value as string;
      }
      return ajustesDesde(guardados);
    },

    async guardarAjuste(perfilId: string, clave: string, valor: string): Promise<void> {
      db.executeSync(
        `INSERT INTO profile_setting (profile_id, key, value) VALUES (?, ?, ?)
         ON CONFLICT(profile_id, key) DO UPDATE SET value = excluded.value`,
        [perfilId, clave, valor],
      );
    },

    async favoritos(perfilId: string): Promise<Favorito[]> {
      return filas(
        db,
        'SELECT kind, item_id, title, created FROM favorite WHERE profile_id = ? ORDER BY created DESC',
        [perfilId],
      ).map((fila) => ({
        clase: fila.kind as ClaseMedio,
        itemId: fila.item_id as string,
        titulo: fila.title as string,
        creado: fila.created as string,
      }));
    },

    async marcarFavorito(perfilId: string, favorito: Favorito): Promise<void> {
      db.executeSync(
        `INSERT OR REPLACE INTO favorite (profile_id, kind, item_id, title, created)
         VALUES (?, ?, ?, ?, ?)`,
        [perfilId, favorito.clase, favorito.itemId, favorito.titulo, favorito.creado],
      );
    },

    async desmarcarFavorito(perfilId: string, clase: ClaseMedio, itemId: string): Promise<void> {
      db.executeSync('DELETE FROM favorite WHERE profile_id = ? AND kind = ? AND item_id = ?', [
        perfilId,
        clase,
        itemId,
      ]);
    },

    async esFavorito(perfilId: string, clase: ClaseMedio, itemId: string): Promise<boolean> {
      return (
        filas(db, 'SELECT 1 FROM favorite WHERE profile_id = ? AND kind = ? AND item_id = ? LIMIT 1', [
          perfilId,
          clase,
          itemId,
        ]).length > 0
      );
    },
  };
}
