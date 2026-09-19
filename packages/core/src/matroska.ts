/**
 * Las pistas de un MKV, leídas de su cabecera.
 *
 * Hace falta para "Ver en la tele": **DLNA no tiene ninguna orden para elegir
 * audio o subtítulos**. La tele coge la pista que el fichero marca por
 * defecto, y si ese fichero trae los subtítulos en español marcados, se ven y
 * no hay forma de quitarlos desde el teléfono.
 *
 * La salida es cambiar el fichero **mientras pasa por el puente**, y para eso
 * hay que saber dónde está cada pista. Un MKV es EBML: elementos anidados, y
 * cada uno es identificador, longitud y contenido. La lista de pistas va al
 * principio, así que con los primeros kilobytes basta.
 *
 * Aquí solo se lee. Taparlas es cosa de quien sirve los bytes, y por eso de
 * cada pista sale **dónde empieza y dónde acaba**.
 */

/** Una pista del fichero: de qué es, en qué idioma y dónde vive. */
export interface PistaMkv {
  /** El número con el que la llaman los bloques de vídeo. */
  numero: number;
  clase: 'video' | 'audio' | 'subtitulo' | 'otra';
  /** `A_AC3`, `S_TEXT/UTF8`… tal como viene. */
  codec: string;
  /** Tres letras, como en el fichero: `spa`, `eng`, `und` si no lo dice. */
  idioma: string;
  /** El nombre que le puso quien lo codificó, si lo lleva. */
  nombre: string | null;
  /** Si el fichero la marca como la que hay que usar. */
  porDefecto: boolean;
  /** Si está encendida. Una apagada no la usa nadie, ni aunque esté marcada. */
  encendida: boolean;
  /** Dónde empieza su ficha dentro del fichero, contando desde el byte 0. */
  desde: number;
  /** Y dónde acaba, sin incluir este byte. */
  hasta: number;
  /**
   * Dónde está el byte que dice "esta es la buena", si el fichero lo trae.
   *
   * Cambiar ese byte es un solo cambio, y es como se elige una pista sin
   * tocar nada más. Cuando no está, la pista cuenta como marcada y para
   * quitarle la marca hay que reescribir su ficha entera.
   */
  marca: number | null;
  /** Su identificador único, tal cual está escrito: hay que conservarlo. */
  uid: number[] | null;
}

/* Los identificadores de EBML que hacen falta, tal cual salen en el fichero. */
const SEGMENTO = 0x18538067;
const PISTAS = 0x1654ae6b;
const UNA_PISTA = 0xae;
const NUMERO = 0xd7;
const TIPO = 0x83;
const CODEC = 0x86;
const IDIOMA = 0x22b59c;
const IDIOMA_BCP47 = 0x22b59d;
const NOMBRE = 0x536e;
const POR_DEFECTO = 0x88;
const ENCENDIDA = 0xb9;
const UID = 0x73c5;
const HUECO = 0xec;

/** Lo que lleva un elemento: dónde empieza su contenido y cuánto ocupa. */
interface Elemento {
  id: number;
  /** Desde el primer byte del identificador. */
  desde: number;
  /** Donde empieza el contenido. */
  contenido: number;
  /** Cuánto ocupa el contenido, o `null` si el fichero no lo dice. */
  largo: number | null;
}

/**
 * Lee un número de longitud variable (VINT).
 *
 * El primer bit a uno dice cuántos bytes ocupa: `1xxxxxxx` es uno,
 * `01xxxxxx` dos, y así. Con `conMarca` se queda el bit puesto —los
 * identificadores se escriben enteros— y sin ella se quita, que es como se
 * leen las longitudes.
 */
function leerVint(bytes: Uint8Array, puesto: number, conMarca: boolean): { valor: number; largo: number } | null {
  if (puesto >= bytes.length) return null;
  const primero = bytes[puesto]!;
  if (primero === 0) return null;

  let largo = 1;
  while (largo <= 8 && (primero & (0x80 >> (largo - 1))) === 0) largo += 1;
  if (largo > 8 || puesto + largo > bytes.length) return null;

  let valor = conMarca ? primero : primero & (0xff >> largo);
  let todoUnos = (primero & (0xff >> largo)) === 0xff >> largo;
  for (let i = 1; i < largo; i += 1) {
    const byte = bytes[puesto + i]!;
    if (byte !== 0xff) todoUnos = false;
    valor = valor * 256 + byte;
  }
  // Una longitud con todos los bits a uno quiere decir "no se sabe": lo usan
  // los ficheros que se están grabando, y el Segmento de muchos MKV.
  return { valor: !conMarca && todoUnos ? -1 : valor, largo };
}

