/**
 * Limpieza de los nombres que manda el proveedor.
 *
 * Todo lo de aquí asume listas sucias: decoración en los grupos, sufijos de
 * calidad pegados al nombre, acentos que aparecen y desaparecen, y separadores
 * que no son contenido.
 */

/** Quita acentos y diacríticos: "Películas" -> "Peliculas". */
export function deaccent(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Clave de comparación: sin acentos, sin símbolos, en minúsculas. */
export function fold(value: string): string {
  return deaccent(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Identificador estable y legible: "Avatar: La leyenda de Aang" -> "avatar-la-leyenda-de-aang". */
export function slug(value: string): string {
  return fold(value).replace(/\s+/g, '-');
}

/**
 * Quita la decoración con la que los proveedores fuerzan el orden alfabético:
 * "== NOTICIAS" -> "NOTICIAS", "▶ DEPORTES |" -> "DEPORTES".
 *
 * Se recorta cualquier símbolo de los extremos en vez de buscar un prefijo
 * concreto, porque el proveedor lo cambia sin avisar.
 */
export function cleanGroup(group: string): string {
  const trimmed = group.replace(/^[^\p{L}\p{N}]+/u, '').replace(/[^\p{L}\p{N})\]]+$/u, '').trim();
  return trimmed || group.trim();
}

/** Calidades reconocidas, de mejor a peor. El orden define el `rank`. */
const QUALITY_LADDER = ['8K', '4K', 'UHD', 'FHD', 'FULLHD', 'HD', 'SD', 'LQ'] as const;

/** Etiquetas técnicas que ensucian el título pero conviene conservar aparte. */
const TAG_PATTERN =
  /\b(?:x264|x265|h264|h265|hevc|av1|10bits?|web-?dl|web-?rip|bluray|brrip|hdrip|dvdrip|remux|hdr10?\+?|dolby(?:\s?vision)?|atmos|dts(?:-hd)?|e?ac-?3|aac|multi|dual|cast(?:ellano)?|lat(?:ino)?|vose?|vos|sub(?:s|titulado)?|3d|imax|extended|unrated|director'?s?\s?cut)\b/gi;

/**
 * Las abreviaturas que el proveedor escribe con puntos.
 *
 * "V.O.S.E." es lo mismo que "VOSE", pero los puntos rompen los límites de
 * palabra del patrón de etiquetas, y el título se quedaba con ellos dentro. El
 * efecto no se ve donde se escribe: como la identidad de una película es su
 * título más el año, *La captura* y *La captura V.O.S.E.* acababan siendo dos
 * películas distintas en la biblioteca.
 *
 * De paso unifica las siglas —*S.W.A.T.* y *SWAT*—, que el proveedor escribe
 * de las dos formas en la misma lista.
 */
const PUNTEADAS = /\b([A-Za-z](?:\.[A-Za-z]){1,4})\.?(?=\s|$|[)\]])/g;

/** Resoluciones escritas como 1080p / 720p / 2160p. */
const RESOLUTION_PATTERN = /\b(\d{3,4})[pi]\b/i;

const QUALITY_PATTERN = new RegExp(String.raw`\b(${QUALITY_LADDER.join('|')})\b`, 'i');

/**
 * Puntuación de calidad, mayor es mejor.
 * Las resoluciones numéricas ganan a las etiquetas porque son más precisas.
 */
export function qualityRank(quality: string | null): number {
  if (!quality) return 0;
  const resolution = quality.match(/^(\d{3,4})[pi]$/i);
  if (resolution) return Number(resolution[1]);

  const index = QUALITY_LADDER.indexOf(quality.toUpperCase() as (typeof QUALITY_LADDER)[number]);
  if (index === -1) return 0;
  // 8K->2160, 4K/UHD->2160, FHD->1080, HD->720, SD->480, LQ->240
  const scale = [4320, 2160, 2160, 1080, 1080, 720, 480, 240];
  return scale[index] ?? 0;
}

export interface ParsedName {
  /** Título ya limpio y presentable. */
  title: string;
  /** "FHD", "1080p"... o null. */
  quality: string | null;
  year: number | null;
  /** Etiquetas técnicas encontradas, en minúsculas. */
  tags: string[];
}

/**
 * Descompone el nombre crudo de una entrada.
 *
 * "Lola Pater (2017)_720p x264" -> { title: "Lola Pater", year: 2017,
 *                                    quality: "720p", tags: ["x264"] }
 */
export function parseName(raw: string): ParsedName {
  // Primero las abreviaturas con puntos, para que el patrón de etiquetas las
  // reconozca: "V.O.S.E." pasa a "VOSE" y de ahí a etiqueta, como debe.
  let working = raw.replace(/_/g, ' ').replace(PUNTEADAS, (abreviatura) => abreviatura.replace(/\./g, ''));

  const tags: string[] = [];
  working = working.replace(TAG_PATTERN, (match) => {
    tags.push(match.toLowerCase());
    return ' ';
  });

  let quality: string | null = null;
  const resolution = working.match(RESOLUTION_PATTERN);
  if (resolution) {
    quality = resolution[0].toLowerCase();
    working = working.replace(RESOLUTION_PATTERN, ' ');
  }

  const label = working.match(QUALITY_PATTERN);
  if (label) {
    // La etiqueta solo manda si no había resolución numérica, que es más fiable.
    if (!quality) quality = label[1]!.toUpperCase();
    working = working.replace(QUALITY_PATTERN, ' ');
  }

  let year: number | null = null;
  // Solo entre paréntesis o corchetes: un "2012" suelto puede ser el título.
  const yearMatch = working.match(/[([](\d{4})[)\]]/);
  if (yearMatch) {
    const candidate = Number(yearMatch[1]);
    if (candidate >= 1900 && candidate <= 2100) {
      year = candidate;
      working = working.replace(yearMatch[0], ' ');
    }
  }

  return { title: tidy(working), quality, year, tags };
}

/** Colapsa espacios y se come la puntuación huérfana que deja el limpiado. */
export function tidy(value: string): string {
  return value
    // Paréntesis que se quedan sin contenido de verdad al quitar etiquetas:
    // "Friends (Latino - Castellano)" -> "Friends ( - )" -> "Friends".
    // Se exige que no quede dentro ninguna letra ni cifra, para no tocar
    // títulos legítimos como "Rocky (2)".
    .replace(/[\s._-]*[([{][^\p{L}\p{N}]*[)\]}][\s._-]*/gu, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,:;.!?])/g, '$1')
    .replace(/^[\s._\-|·•]+/, '')
    .replace(/[\s._\-|·•]+$/, '')
    .trim();
}

/**
 * Separa el sufijo de calidad del nombre de un canal.
 * "24 Horas FHD" -> { name: "24 Horas", quality: "FHD" }
 *
 * A diferencia de `parseName`, aquí solo se mira el final del nombre: en
 * directo el resto del texto es parte de la marca del canal ("Canal Sur 2").
 */
export function parseChannelName(raw: string): { name: string; quality: string | null } {
  const pattern = new RegExp(String.raw`[\s._-]+(${QUALITY_LADDER.join('|')}|\d{3,4}[pi])\s*$`, 'i');
  const match = raw.match(pattern);
  if (!match) return { name: tidy(raw), quality: null };

  const token = match[1]!;
  const quality = /^\d/.test(token) ? token.toLowerCase() : token.toUpperCase();
  return { name: tidy(raw.slice(0, match.index)), quality };
}
