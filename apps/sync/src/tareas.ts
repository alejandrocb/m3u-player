/**
 * El trabajo de fondo del servidor: las portadas de cada lista y su parrilla.
 *
 * Una vez al día y por lista, no por aparato: el catálogo es el mismo para
 * toda la casa, así que el trabajo se hace una vez y lo aprovechan la tele, la
 * tablet y el teléfono. Sin esto, cada aparato preguntaría lo suyo al panel en
 * cada arranque.
 *
 * Las listas se preparan **de una en una**. Son peticiones a un panel que
 * cuenta las conexiones, y no hay ninguna prisa: lo que importa es que esté
 * hecho cuando alguien encienda la tele, no que tarde treinta segundos menos.
 *
 * Si una lista falla —panel caído, credenciales caducadas— se anota y se sigue
 * con la siguiente. Lo que hubiera preparado antes se queda: una portada de
 * ayer es mejor que ninguna, y una parrilla de ayer todavía tiene por delante
 * el día que viene.
 *
 * Las dos tareas van por separado aunque compartan la vuelta: la parrilla se
 * rehace más a menudo —es una sola petición y lo que enseña cambia cada hora—
 * y que falle una no puede llevarse la otra por delante.
 */

import type { Panel } from './panel.ts';
import { traerParrilla } from './parrilla.ts';
import { VERSION, prepararPortadas } from './portadas.ts';

/** Cada cuánto se rehacen las portadas. */
const CADA_HORAS = 24;

/**
 * Cada cuánto se rehace la parrilla.
 *
 * El XMLTV trae dos o tres días, así que con una vez al día bastaría; se hace
 * dos porque cuesta una petición y así lo que se enseña no arrastra los
 * cambios de última hora del panel.
 */
const PARRILLA_CADA_HORAS = 12;

/** Cada cuánto se mira si toca. Más fino que el día, para no dormirse. */
const REVISAR_MS = 60 * 60 * 1000;

/** Redacta la URL del panel: lleva usuario y contraseña. */
function sinCredenciales(url: string): string {
  try {
    const { protocol, host } = new URL(url);
    return `${protocol}//${host}/…`;
  } catch {
    return '(url ilegible)';
  }
}

/** ¿Ha pasado ya el plazo desde que se hizo? Sin fecha, toca. */
function vencido(generado: string | undefined, horas: number, ahora: Date): boolean {
  if (!generado) return true;
  const pasadas = (ahora.getTime() - Date.parse(generado)) / 3_600_000;
  return !Number.isFinite(pasadas) || pasadas >= horas;
}

/** Las listas agrupadas por URL: la misma lista en dos casas se prepara una vez. */
function porUrl(panel: Panel): Map<string, ReturnType<Panel['listasTodas']>> {
  const agrupadas = new Map<string, ReturnType<Panel['listasTodas']>>();
  for (const lista of panel.listasTodas()) {
    const mismas = agrupadas.get(lista.url);
    if (mismas) mismas.push(lista);
    else agrupadas.set(lista.url, [lista]);
  }
  return agrupadas;
}

/** Prepara lo que toque, mire cuando mire. Devuelve cuántas listas ha hecho. */
export async function prepararLoQueToque(panel: Panel, ahora = new Date()): Promise<number> {
  let hechas = 0;

  for (const [url, mismas] of porUrl(panel)) {
    // Basta con que a una le toque: se guarda para todas.
    const toca = mismas.some((lista) => {
      const guardado = panel.portadasDe(lista.id);
      const datos = guardado?.datos as { version?: number } | null;
      if (datos?.version !== VERSION) return true;
      return vencido(guardado?.generado, CADA_HORAS, ahora);
    });
    if (!toca) continue;

    const nombre = mismas.map((lista) => lista.nombre).join(', ');
    try {
      const preparado = await prepararPortadas(url);
      for (const lista of mismas) panel.guardarPortadas(lista.id, preparado);
      hechas += 1;
      console.log(
        `[portadas] ${nombre}: ${preparado.portadas.length} preparadas, ${preparado.generos.length} géneros`,
      );
    } catch (fallo) {
      // La URL nunca al registro: lleva las credenciales del panel dentro.
      console.error(`[portadas] ${nombre} (${sinCredenciales(url)}) falló:`, fallo);
    }
  }

  return hechas;
}

/** Se trae la parrilla de las listas a las que les toque. */
export async function traerParrillasQueToquen(panel: Panel, ahora = new Date()): Promise<number> {
  let hechas = 0;

  for (const [url, mismas] of porUrl(panel)) {
    const toca = mismas.some((lista) => vencido(panel.parrillaDe(lista.id)?.generado, PARRILLA_CADA_HORAS, ahora));
    if (!toca) continue;

    const nombre = mismas.map((lista) => lista.nombre).join(', ');
    try {
      const traida = await traerParrilla(url);
      for (const lista of mismas) panel.guardarParrilla(lista.id, traida.programas);
      hechas += 1;
      console.log(`[parrilla] ${nombre}: ${traida.canales} canales, ${traida.programas.length} programas`);
    } catch (fallo) {
      console.error(`[parrilla] ${nombre} (${sinCredenciales(url)}) falló:`, fallo);
    }
  }

  return hechas;
}

/**
 * Arranca la vigilancia. Devuelve la función de parar, para los tests y para
 * el cierre ordenado.
 */
export function vigilarPortadas(panel: Panel): () => void {
  const revisar = (): void => {
    void prepararLoQueToque(panel).catch((fallo) => console.error('[portadas] fallo revisando:', fallo));
    void traerParrillasQueToquen(panel).catch((fallo) => console.error('[parrilla] fallo revisando:', fallo));
  };

  // Una revisión al arrancar: si el contenedor se reinicia por la noche, no
  // hay que esperar a la hora siguiente para que quede algo preparado.
  revisar();
  const reloj = setInterval(revisar, REVISAR_MS);
  // Sin `unref`, el proceso no terminaría nunca por culpa de este reloj.
  reloj.unref?.();

  return () => clearInterval(reloj);
}
