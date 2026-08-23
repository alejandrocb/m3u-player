/**
 * Sacar y meter cambios de perfil en un SQLite cualquiera.
 *
 * Es la mitad de abajo de la sincronización: leer lo que ha cambiado desde
 * una fecha y escribir lo que llega de otro aparato. La regla de quién gana no
 * está aquí sino en `fusionar`, de `@m3u/ui`, porque el servidor tiene que
 * aplicar exactamente la misma.
 *
 * No se ata a un SQLite concreto a propósito. El de Android y el de Node se
 * llaman distinto pero hacen lo mismo, y el SQL es idéntico: pidiendo solo
 * `BaseSQL`, esto vale para los dos y —lo que importa— se puede probar aquí
 * en vez de solo en la tele.
 *
 * Todo va contra `SINCRONIZADAS`, que declara cada tabla con su clave y sus
 * columnas: así añadir una tabla al reparto es una línea allí y nada aquí.
 */

import type { Cambio } from '@m3u/ui';
import { fusionar } from '@m3u/ui';

import { SINCRONIZADAS } from './schema.ts';

/** Lo mínimo que se le pide a un SQLite para esto. */
export interface BaseSQL {
  filas(sql: string, params?: unknown[]): Array<Record<string, unknown>>;
  ejecutar(sql: string, params?: unknown[]): void;
}

/** Las columnas que se leen y escriben de una tabla, en orden fijo. */
function columnasDe(tabla: { clave: string[]; campos: string[] }): string[] {
  return [...tabla.clave, ...tabla.campos, 'updated', 'deleted', 'origin'];
}

/**
 * Por qué columna se piden las novedades.
 *
 * En un aparato es `updated`, la fecha del cambio, porque lo que quiere saber
 * es qué ha tocado él desde la última subida. En el servidor es `recibido`,
 * su propio sello de llegada: pedir por la fecha del cambio se dejaría fuera
 * lo que llega tarde, que es lo que pasa con un aparato que ha estado días
 * apagado. Lo explica entero `Cambio.sello`.
 */
export type PorDonde = 'updated' | 'recibido';

/** Pasa una fila de SQLite a la forma en que viaja entre aparatos. */
function aCambio(
  tabla: { tabla: string; clave: string[]; campos: string[] },
  fila: Record<string, unknown>,
): Cambio {
  const campos: Record<string, string | number | null> = {};
  for (const campo of tabla.campos) campos[campo] = (fila[campo] ?? null) as string | number | null;
  const cambio: Cambio = {
    tabla: tabla.tabla,
    clave: tabla.clave.map((columna) => String(fila[columna])),
    campos,
    actualizado: fila.updated as string,
    borrado: Number(fila.deleted) === 1,
    origen: (fila.origin ?? null) as string | null,
  };
  if (typeof fila.recibido === 'string') cambio.sello = fila.recibido;
  return cambio;
}

/**
 * Lo cambiado después de `marca`, lápidas incluidas.
 *
 * La marca es un `updated` de los que ya se mandaron, y la comparación es
 * estricta para no volver a mandar lo mismo cada vez. El riesgo conocido es
 * que dos filas caigan en el mismo milisegundo y una se quede fuera; a
 * cambio, la alternativa —comparar con `>=`— reenvía en cada vuelta lo último
 * que se sincronizó, para siempre.
 */
export function cambiosDesde(base: BaseSQL, marca: string, porDonde: PorDonde = 'updated'): Cambio[] {
  const cambios: Cambio[] = [];
  for (const tabla of SINCRONIZADAS) {
    // El nombre de la columna no sale de la petición: es uno de los dos
    // valores del tipo, que son código.
    const columnas = columnasDe(tabla);
    if (porDonde === 'recibido') columnas.push('recibido');

    const filas = base.filas(
      `SELECT ${columnas.join(', ')} FROM ${tabla.tabla} WHERE ${porDonde} > ? ORDER BY ${porDonde}`,
      [marca],
    );
    for (const fila of filas) cambios.push(aCambio(tabla, fila));
  }
  return cambios;
}

/**
 * ¿Tiene esto forma de cambio, y de uno que sepamos escribir?
 *
 * Lo que llega por la red no es de fiar aunque venga de un aparato conocido:
 * una versión con un fallo, una petición a medio escribir o alguien probando
 * cosas. Los nombres de tabla y de columna **nunca** salen de aquí —salen de
 * `SINCRONIZADAS`, que es código—, así que no hay inyección posible; lo que
 * sí puede pasar es que una clave venga con más o menos partes de las que
 * lleva la tabla y el `INSERT` salga con los parámetros descuadrados.
 */
