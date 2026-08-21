/**
 * La programación de un canal, en limpio.
 *
 * Lo que manda el panel viene con dos trampas medidas contra el servidor real:
 *
 * 1. **El título y la descripción van en base64.** Sin descodificar se pinta
 *    "RGlhcmlvIDI0" en vez de "Diario 24".
 * 2. **Los tiempos van en UTC**, incluidas las cadenas `start` y `end` que
 *    tienen toda la pinta de ser hora local. Comprobado: el programa que el
 *    panel da como `08:35` y marca `now_playing` se estaba viendo a las 10:35
 *    de la mañana en España. Se usan los sellos de época, que no engañan, y la
 *    hora se compone con la del aparato.
 *
 * Aquí no se formatea nada: `packages/core` no sabe de husos ni de idiomas, y
 * `Date` ya hace la conversión a la hora local de quien mire la pantalla.
 */

export interface Programa {
  /** Título ya descodificado. Nunca vacío: si falta, queda "Sin título". */
  titulo: string;
  /** Sinopsis, si la trae. */
  descripcion: string | null;
  /** Comienzo y final, en hora absoluta. */
  desde: Date;
  hasta: Date;
}

/** Lo que hace falta de la respuesta del panel; el resto sobra. */
interface ListadoCrudo {
  title?: string;
  description?: string;
  start_timestamp?: string | number;
  stop_timestamp?: string | number;
}

const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Caracteres que no aparecen en un título de programa ni por asomo. */
const CONTROLES = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/;

/**
 * Base64 a bytes, a mano.
 *
 * Ni `atob` ni `Buffer` ni `TextDecoder`: `packages/core` tiene que funcionar
 * igual en Node y en Hermes, y **Hermes no trae `TextDecoder`**. Costó verlo,
 * porque la conversión fallaba en silencio y la parrilla salía escrita en
 * base64 en la tablet mientras los tests pasaban en el portátil.
 */
function bytesDeBase64(valor: string): number[] | null {
  const sinEspacios = valor.replace(/\s/g, '');
  // La longitud múltiplo de cuatro es lo que separa el base64 de una frase que
  // por casualidad solo lleva letras: "Telediario 1" se descodificaría sin
  // protestar y saldría convertido en tres caracteres ilegibles.
  if (sinEspacios.length === 0 || sinEspacios.length % 4 !== 0) return null;

  const limpio = sinEspacios.replace(/=+$/, '');
  if (limpio.length === 0) return [];

  const bytes: number[] = [];
  let acumulado = 0;
  let bits = 0;
  for (const letra of limpio) {
    const indice = ALFABETO.indexOf(letra);
    // Un carácter que no es base64 significa que esto no venía codificado.
    if (indice < 0) return null;
    acumulado = (acumulado << 6) | indice;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((acumulado >> bits) & 0xff);
    }
  }
  return bytes;
}

/**
 * Bytes UTF-8 a texto.
 *
 * Sin esto los acentos salen partidos —"InformaciÃ³n"—, porque cada byte se
 * tomaría por un carácter.
 */
function textoDeUtf8(bytes: number[]): string {
  let texto = '';
  for (let i = 0; i < bytes.length; ) {
    const byte = bytes[i]!;
    let punto: number;
    let largo: number;

    if (byte < 0x80) {
      punto = byte;
      largo = 1;
    } else if (byte >= 0xc0 && byte < 0xe0) {
      punto = byte & 0x1f;
      largo = 2;
    } else if (byte >= 0xe0 && byte < 0xf0) {
      punto = byte & 0x0f;
      largo = 3;
    } else if (byte >= 0xf0) {
      punto = byte & 0x07;
      largo = 4;
    } else {
      // Byte de continuación suelto: se salta en vez de romper la cadena.
      i += 1;
      continue;
    }

    if (i + largo > bytes.length) break;
    for (let extra = 1; extra < largo; extra++) punto = (punto << 6) | (bytes[i + extra]! & 0x3f);
    texto += String.fromCodePoint(punto);
    i += largo;
  }
  return texto;
}

