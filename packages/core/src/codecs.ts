/**
 * Qué pistas trae un MKV, leído de sus primeros kilobytes.
 *
 * Sirve para explicar por qué una tele no reproduce algo que el teléfono sí.
 * El teléfono decodifica casi todo por software; una tele solo lo que trae su
 * chip, y hay formatos que se quedan fuera: las Samsung, por ejemplo,
 * **dejaron de reproducir audio DTS a partir de 2018**. Sin esto, lo único que
 * se ve es un "Error inesperado" en la tele y ninguna pista de por qué.
 *
 * No hace falta leer el Matroska en serio. La cabecera de pistas va al
 * principio del fichero y el códec de cada una está escrito **en ASCII**
 * (`V_MPEG4/ISO/AVC`, `A_AC3`, `A_DTS`…), así que basta con buscar esas
 * cadenas en lo que haya llegado. Incluso si esos bytes se han leído como
 * texto UTF-8 y lo demás ha quedado hecho trizas: las cadenas ASCII salen
 * intactas.
 */

/** Los códecs que aparecen, en orden y sin repetir. */
export function codecsDeMatroska(inicio: string): string[] {
  const vistos = new Set<string>();
  /*
    Solo las familias que existen en Matroska. Buscar cualquier `X_ALGO`
    cazaría también trozos del propio vídeo que por casualidad lo parecen, y
    un códec inventado en un mensaje de error es peor que ninguno.
  */
  const familias =
    /(?:V_(?:MPEG4\/ISO\/AVC|MPEGH\/ISO\/HEVC|MPEG4\/ISO\/(?:SP|ASP|AP)|MPEG[12]|AV1|VP[89]|MS\/VFW\/FOURCC|THEORA)|A_(?:EAC3|AC3|DTS(?:\/[A-Z]+)?|AAC(?:\/[A-Z0-9/]+)?|MPEG\/L[123]|OPUS|TRUEHD|FLAC|VORBIS|PCM\/[A-Z/]+)|S_(?:TEXT\/(?:UTF8|ASS|SSA|WEBVTT)|HDMV\/PGS|VOBSUB))/g;
  for (const encontrado of inicio.matchAll(familias)) vistos.add(encontrado[0]);
  return [...vistos];
}

/**
 * Lo que de estos códecs es probable que una tele no sepa reproducir.
 *
 * Solo lo que se sabe con certeza que suele fallar; lo demás no se menciona,
 * que un "a lo mejor" en un mensaje de error manda a buscar donde no es.
 */
export function loQueUnaTeleNoSabe(codecs: string[]): string[] {
  const problemas: string[] = [];
  for (const codec of codecs) {
    if (codec.startsWith('A_DTS')) {
      problemas.push('el audio es DTS, que muchas teles no reproducen (las Samsung desde 2018)');
    } else if (codec.startsWith('A_TRUEHD')) {
      problemas.push('el audio es Dolby TrueHD, que una tele casi nunca reproduce por sí sola');
    } else if (codec.startsWith('V_AV1')) {
      problemas.push('el vídeo es AV1, que solo reproducen las teles más nuevas');
    }
  }
  return [...new Set(problemas)];
}

/** Un códec de Matroska dicho como lo diría una persona. */
export function nombreDeCodec(codec: string): string {
  const conocidos: Array<[RegExp, string]> = [
    [/^V_MPEG4\/ISO\/AVC/, 'H.264'],
    [/^V_MPEGH\/ISO\/HEVC/, 'H.265'],
    [/^V_AV1/, 'AV1'],
    [/^V_VP9/, 'VP9'],
    [/^V_MPEG4/, 'MPEG-4'],
    [/^A_EAC3/, 'E-AC3'],
    [/^A_AC3/, 'AC3'],
    [/^A_DTS/, 'DTS'],
    [/^A_AAC/, 'AAC'],
    [/^A_MPEG\/L3/, 'MP3'],
    [/^A_OPUS/, 'Opus'],
    [/^A_TRUEHD/, 'TrueHD'],
    [/^A_FLAC/, 'FLAC'],
    [/^S_TEXT\/UTF8/, 'subtítulos SRT'],
    [/^S_TEXT\/ASS/, 'subtítulos ASS'],
    [/^S_HDMV\/PGS/, 'subtítulos PGS'],
  ];
  return conocidos.find(([patron]) => patron.test(codec))?.[1] ?? codec;
}
