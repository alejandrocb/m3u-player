/**
 * La parrilla del directo, traída de una vez y guardada en el servidor.
 *
 * El panel ofrece la programación por dos caminos y el que sale a cuenta
 * depende de quién pregunte. Medido contra la lista real:
 *
 * - `get_short_epg`: 3,4 KB, pero **una petición por canal**. En el aparato,
 *   con el foco recorriendo la lista, es una petición por cada parada.
 * - `xmltv.php`: 5,5 MB en 4,9 s con 191 canales y 11.515 programas, dos o
 *   tres días de parrilla, **en una sola petición**.
 *
 * Para un televisor lo segundo es inviable —descargar y analizar 5,5 MB de XML
 * cada vez que se abre el directo—, pero para el servidor de la casa es una
 * descarga al día que aprovechan los tres aparatos, igual que las portadas. Y
 * al aparato ya no le llega el XML sino el resumen: qué echan ahora y qué
 * viene después, que son decenas de kilobytes.
 *
 * Lo que hacía falta comprobar antes de montar esto era si los identificadores
 * casan, porque el XMLTV trae los suyos: casan, 191 de 191, porque son el
 * `tvg-id` de cada canal. Sin eso habría hecho falta emparejar por nombre.
 *
 * **272 de los 463 canales no traen `tvg-id`** y no salen en el XMLTV: son los
 * de eventos —NBA, NFL, jornadas de liga—. Esos no tienen programación por
 * ningún camino, así que la ficha del canal tiene que quedar bien sin ella.
 */

import { programasDeXmltv } from '@m3u/core';
import { credentialsFromUrl } from '@m3u/core/xtream';

import type { ProgramaGuardado } from './panel.ts';

/** Lo que se descarga y se guarda de una lista. */
export interface ParrillaTraida {
  programas: ProgramaGuardado[];
  canales: number;
}

export interface OpcionesParrilla {
  fetch?: typeof globalThis.fetch;
  /** Tope de espera: el EPG entero son megas y el panel no siempre corre. */
  timeoutMs?: number;
}

/**
 * El agente con el que se pide.
 *
 * El mismo que usa el `probe`: hay paneles que miran esto y contestan distinto
 * —o no contestan— a un cliente que no reconocen.
 */
const AGENTE = 'VLC/3.0.20 LibVLC/3.0.20';

/** Cuánto se espera al EPG entero antes de rendirse. */
const ESPERA_MS = 120_000;

/**
 * Se trae el EPG completo de una lista y lo deja listo para guardar.
 *
 * No escribe nada: quien decide qué se guarda es `panel.guardarParrilla`, y
 * así esto se puede probar sin base de datos.
 */
export async function traerParrilla(
  url: string,
  opciones: OpcionesParrilla = {},
): Promise<ParrillaTraida> {
  const credenciales = credentialsFromUrl(url);
  if (!credenciales) throw new Error('la URL de la lista no lleva usuario y contraseña');

  const pedir = opciones.fetch ?? globalThis.fetch;
  const epg = new URL('/xmltv.php', credenciales.base);
  epg.searchParams.set('username', credenciales.username);
  epg.searchParams.set('password', credenciales.password);

  const corte = AbortSignal.timeout(opciones.timeoutMs ?? ESPERA_MS);
  const respuesta = await pedir(epg.toString(), {
    headers: { 'User-Agent': AGENTE },
    signal: corte,
  });
  if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status} al pedir el EPG`);

  const xml = await respuesta.text();
  const programas = programasDeXmltv(xml);

  return {
    canales: new Set(programas.map((uno) => uno.canal)).size,
    programas: programas.map((uno) => ({
      canal: uno.canal,
      // En UTC y en texto: es lo que entra en SQLite y lo que se compara sin
      // depender del huso de nadie.
      desde: uno.desde.toISOString(),
      hasta: uno.hasta.toISOString(),
      titulo: uno.titulo,
      sinopsis: uno.descripcion,
    })),
  };
}
