/**
 * El trabajo de fondo del servidor: preparar las portadas de cada lista.
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
 * ayer es mejor que ninguna.
 */

import type { Panel } from './panel.ts';
import { VERSION, prepararPortadas } from './portadas.ts';

/** Cada cuánto se rehace lo preparado. */
const CADA_HORAS = 24;

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

/** Prepara lo que toque, mire cuando mire. Devuelve cuántas listas ha hecho. */
export async function prepararLoQueToque(panel: Panel, ahora = new Date()): Promise<number> {
  let hechas = 0;

  /*
    Agrupadas por URL, no por lista: la misma lista puede estar dada de alta en
    dos casas —lo normal si la contratas una vez y la repartes—, y el catálogo
    que hay detrás es el mismo. Prepararla dos veces sería pagar el doble de
    peticiones al panel para el mismo resultado.
  */
  const listas = panel.listasTodas();
  const porUrl = new Map<string, typeof listas>();
  for (const lista of listas) {
    const mismas = porUrl.get(lista.url);
    if (mismas) mismas.push(lista);
    else porUrl.set(lista.url, [lista]);
  }

  for (const [url, mismas] of porUrl) {
    // Basta con que a una le toque: se guarda para todas.
    const toca = mismas.some((lista) => {
      const guardado = panel.portadasDe(lista.id);
      if (!guardado) return true;
      const datos = guardado.datos as { version?: number } | null;
      if (datos?.version !== VERSION) return true;
      const horas = (ahora.getTime() - Date.parse(guardado.generado)) / 3_600_000;
      return !Number.isFinite(horas) || horas >= CADA_HORAS;
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

/**
 * Arranca la vigilancia. Devuelve la función de parar, para los tests y para
 * el cierre ordenado.
 */
export function vigilarPortadas(panel: Panel): () => void {
  const revisar = (): void => {
    void prepararLoQueToque(panel).catch((fallo) => console.error('[portadas] fallo revisando:', fallo));
  };

  // Una revisión al arrancar: si el contenedor se reinicia por la noche, no
  // hay que esperar a la hora siguiente para que quede algo preparado.
  revisar();
  const reloj = setInterval(revisar, REVISAR_MS);
  // Sin `unref`, el proceso no terminaría nunca por culpa de este reloj.
  reloj.unref?.();

  return () => clearInterval(reloj);
}