/**
 * El título y la descripción del panel vienen en base64.
 *
 * Si lo que llega no lo está —hay paneles que mandan el texto en claro—, se
 * devuelve tal cual: es preferible enseñarlo a dejar el hueco vacío.
 */
function deBase64(valor: string): string {
  const bytes = bytesDeBase64(valor);
  if (bytes === null) return valor;

  const texto = textoDeUtf8(bytes);
  // Si de descodificar sale texto con caracteres de control, lo que había no
  // era base64 por mucho que lo pareciera: se devuelve el original.
  if (!texto || CONTROLES.test(texto)) return valor;
  return texto;
}

function sello(valor: string | number | undefined): Date | null {
  const segundos = Number(valor);
  if (!Number.isFinite(segundos) || segundos <= 0) return null;
  return new Date(segundos * 1000);
}

/**
 * Convierte el listado del panel en programas, descartando lo que no sirva.
 *
 * Se ordena por hora de comienzo: el panel los manda en orden, pero un EPG
 * remendado a mano puede traerlos mezclados y la lista de "lo próximo" no
 * puede salir a saltos.
 */
export function programasDesde(listados: ListadoCrudo[] | undefined): Programa[] {
  if (!Array.isArray(listados)) return [];

  const programas: Programa[] = [];
  for (const crudo of listados) {
    const desde = sello(crudo.start_timestamp);
    const hasta = sello(crudo.stop_timestamp);
    // Sin horas no se puede colocar en una parrilla ni decir si es el actual.
    if (!desde || !hasta || hasta <= desde) continue;

    const titulo = deBase64(crudo.title ?? '').trim();
    const descripcion = deBase64(crudo.description ?? '').trim();
    programas.push({
      titulo: titulo || 'Sin título',
      descripcion: descripcion || null,
      desde,
      hasta,
    });
  }

  return programas.sort((a, b) => a.desde.getTime() - b.desde.getTime());
}

/**
 * El que se está emitiendo, por hora y no por lo que diga el panel.
 *
 * El campo `now_playing` lo calcula el servidor con su propio reloj, así que
 * se queda viejo en cuanto la pantalla lleva un rato abierta. Comparar con la
 * hora del aparato acierta siempre y no cuesta nada.
 */
export function programaActual(programas: Programa[], ahora: Date): Programa | null {
  return programas.find((programa) => programa.desde <= ahora && ahora < programa.hasta) ?? null;
}

/** Lo que viene después de la hora dada, en orden. */
export function programasSiguientes(programas: Programa[], ahora: Date): Programa[] {
  return programas.filter((programa) => programa.desde > ahora);
}

/**
 * Parte ya emitida del programa, de 0 a 1.
 *
 * Es lo que llena la barra del reproductor en directo: no hay progreso de
 * reproducción que valga —el flujo no empieza ni acaba—, pero sí se puede
 * decir por dónde va el programa.
 */
export function avanceDePrograma(programa: Programa, ahora: Date): number {
  const total = programa.hasta.getTime() - programa.desde.getTime();
  if (total <= 0) return 0;
  const hecho = ahora.getTime() - programa.desde.getTime();
  return Math.max(0, Math.min(1, hecho / total));
}

/**
 * El identificador del canal en el panel, sacado de su URL.
 *
 * `get_short_epg` pide `stream_id`, y la biblioteca no lo guarda: la identidad
 * de un canal es su `tvg-id` o su nombre, precisamente para que sobreviva a
 * una reimportación. Pero la URL de reproducción lo lleva dentro
 * —`/live/usuario/clave/12345.ts`— y de ahí se recupera sin guardar nada más.
 */
export function streamIdDeUrl(url: string): string | null {
  // El último tramo, sin extensión. Vale con y sin ella: algunos paneles
  // sirven el directo como `/live/u/p/12345` a secas.
  const fichero = url.split('?')[0]!.split('/').pop() ?? '';
  const id = fichero.split('.')[0];
  return id && /^\d+$/.test(id) ? id : null;
}