function leerElemento(bytes: Uint8Array, puesto: number): Elemento | null {
  const id = leerVint(bytes, puesto, true);
  if (!id) return null;
  const largo = leerVint(bytes, puesto + id.largo, false);
  if (!largo) return null;
  return {
    id: id.valor,
    desde: puesto,
    contenido: puesto + id.largo + largo.largo,
    largo: largo.valor < 0 ? null : largo.valor,
  };
}

/** Un número sin signo escrito en tantos bytes como haga falta. */
function comoNumero(bytes: Uint8Array, desde: number, largo: number): number {
  let valor = 0;
  for (let i = 0; i < largo && desde + i < bytes.length; i += 1) valor = valor * 256 + bytes[desde + i]!;
  return valor;
}

/** Una cadena ASCII, sin los ceros de relleno del final. */
function comoTexto(bytes: Uint8Array, desde: number, largo: number): string {
  let texto = '';
  for (let i = 0; i < largo && desde + i < bytes.length; i += 1) {
    const byte = bytes[desde + i]!;
    if (byte === 0) break;
    texto += String.fromCharCode(byte);
  }
  return texto;
}

function claseDePista(tipo: number): PistaMkv['clase'] {
  if (tipo === 1) return 'video';
  if (tipo === 2) return 'audio';
  if (tipo === 17) return 'subtitulo';
  return 'otra';
}

/**
 * Las pistas que haya en lo que se le pase, que normalmente son los primeros
 * kilobytes del fichero. Si la cabecera no ha llegado entera, devuelve lo que
 * pudo leer: media lista es mejor que ninguna.
 */
export function pistasDeMatroska(bytes: Uint8Array): PistaMkv[] {
  // Primero, encontrar el Segmento y dentro de él la lista de pistas.
  let puesto = 0;
  let finDelSegmento = bytes.length;

  while (puesto < bytes.length) {
    const elemento = leerElemento(bytes, puesto);
    if (!elemento) break;
    if (elemento.id === SEGMENTO) {
      // Se entra dentro: sus hijos empiezan donde empieza su contenido.
      puesto = elemento.contenido;
      finDelSegmento = elemento.largo === null ? bytes.length : elemento.contenido + elemento.largo;
      continue;
    }
    if (elemento.id === PISTAS) {
      return dentroDeLasPistas(bytes, elemento);
    }
    if (elemento.largo === null) break;
    puesto = elemento.contenido + elemento.largo;
    if (puesto > finDelSegmento) break;
  }
  return [];
}

function dentroDeLasPistas(bytes: Uint8Array, pistas: Elemento): PistaMkv[] {
  const fin = pistas.largo === null ? bytes.length : Math.min(bytes.length, pistas.contenido + pistas.largo);
  const encontradas: PistaMkv[] = [];

  let puesto = pistas.contenido;
  while (puesto < fin) {
    const entrada = leerElemento(bytes, puesto);
    if (!entrada || entrada.largo === null) break;
    const finDeLaEntrada = entrada.contenido + entrada.largo;
    if (entrada.id !== UNA_PISTA) {
      puesto = finDeLaEntrada;
      continue;
    }
    // Si la cabecera se cortó a la mitad, esta pista no se cuenta: taparla
    // sin saber dónde acaba sería romper el fichero.
    if (finDeLaEntrada > bytes.length) break;

    encontradas.push(leerUnaPista(bytes, entrada, finDeLaEntrada));
    puesto = finDeLaEntrada;
  }
  return encontradas;
}

