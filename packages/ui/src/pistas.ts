/**
 * Qué audio y qué subtítulos quiere cada persona en cada serie.
 *
 * Uno ve una serie entera en inglés con subtítulos en inglés y otro la ve
 * doblada: es una preferencia **de la persona y de la serie**, no del fichero,
 * así que se guarda en los ajustes del perfil y viaja con la sincronización
 * como el resto. Empezar cada capítulo eligiendo pista es de las cosas que más
 * cansan de un reproductor.
 *
 * **Se recuerda el idioma, no el número de pista.** El número depende de cómo
 * empaquetara el fichero quien lo codificó, y cambia de un capítulo a otro:
 * guardar "la pista 2" acaba poniendo el comentario del director. Lo que no
 * cambia es "inglés".
 */

/** Lo elegido en una serie. `null` es "no se ha elegido nada todavía". */
export interface PistasElegidas {
  /** Idioma o nombre de la pista de audio. */
  audio: string | null;
  /**
   * Lo mismo para los subtítulos, con un valor más: `SIN_SUBTITULOS`.
   *
   * Apagarlos es una elección como otra cualquiera y hay que recordarla: si se
   * guardara como "nada elegido", una serie vista sin subtítulos los volvería
   * a sacar en el capítulo siguiente.
   */
  subtitulo: string | null;
}

/** Los subtítulos, apagados a propósito. */
export const SIN_SUBTITULOS = 'ninguno';

/** Dónde se guarda lo elegido para una serie, dentro de los ajustes del perfil. */
export function clavePistas(serieId: string): string {
  return `pistas:${serieId}`;
}

/** Lo guardado, que siempre es texto y puede venir de una versión más nueva. */
export function leerPistas(valor: string | null | undefined): PistasElegidas {
  if (!valor) return { audio: null, subtitulo: null };
  try {
    const leido = JSON.parse(valor) as Partial<PistasElegidas>;
    return {
      audio: typeof leido.audio === 'string' && leido.audio ? leido.audio : null,
      subtitulo: typeof leido.subtitulo === 'string' && leido.subtitulo ? leido.subtitulo : null,
    };
  } catch {
    // Un valor ilegible no puede tumbar la reproducción: se empieza de cero.
    return { audio: null, subtitulo: null };
  }
}

export function escribirPistas(elegidas: PistasElegidas): string {
  return JSON.stringify(elegidas);
}

/** Una pista del fichero, con lo poco que hace falta para reconocerla. */
export interface PistaDisponible {
  indice: number;
  nombre: string;
  idioma?: string | null;
}

/**
 * Cuál de las pistas de este fichero es la que se recordaba.
 *
 * Se busca primero por idioma, que es lo estable, y luego por el nombre
 * entero, que es lo que se guarda cuando el fichero no dice el idioma. Si no
 * está —este capítulo no trae inglés—, se devuelve `null` y manda lo que
 * hubiera por defecto: es mejor oírlo en español que no oírlo.
 */
export function pistaQueToca(
  pistas: PistaDisponible[],
  recordada: string | null,
): PistaDisponible | null {
  if (!recordada) return null;
  const buscada = recordada.trim().toLowerCase();
  if (!buscada) return null;

  return (
    pistas.find((pista) => (pista.idioma ?? '').trim().toLowerCase() === buscada) ??
    pistas.find((pista) => pista.nombre.trim().toLowerCase() === buscada) ??
    null
  );
}

/**
 * Con qué nombre se recuerda una pista.
 *
 * El idioma si lo trae —"en", "spa"— y si no, el nombre entero, que al menos
 * casará con el del capítulo siguiente si viene del mismo codificador.
 */
export function comoRecordar(pista: PistaDisponible): string {
  return (pista.idioma ?? '').trim() || pista.nombre.trim();
}
