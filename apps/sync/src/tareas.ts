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

import { rellenarGeneros } from './generos.ts';
import type { Panel } from './panel.ts';
import { traerParrilla } from './parrilla.ts';
import { VERSION, prepararPortadas } from './portadas.ts';
import { crearTmdb } from './tmdb.ts';
import type { Tmdb } from './tmdb.ts';

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

/**
 * Cada cuánto se rellenan géneros, y cuántos por pasada.
 *
 * **Depende de a quién se le pregunte.** Al panel hay que ir con cuidado: son
 * peticiones a un servidor que cuenta conexiones, así que quinientas al día y
 * de madrugada, cuando no hay nadie viendo nada. Con TMDb no hay tal
 * problema, y entonces se va a por dos mil cada vez y a cualquier hora: el
 * catálogo entero queda cubierto en una tarde en vez de en un mes.
 */
const GENEROS_POR_PASADA = { panel: 500, tmdb: 2000 };
const GENEROS_CADA_HORAS = { panel: 24, tmdb: 1 };

/**
 * A qué horas se le pregunta al panel.
 *
 * La primera pasada de una lista no espera —es la que hace que se note algo el
 * día que se despliega—, las demás sí. Con TMDb no se aplica.
 */
const MADRUGADA = { desde: 2, hasta: 7 };

/** Cada cuánto se mira si toca. Más fino que el día, para no dormirse. */
const REVISAR_MS = 60 * 60 * 1000;

/**
 * TMDb, si hay token. Nunca se registra su valor, solo si está.
 *
 * El token vive en un fichero del VPS y llega por `TMDB_TOKEN`. Sin él todo
 * funciona igual, solo que preguntándole al panel y mucho más despacio, así
 * que lo que no puede pasar es que se caiga a lo lento **sin decirlo**: el
 * síntoma es que el servidor se queda callado hasta la madrugada y no hay
 * forma de saber si es que está esperando o es que algo va mal.
 */
export function tmdbSiHay(): Tmdb | undefined {
  const token = process.env.TMDB_TOKEN?.trim();
  return token ? crearTmdb(token) : undefined;
}

/** Con qué cuenta el servidor para los géneros. Se dice al arrancar. */
export function comoSeAveriguanLosGeneros(): string {
  return tmdbSiHay()
    ? `TMDb (${GENEROS_POR_PASADA.tmdb} por pasada, cada ${GENEROS_CADA_HORAS.tmdb} h)`
    : `solo el panel (${GENEROS_POR_PASADA.panel} al día, de ${MADRUGADA.desde} a ${MADRUGADA.hasta} h).` +
      ' Sin TMDB_TOKEN: el catálogo tarda un mes en vez de una tarde';
}

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
 * Rellena el género de unas cuantas películas de cada lista.
 *
 * `get_vod_streams` no trae el género y `get_vod_info` es una petición por
 * título: con 18.042 películas, la única forma de tenerlos todos es ir poco a
 * poco. A este ritmo el catálogo entero queda cubierto en poco más de un mes,
 * y lo primero que se cubre es lo último que ha entrado, que es lo que se está
 * mirando.
 */
export async function rellenarGenerosQueToquen(
  panel: Panel,
  ahora = new Date(),
  opciones: { forzar?: boolean } = {},
): Promise<number> {
  let hechas = 0;

  const tmdb = tmdbSiHay();
  const via = tmdb ? 'tmdb' : 'panel';

  for (const [url, mismas] of porUrl(panel)) {
    const primera = mismas[0];
    if (!primera) continue;

    const cuenta = panel.cuantosGeneros(primera.id);
    /*
      La primera revisión de cada arranque no espera a que se cumpla el plazo.
      Con el plazo a rajatabla, redesplegar dos veces seguidas dejaba al
      servidor callado durante horas: en cada arranque decidía que aún no
      tocaba, y la siguiente oportunidad llegaba una hora después de ese
      arranque. Lo que se quiere al desplegar es ver que funciona.
    */
    const sinEsperar = opciones.forzar || cuenta.preguntadas === 0;
    const pasadas = (ahora.getTime() - cuenta.ultima) / 3_600_000;
    if (!sinEsperar && pasadas < GENEROS_CADA_HORAS[via]) continue;
    if (!sinEsperar && !tmdb && (ahora.getHours() < MADRUGADA.desde || ahora.getHours() >= MADRUGADA.hasta)) continue;

    const nombre = mismas.map((lista) => lista.nombre).join(', ');
    try {
      /*
        Lo ya preguntado se mira en una sola lista: las que comparten URL
        comparten catálogo, y todo lo que se averigua se guarda en las dos.
      */
      const averiguados = await rellenarGeneros(url, {
        conocidas: panel.generosConocidos(primera.id),
        cuantas: GENEROS_POR_PASADA[via],
        tmdb,
        avisar: (faltan, deEstaVez) =>
          console.log(`[generos] ${nombre} (${via}): empezando, ${deEstaVez} de las ${faltan} que faltan`),
      });
      // Nada que guardar: el catálogo está cubierto y no ha entrado nada
      // nuevo. No se anota ni se registra, que si no sería una línea por hora
      // diciendo que no hay nada que hacer.
      if (averiguados.length === 0) continue;

      // El mismo sello para todas: es lo que hace que la marca de agua del
      // aparato valga aunque la casa tenga dos listas.
      const sello = Date.now();
      for (const lista of mismas) panel.guardarGeneros(lista.id, averiguados, sello);
      hechas += 1;

      const total = panel.cuantosGeneros(primera.id);
      const conGenero = averiguados.filter((uno) => uno.genero !== '').length;
      console.log(
        `[generos] ${nombre} (${via}): ${conGenero} de ${averiguados.length} preguntadas, ${total.conGenero} en total`,
      );
    } catch (fallo) {
      console.error(`[generos] ${nombre} (${sinCredenciales(url)}) falló:`, fallo);
    }
  }

  return hechas;
}

/**
 * Arranca la vigilancia. Devuelve la función de parar, para los tests y para
 * el cierre ordenado.
 */
export function vigilarPortadas(panel: Panel): () => void {
  // La primera revisión no espera plazos: es la que hace que al desplegar se
  // vea enseguida si esto funciona.
  let primera = true;

  const revisar = (): void => {
    void prepararLoQueToque(panel).catch((fallo) => console.error('[portadas] fallo revisando:', fallo));
    void traerParrillasQueToquen(panel).catch((fallo) => console.error('[parrilla] fallo revisando:', fallo));
    void rellenarGenerosQueToquen(panel, new Date(), { forzar: primera }).catch((fallo) =>
      console.error('[generos] fallo revisando:', fallo),
    );
    primera = false;
  };

  // Una revisión al arrancar: si el contenedor se reinicia por la noche, no
  // hay que esperar a la hora siguiente para que quede algo preparado.
  revisar();
  const reloj = setInterval(revisar, REVISAR_MS);
  // Sin `unref`, el proceso no terminaría nunca por culpa de este reloj.
  reloj.unref?.();

  return () => clearInterval(reloj);
}