function leerUnaPista(bytes: Uint8Array, entrada: Elemento, fin: number): PistaMkv {
  const pista: PistaMkv = {
    numero: 0,
    clase: 'otra',
    codec: '',
    // Lo que dice Matroska cuando no se dice nada: inglés.
    idioma: 'eng',
    nombre: null,
    // Y que sí, que es la buena: por eso una pista sin marca cuenta como
    // marcada, y por eso unos subtítulos salen sin que nadie los pida.
    porDefecto: true,
    encendida: true,
    desde: entrada.desde,
    hasta: fin,
    marca: null,
    uid: null,
  };

  let puesto = entrada.contenido;
  while (puesto < fin) {
    const campo = leerElemento(bytes, puesto);
    if (!campo || campo.largo === null) break;
    switch (campo.id) {
      case NUMERO:
        pista.numero = comoNumero(bytes, campo.contenido, campo.largo);
        break;
      case TIPO:
        pista.clase = claseDePista(comoNumero(bytes, campo.contenido, campo.largo));
        break;
      case CODEC:
        pista.codec = comoTexto(bytes, campo.contenido, campo.largo);
        break;
      case IDIOMA:
      case IDIOMA_BCP47:
        pista.idioma = comoTexto(bytes, campo.contenido, campo.largo).slice(0, 3).toLowerCase();
        break;
      case NOMBRE:
        pista.nombre = comoTexto(bytes, campo.contenido, campo.largo) || null;
        break;
      case POR_DEFECTO:
        pista.porDefecto = comoNumero(bytes, campo.contenido, campo.largo) !== 0;
        // El último byte del valor: es el que se cambia para elegirla.
        pista.marca = campo.contenido + campo.largo - 1;
        break;
      case UID:
        pista.uid = [...bytes.subarray(campo.desde, campo.contenido + campo.largo)];
        break;
      case ENCENDIDA:
        pista.encendida = comoNumero(bytes, campo.contenido, campo.largo) !== 0;
        break;
      default:
        break;
    }
    puesto = campo.contenido + campo.largo;
  }
  return pista;
}

/** El idioma de una pista dicho en cristiano, para poder elegirla. */
export function nombreDeIdioma(idioma: string): string {
  const conocidos: Record<string, string> = {
    spa: 'Español',
    esp: 'Español',
    es: 'Español',
    lat: 'Español latino',
    eng: 'Inglés',
    en: 'Inglés',
    fra: 'Francés',
    fre: 'Francés',
    ger: 'Alemán',
    deu: 'Alemán',
    ita: 'Italiano',
    por: 'Portugués',
    cat: 'Catalán',
    eus: 'Euskera',
    glg: 'Gallego',
    jpn: 'Japonés',
    kor: 'Coreano',
    rus: 'Ruso',
    chi: 'Chino',
    zho: 'Chino',
    und: 'Sin idioma',
  };
  return conocidos[idioma] ?? idioma.toUpperCase();
}

/** Un trozo del fichero cambiado por otro **del mismo tamaño**. */
export interface Parche {
  desde: number;
  bytes: number[];
}

/** Un elemento EBML con su longitud escrita en un solo byte (hasta 127). */
function elementoCorto(id: number[], contenido: number[]): number[] {
  return [...id, 0x80 | contenido.length, ...contenido];
}

/** Una longitud de EBML escrita en tantos bytes como se le diga. */
function longitud(valor: number, bytes: number): number[] {
  const escrita: number[] = [];
  for (let byte = bytes - 1; byte >= 0; byte -= 1) escrita.push(Math.floor(valor / 256 ** byte) % 256);
  // El bit que dice cuántos bytes ocupa va en el primero.
  escrita[0] = escrita[0]! | (0x80 >> (bytes - 1));
  return escrita;
}

/** Si una longitud cabe escrita en tantos bytes. */
function cabe(valor: number, bytes: number): boolean {
  return valor >= 0 && valor < 2 ** (7 * bytes) - 1;
}

/** Un hueco de EBML que ocupe exactamente lo que se le pida, o nada. */
function hueco(total: number): number[] | null {
  if (total === 0) return [];
  // Uno de un solo byte no existe: hace falta el identificador y la longitud.
  if (total === 1) return null;
  for (let bytes = 1; bytes <= 8; bytes += 1) {
    const dentro = total - 1 - bytes;
    if (dentro >= 0 && cabe(dentro, bytes)) {
      return [HUECO, ...longitud(dentro, bytes), ...new Array<number>(dentro).fill(0)];
    }
  }
  return null;
}

