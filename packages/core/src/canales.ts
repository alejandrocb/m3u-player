/**
 * El identificador de un canal, en un solo sitio.
 *
 * Un canal se identifica por su `tvg-id` si lo trae, y si no por su nombre
 * limpio más su grupo. El prefijo —`tvg:` o `name:`— no es decoración: sin él,
 * un canal llamado como el `tvg-id` de otro se llevaría su historial por
 * delante.
 *
 * Vive aquí porque lo calculan **dos caminos distintos** —el M3U del
 * escritorio y el catálogo por `player_api` de Android— y tienen que dar
 * exactamente lo mismo: el identificador viaja en la sincronización y es lo
 * que hace que un canal marcado en la tele sea el mismo en la tablet.
 *
 * Y lo necesita un tercero: la parrilla. El EPG del panel habla de `tvg-id`
 * pelados, así que para casar sus programas con nuestros canales hay que
 * pasar por aquí. Es justo lo que faltaba cuando la programación no salía en
 * ninguna ficha: se buscaba `La1.es` en una biblioteca que lo tenía guardado
 * como `tvg:La1.es`.
 */

import { parseChannelName, slug } from './normalize.ts';

/** El de un canal que trae `tvg-id`, que es como lo llama también el EPG. */
export function idDeCanalPorTvg(tvgId: string): string {
  return `tvg:${tvgId}`;
}

/** El de un canal sin `tvg-id`: su nombre limpio dentro de su grupo. */
export function idDeCanalPorNombre(nombre: string, grupo: string): string {
  return `name:${slug(nombre)}@${slug(grupo)}`;
}

/**
 * La clave laxa con la que se casa un canal con su programación.
 *
 * El EPG del panel trae **un solo canal por cadena** —"Telecinco HD"— y el
 * catálogo trae tres: FHD, HD y SD, cada una con su `tvg-id`. Casando estricto,
 * dos de las tres se quedan sin programación, y el usuario ve lo mismo que en
 * cualquier reproductor comercial: las tres con su parrilla. La diferencia es
 * que ellos casan por nombre.
 *
 * Así que esta clave tira la calidad y las mayúsculas: "Telecinco FHD",
 * "Telecinco HD" y "Telecinco SD" caen en `telecinco`, y también "Be Mad" y
 * "BE MAD", que el proveedor manda como dos canales distintos.
 *
 * Es **el segundo intento, nunca el primero**: primero se busca por
 * identificador, que no se equivoca nunca. Esto solo entra cuando no hay nada,
 * y a cambio de un riesgo pequeño —dos cadenas distintas que se llamen igual
 * sin la calidad— resuelve la mayoría de los huecos.
 */
export function claveDeParrilla(nombre: string): string {
  return slug(parseChannelName(nombre).name);
}

/**
 * La misma clave, sacada del identificador de un canal de la biblioteca.
 *
 * Vale para las dos formas: `tvg:Telecinco HD` y `name:telecinco@generalistas`
 * dan las dos `telecinco`.
 */
export function claveDeParrillaDeId(canalId: string): string {
  if (canalId.startsWith('tvg:')) return claveDeParrilla(canalId.slice(4));
  if (canalId.startsWith('name:')) return claveDeParrilla(canalId.slice(5).split('@')[0] ?? '');
  return claveDeParrilla(canalId);
}