export function cambioValido(valor: unknown): valor is Cambio {
  if (!valor || typeof valor !== 'object') return false;
  const cambio = valor as Partial<Cambio>;

  const tabla = SINCRONIZADAS.find((una) => una.tabla === cambio.tabla);
  if (!tabla) return false;

  if (!Array.isArray(cambio.clave) || cambio.clave.length !== tabla.clave.length) return false;
  if (cambio.clave.some((parte) => typeof parte !== 'string')) return false;

  if (!cambio.campos || typeof cambio.campos !== 'object') return false;
  for (const campo of tabla.campos) {
    const dato = cambio.campos[campo];
    if (dato !== null && dato !== undefined && typeof dato !== 'string' && typeof dato !== 'number') return false;
  }

  if (typeof cambio.actualizado !== 'string' || !cambio.actualizado) return false;
  if (typeof cambio.borrado !== 'boolean') return false;
  if (cambio.origen !== null && typeof cambio.origen !== 'string') return false;

  return true;
}

/** Lo que hay guardado de las filas que llegan, para poder compararlas. */
function locales(base: BaseSQL, entrantes: Cambio[]): Cambio[] {
  const encontrados: Cambio[] = [];
  for (const tabla of SINCRONIZADAS) {
    const suyos = entrantes.filter((cambio) => cambio.tabla === tabla.tabla);
    if (suyos.length === 0) continue;

    const columnas = columnasDe(tabla).join(', ');
    const condicion = tabla.clave.map((columna) => `${columna} = ?`).join(' AND ');
    for (const cambio of suyos) {
      const fila = base.filas(`SELECT ${columnas} FROM ${tabla.tabla} WHERE ${condicion}`, cambio.clave)[0];
      if (fila) encontrados.push(aCambio(tabla, fila));
    }
  }
  return encontrados;
}

/** Mete —o pisa— una fila con lo que ha llegado del otro aparato. */
function escribir(base: BaseSQL, cambio: Cambio): void {
  const tabla = SINCRONIZADAS.find((una) => una.tabla === cambio.tabla);
  // Una tabla desconocida viene de una versión más nueva de la app: se deja
  // pasar en vez de tirar abajo la sincronización entera por ella.
  if (!tabla) return;

  const columnas = columnasDe(tabla);
  const huecos = columnas.map(() => '?').join(', ');
  const pisar = [...tabla.campos, 'updated', 'deleted', 'origin']
    .map((columna) => `${columna} = excluded.${columna}`)
    .join(', ');

  base.ejecutar(
    `INSERT INTO ${tabla.tabla} (${columnas.join(', ')}) VALUES (${huecos})
     ON CONFLICT(${tabla.clave.join(', ')}) DO UPDATE SET ${pisar}`,
    [
      ...cambio.clave,
      ...tabla.campos.map((campo) => cambio.campos[campo] ?? null),
      cambio.actualizado,
      cambio.borrado ? 1 : 0,
      cambio.origen,
    ],
  );
}

/**
 * Aplica lo que llega de otro aparato, descartando lo que pierda.
 *
 * Se compara contra lo que hay **antes** de escribir nada: recibir un cambio
 * no es aplicarlo. Y va en una transacción para que una tanda entre entera o
 * no entre: a medias, la marca de agua diría que se sincronizó algo que no
 * está, y eso no se arregla solo en la siguiente vuelta.
 */
export function aplicarCambios(base: BaseSQL, entrantes: Cambio[]): Cambio[] {
  // Lo que no tenga forma de cambio se tira sin más. Descartar una fila mala
  // es mejor que rechazar la tanda entera: un aparato con un dato corrupto
  // dejaría de sincronizar del todo, y el resto de su historial no tiene la
  // culpa.
  const buenos = entrantes.filter(cambioValido);
  if (buenos.length === 0) return [];

  const ganadores = fusionar(locales(base, buenos), buenos);
  if (ganadores.length === 0) return [];

  base.ejecutar('BEGIN');
  try {
    for (const cambio of ganadores) escribir(base, cambio);
    base.ejecutar('COMMIT');
  } catch (fallo) {
    base.ejecutar('ROLLBACK');
    throw fallo;
  }

  // Se devuelve lo que de verdad se ha escrito, no lo que llegó: el servidor
  // lo necesita para ponerle su sello de recepción, y solo a esas filas.
  return ganadores;
}

/**
 * Marca las filas con la hora a la que el servidor las ha recibido.
 *
 * Es lo que permite pedir novedades sin fiarse del reloj de los aparatos.
 * Solo lo usa el servidor: en un aparato la columna `recibido` ni existe.
 */
export function sellarRecepcion(base: BaseSQL, aplicados: Cambio[], sello: string): void {
  for (const cambio of aplicados) {
    const tabla = SINCRONIZADAS.find((una) => una.tabla === cambio.tabla);
    if (!tabla) continue;

    const condicion = tabla.clave.map((columna) => `${columna} = ?`).join(' AND ');
    base.ejecutar(`UPDATE ${tabla.tabla} SET recibido = ? WHERE ${condicion}`, [sello, ...cambio.clave]);
  }
}
