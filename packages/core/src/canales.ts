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

import { slug } from './normalize.ts';

/** El de un canal que trae `tvg-id`, que es como lo llama también el EPG. */
export function idDeCanalPorTvg(tvgId: string): string {
  return `tvg:${tvgId}`;
}

/** El de un canal sin `tvg-id`: su nombre limpio dentro de su grupo. */
export function idDeCanalPorNombre(nombre: string, grupo: string): string {
  return `name:${slug(nombre)}@${slug(grupo)}`;
}