/**
 * Cómo dejar una pista escrita pero **apagada**.
 *
 * La primera versión de esto tapaba la pista entera con un hueco, y la tele
 * daba un tirón cada pocos segundos: los bloques de esa pista **siguen dentro
 * del vídeo**, repartidos por todo el fichero, y se quedaban apuntando a una
 * pista que ya no existía. Un reproductor debería ignorarlos sin más; el de
 * la Samsung tropezaba.
 *
 * Así que la pista se queda —con su número, su identificador, su clase y su
 * códec, que es lo que hace falta para saber de quién son esos bloques— y se
 * le pone `FlagEnabled = 0`. Lo que sobra se rellena con un hueco, de modo que
 * **ocupa exactamente lo mismo que ocupaba**.
 *
 * Puede no caber: una ficha pequeña no tiene sitio para lo que hay que
 * escribir. Entonces se devuelve `null` y quien llama se conforma con quitarle
 * la marca, que es menos, pero no rompe nada.
 */
function fichaApagada(pista: PistaMkv): Parche | null {
  const total = pista.hasta - pista.desde;
  const tipo = pista.clase === 'audio' ? 2 : pista.clase === 'subtitulo' ? 17 : 3;

  const conMarca = [
    ...elementoCorto([NUMERO], [pista.numero]),
    ...(pista.uid ?? []),
    ...elementoCorto([TIPO], [tipo]),
    ...elementoCorto([CODEC], [...pista.codec].map((letra) => letra.charCodeAt(0))),
    ...elementoCorto([ENCENDIDA], [0]),
    ...elementoCorto([POR_DEFECTO], [0]),
  ];
  // Si no cabe con la marca, sin ella: lo que de verdad la quita de en medio
  // es estar apagada.
  const sinMarca = conMarca.slice(0, conMarca.length - 3);

  for (let bytesDeLargo = 1; bytesDeLargo <= 8; bytesDeLargo += 1) {
    const contenido = total - 1 - bytesDeLargo;
    if (!cabe(contenido, bytesDeLargo)) continue;

    for (const dentro of [conMarca, sinMarca]) {
      const relleno = hueco(contenido - dentro.length);
      if (contenido < dentro.length || relleno === null) continue;
      return {
        desde: pista.desde,
        bytes: [UNA_PISTA, ...longitud(contenido, bytesDeLargo), ...dentro, ...relleno],
      };
    }
  }
  return null;
}

/**
 * Qué hay que cambiar del fichero para que la tele use las pistas que uno
 * quiere.
 *
 * DLNA no sabe pedir una pista: la tele usa la que el fichero marca, y en
 * Matroska **una pista sin marca cuenta como marcada**, que es justo por lo
 * que salen unos subtítulos que nadie ha pedido.
 *
 * Así que se cambia el fichero al vuelo, y siempre **del mismo tamaño
 * exacto**: si se acortara, todas las posiciones de dentro dejarían de valer
 * y la tele no podría saltar. La elegida solo necesita su marca; las demás se
 * quedan escritas pero apagadas (ver `fichaApagada`).
 *
 * El vídeo no se toca nunca. `subtitulo: null` quiere decir sin subtítulos,
 * que es lo que uno espera al poner una película en su idioma.
 */
export function parchesParaDejarSolo(
  pistas: PistaMkv[],
  eleccion: { audio: number | null; subtitulo: number | null },
): Parche[] {
  const parches: Parche[] = [];

  for (const pista of pistas) {
    if (pista.clase !== 'audio' && pista.clase !== 'subtitulo') continue;

    // Sin audio elegido no se toca ninguno: apagarlos todos sería quedarse
    // sin sonido, que es peor que cualquier idioma.
    if (pista.clase === 'audio' && eleccion.audio === null) continue;

    const elegida = pista.clase === 'audio' ? eleccion.audio === pista.numero : eleccion.subtitulo === pista.numero;
    if (elegida) {
      // La elegida solo necesita la marca, y solo si la trae escrita: sin
      // ella ya cuenta como marcada.
      if (pista.marca !== null && !pista.porDefecto) parches.push({ desde: pista.marca, bytes: [1] });
      continue;
    }

    /*
      Y las demás, apagadas. Quitarles la marca no basta: una pista sin marca
      puede salir igual si la tele decide que es la única en ese idioma.
    */
    const apagada = fichaApagada(pista);
    if (apagada) parches.push(apagada);
    else if (pista.marca !== null) parches.push({ desde: pista.marca, bytes: [0] });
  }

  return parches;
}

/** El audio que hay que poner si nadie ha elegido: el del fichero. */
export function audioPorDefecto(pistas: PistaMkv[]): number | null {
  const audios = pistas.filter((pista) => pista.clase === 'audio');
  return (audios.find((pista) => pista.porDefecto) ?? audios[0])?.numero ?? null;
}
