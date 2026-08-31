/**
 * ¿Traen capítulos marcados los ficheros del panel?
 *
 * Es la pregunta que decide cómo se hace el "saltar intro". Hay dos formas de
 * saber dónde empieza la careta de una serie:
 *
 * 1. **Que el fichero lo diga.** Muchos MKV llevan capítulos con nombre
 *    —"Intro", "Opening", "Chapter 2"— en la cabecera. Si están, la intro sale
 *    exacta, gratis y en todos los capítulos, incluidos los que empiezan con
 *    una escena antes de la careta.
 * 2. **Deducirlo del sonido**, comparando dos capítulos y buscando el trozo
 *    que se repite. Es lo que hace Jellyfin con su plugin, y cuesta bajarse
 *    unos cuantos cientos de megas por temporada.
 *
 * Antes de meterse en lo segundo hay que descartar lo primero, y eso se mide
 * **leyendo unos pocos megas**: los capítulos de un MKV viven en la cabecera,
 * junto a las pistas, así que con una petición `Range` de los primeros bytes
 * suele bastar.
 *
 * Aquí no se descodifica nada ni se usa ffmpeg: se busca en esos bytes la
 * marca de capítulos de Matroska y los nombres que lleve. Es una comprobación
 * de "los hay o no los hay", no un analizador de MKV.
 */

/** Cuánto se lee de cada fichero. Los capítulos van al principio. */
const CABECERA_BYTES = 4 * 1024 * 1024;

const AGENTE = 'VLC/3.0.20 LibVLC/3.0.20';

export interface Capitulos {
  /** Cuántos bytes se han mirado de verdad. */
  leidos: number;
  /** El contenedor, por su firma: `matroska`, `mp4` o lo que sea. */
  contenedor: string;
  /** Si aparece la sección de capítulos de Matroska. */
  tieneCapitulos: boolean;
  /** Los nombres legibles que se hayan encontrado, sin repetir. */
  nombres: string[];
}

/** Los cuatro identificadores de Matroska que aquí interesan. */
const CHAPTERS = Buffer.from([0x10, 0x43, 0xa3, 0x70]);
const CHAP_STRING = Buffer.from([0x85]);

/** El contenedor, por los primeros bytes. La extensión de la URL miente. */
function contenedorDe(bytes: Buffer): string {
  if (bytes.length >= 4 && bytes.readUInt32BE(0) === 0x1a45dfa3) return 'matroska';
  if (bytes.length >= 12 && bytes.subarray(4, 8).toString('latin1') === 'ftyp') return 'mp4';
  if (bytes.subarray(0, 3).toString('latin1') === 'ID3') return 'mp3';
  if (bytes.subarray(0, 4).toString('latin1') === 'RIFF') return 'avi';
  return 'desconocido';
}

/**
 * Los nombres de capítulo que aparezcan en la cabecera.
 *
 * En Matroska, cada nombre va en un `ChapString` (0x85) precedido de su
 * longitud. Se buscan a lo bruto: no se recorre el árbol EBML entero, que para
 * responder "¿los hay?" es pasarse de listo.
 */
function nombresDeCapitulo(bytes: Buffer): string[] {
  const nombres = new Set<string>();
  let desde = 0;

  for (;;) {
    const donde = bytes.indexOf(CHAP_STRING, desde);
    if (donde < 0 || donde + 2 >= bytes.length) break;
    desde = donde + 1;

    // El byte siguiente es la longitud, con el bit de marca puesto.
    const marca = bytes[donde + 1]!;
    if (marca < 0x81 || marca > 0xfe) continue;
    const largo = marca - 0x80;
    if (largo < 2 || largo > 60 || donde + 2 + largo > bytes.length) continue;

    const texto = bytes.subarray(donde + 2, donde + 2 + largo).toString('utf8');
    // Un nombre de capítulo es texto legible; cualquier otra cosa era ruido.
    if (/^[\p{L}\p{N} .,:'()\-–—]+$/u.test(texto)) nombres.add(texto.trim());
  }

  return [...nombres];
}

/** Lee la cabecera de un fichero remoto y dice si trae capítulos. */
export async function capitulosDe(url: string): Promise<Capitulos> {
  const respuesta = await fetch(url, {
    headers: { 'User-Agent': AGENTE, Range: `bytes=0-${CABECERA_BYTES - 1}` },
  });
  if (!respuesta.ok && respuesta.status !== 206) {
    throw new Error(`HTTP ${respuesta.status} al pedir la cabecera`);
  }

  const bytes = Buffer.from(await respuesta.arrayBuffer());
  return {
    leidos: bytes.length,
    contenedor: contenedorDe(bytes),
    tieneCapitulos: bytes.includes(CHAPTERS),
    nombres: nombresDeCapitulo(bytes),
  };
}
