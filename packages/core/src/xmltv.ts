/**
 * El EPG completo del panel, en XMLTV.
 *
 * Es la otra forma de traerse la programación, y la que sale a cuenta cuando
 * quien la pide es el servidor de la casa: medido contra la lista real,
 * `xmltv.php` son 5,5 MB con 191 canales y 11.515 programas —dos o tres días
 * de parrilla— en una sola petición. Pedirlo canal a canal con
 * `get_short_epg` cuesta 3,4 KB por canal, pero una petición por canal y con
 * el foco moviéndose.
 *
 * La comprobación que había que hacer antes de fiarse: **los `channel id` del
 * XMLTV son nuestros `tvg-id`**, 191 de 191 en la lista real. Por eso lo que
 * sale de aquí se puede casar con la biblioteca sin ninguna tabla de
 * equivalencias por nombre.
 *
 * No se monta un árbol XML: se recorre el texto con expresiones regulares
 * porque solo hacen falta cuatro campos de una etiqueta que el propio panel
 * genera siempre igual, y un analizador completo para 5,5 MB es traer una
 * dependencia y quedarse sin memoria en el aparato. Lo que no encaje se
 * descarta en silencio, que es lo mismo que hace `programasDesde`.
 *
 * Ojo con la diferencia con `epg.ts`: **aquí no hay base64**. En XMLTV los
 * títulos van en claro y lo que hay que deshacer son las entidades de XML.
 */

import type { Programa } from './epg.ts';

/** Un programa con el canal al que pertenece. */
export interface ProgramaDeCanal extends Programa {
  /** El `channel id` del XMLTV, que es el `tvg-id` de nuestro canal. */
  canal: string;
}

/** `20260829201500 +0200` -> fecha absoluta. */
export function fechaXmltv(valor: string): Date | null {
  const limpio = valor.trim();
  const partes = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-]\d{4})?$/.exec(limpio);
  if (!partes) return null;

  const [, anio, mes, dia, hora, minuto, segundo, huso] = partes;
  /*
    Sin huso se toma UTC. Es lo mismo que hace `get_short_epg`, donde las
    horas venían en UTC aunque parecieran locales: dar por hecho que es la
    hora del aparato desplazaría la parrilla entera las horas que separen a
    quien mira del servidor.
  */
  let minutos = 0;
  if (huso) {
    const signo = huso.startsWith('-') ? -1 : 1;
    minutos = signo * (Number(huso.slice(1, 3)) * 60 + Number(huso.slice(3, 5)));
  }

  const enUtc = Date.UTC(
    Number(anio),
    Number(mes) - 1,
    Number(dia),
    Number(hora),
    Number(minuto),
    Number(segundo ?? '0'),
  );
  if (!Number.isFinite(enUtc)) return null;
  return new Date(enUtc - minutos * 60_000);
}

/** Las cinco entidades de XML, más las numéricas. */
export function sinEntidades(texto: string): string {
  return texto
    .replace(/&#x([0-9a-fA-F]+);/g, (_, codigo: string) => String.fromCodePoint(Number.parseInt(codigo, 16)))
    .replace(/&#(\d+);/g, (_, codigo: string) => String.fromCodePoint(Number(codigo)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    // El `&amp;` va el último: si no, `&amp;lt;` acabaría convertido en `<`.
    .replace(/&amp;/g, '&');
}

/** El contenido de la primera etiqueta con ese nombre, ya limpio. */
function contenido(trozo: string, etiqueta: string): string | null {
  const buscador = new RegExp(`<${etiqueta}\\b[^>]*>([\\s\\S]*?)</${etiqueta}>`, 'i');
  const encontrado = buscador.exec(trozo);
  if (!encontrado) return null;
  const texto = sinEntidades(encontrado[1]!).replace(/\s+/g, ' ').trim();
  return texto || null;
}

const DE_PROGRAMA = /<programme\b([^>]*)>([\s\S]*?)<\/programme>/gi;
const DE_ATRIBUTO = (nombre: string): RegExp => new RegExp(`${nombre}="([^"]*)"`, 'i');

/**
 * Los programas de un XMLTV, ordenados por canal y hora.
 *
 * Lo que no traiga canal, o traiga horas imposibles, se cae: en una parrilla
 * no se puede colocar y no hay forma de decir si es el que están echando.
 */
export function programasDeXmltv(xml: string): ProgramaDeCanal[] {
  const programas: ProgramaDeCanal[] = [];

  for (const encontrado of xml.matchAll(DE_PROGRAMA)) {
    const atributos = encontrado[1]!;
    const cuerpo = encontrado[2]!;

    const canal = DE_ATRIBUTO('channel').exec(atributos)?.[1];
    const inicio = DE_ATRIBUTO('start').exec(atributos)?.[1];
    const fin = DE_ATRIBUTO('stop').exec(atributos)?.[1];
    if (!canal || !inicio || !fin) continue;

    const desde = fechaXmltv(inicio);
    const hasta = fechaXmltv(fin);
    if (!desde || !hasta || hasta <= desde) continue;

    programas.push({
      canal: sinEntidades(canal).trim(),
      titulo: contenido(cuerpo, 'title') ?? 'Sin título',
      descripcion: contenido(cuerpo, 'desc'),
      desde,
      hasta,
    });
  }

  return programas.sort(
    (a, b) => a.canal.localeCompare(b.canal) || a.desde.getTime() - b.desde.getTime(),
  );
}

/**
 * Los identificadores de canal que declara el XMLTV.
 *
 * Sirve para saber de cuántos canales hay programación sin recorrer los
 * programas, que son sesenta veces más.
 */
export function canalesDeXmltv(xml: string): string[] {
  const canales = new Set<string>();
  for (const encontrado of xml.matchAll(/<channel\s+id="([^"]*)"/gi)) {
    canales.add(sinEntidades(encontrado[1]!).trim());
  }
  return [...canales];
}
