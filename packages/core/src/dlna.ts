/**
 * "Ver en la tele": mandarle a un televisor la dirección de un vídeo.
 *
 * No se manda la imagen, se manda **la URL**, y el televisor se la pide al
 * panel por su cuenta y en calidad original. El teléfono se queda de mando a
 * distancia y se puede bloquear. Es lo que hacen Netflix y YouTube, y lo que
 * permite usar una tele que no tiene Android —una Samsung con Tizen, por
 * ejemplo— sin escribir una aplicación para ella.
 *
 * Se hace con **DLNA**, que es lo que traen casi todos los televisores
 * conectados desde hace una década: un servidor HTTP en la tele que acepta
 * órdenes SOAP. Son cuatro: "pon esto", "dale", "pausa" y "salta a". Y dos
 * preguntas: "¿qué estás haciendo?" y "¿por dónde vas?".
 *
 * Aquí no hay nada de ninguna plataforma: el `fetch` se pasa desde fuera, igual
 * que en `XtreamClient`. Encontrar la tele en la red sí lo es —es UDP
 * multicast— y lo hace cada plataforma; esto empieza cuando ya se sabe dónde
 * está su ficha.
 */

type Fetch = typeof globalThis.fetch;

/** Un televisor que sabe reproducir lo que se le mande. */
export interface Tele {
  /** Como se llama en la red: "[TV] Samsung 5 Series (32)". */
  nombre: string;
  modelo: string | null;
  /** Dónde está su ficha. Es lo que la identifica entre búsquedas. */
  ficha: string;
  /** A dónde se mandan las órdenes de reproducción. */
  control: string;
}

/** En qué está la tele. Son los estados de DLNA, sin traducir. */
export type EstadoTele = 'PLAYING' | 'PAUSED_PLAYBACK' | 'STOPPED' | 'TRANSITIONING' | 'NO_MEDIA_PRESENT' | string;

export interface Situacion {
  estado: EstadoTele;
  /** Segundos. `null` si la tele no lo dice, que pasa al arrancar. */
  posicion: number | null;
  duracion: number | null;
}

/** Un fallo de la tele, con el código de DLNA para poder explicarlo. */
export class ErrorDeTele extends Error {
  readonly codigo: number | null;

  constructor(mensaje: string, codigo: number | null) {
    super(mensaje);
    this.name = 'ErrorDeTele';
    this.codigo = codigo;
  }
}

const AV_TRANSPORT = 'urn:schemas-upnp-org:service:AVTransport:1';

/**
 * Los códigos que de verdad salen, en palabras.
 *
 * El que importa es el 716: la tele fue a buscar el vídeo y no pudo abrirlo.
 * Casi nunca es cosa de la tele —el panel le dijo que no, o el operador
 * bloquea ese servidor—, y por eso el mensaje lo dice así.
 */
const EXPLICACIONES: Record<number, string> = {
  701: 'la tele no admite esa orden ahora mismo',
  714: 'la tele no reconoce el formato de este vídeo',
  716: 'la tele no pudo abrir el vídeo: el servidor no se lo dio',
  718: 'la tele no reconoce ese vídeo',
};

/** Lo que va dentro de un XML, escapado. */
function escapar(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** El contenido de la primera etiqueta con ese nombre, con o sin prefijo. */
function etiqueta(xml: string, nombre: string): string | null {
  const encontrada = new RegExp(`<(?:\\w+:)?${nombre}(?:\\s[^>]*)?>([^<]*)</(?:\\w+:)?${nombre}>`).exec(xml);
  return encontrada ? desescapar(encontrada[1]!.trim()) : null;
}

function desescapar(texto: string): string {
  return texto
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * Una dirección relativa, completada con la de la ficha.
 *
 * A mano y no con `URL`: esto corre también en React Native, cuyo `URL` es
 * un remiendo, y aquí solo hace falta pegar un camino a un servidor.
 */
function completar(base: string, camino: string): string {
  if (/^https?:\/\//i.test(camino)) return camino;
  const origen = /^(https?:\/\/[^/]+)/i.exec(base)?.[1] ?? '';
  if (camino.startsWith('/')) return `${origen}${camino}`;
  const carpeta = base.slice(0, base.lastIndexOf('/') + 1);
  return `${carpeta}${camino}`;
}

/**
 * Lee la ficha de un aparato y dice si es una tele a la que mandar vídeo.
 *
 * Devuelve `null` si no lo es: en una casa contestan también el router, los
 * altavoces y la impresora, y lo único que interesa es quien tenga
 * `AVTransport`, que es el servicio de "reproduce esto".
 */
export async function leerTele(ficha: string, pedir: Fetch): Promise<Tele | null> {
  const respuesta = await pedir(ficha);
  if (!respuesta.ok) return null;
  const xml = await respuesta.text();

  const servicios = xml.split(/<(?:\w+:)?service>/).slice(1);
  const transporte = servicios.find((uno) => uno.includes(AV_TRANSPORT));
  const control = transporte ? etiqueta(transporte, 'controlURL') : null;
  if (!control) return null;

  return {
    nombre: etiqueta(xml, 'friendlyName') ?? 'Televisor',
    modelo: etiqueta(xml, 'modelName'),
    ficha,
    control: completar(ficha, control),
  };
}

/**
 * Qué tipo de vídeo es, por la extensión de la URL.
 *
 * Hay teles —las Samsung, sin ir más lejos— que rechazan la orden si no se les
 * dice qué les llega. La extensión miente a veces, pero es lo único que hay
 * antes de abrir el fichero, y las teles se fijan poco: lo que quieren es
 * saber que es vídeo y de qué familia.
 */
export function tipoDeVideo(url: string): string {
  const sinConsulta = url.split('?')[0] ?? url;
  const extension = sinConsulta.slice(sinConsulta.lastIndexOf('.') + 1).toLowerCase();
  switch (extension) {
    case 'mkv':
      return 'video/x-mkv';
    case 'mp4':
    case 'm4v':
      return 'video/mp4';
    case 'avi':
      return 'video/x-msvideo';
    case 'ts':
      return 'video/vnd.dlna.mpeg-tts';
    case 'm3u8':
      return 'application/vnd.apple.mpegurl';
    default:
      return 'video/mp4';
  }
}

/** `H:MM:SS`, que es como DLNA quiere las posiciones. */
export function aReloj(segundos: number): string {
  const total = Math.max(0, Math.floor(segundos));
  const horas = Math.floor(total / 3600);
  const minutos = Math.floor((total % 3600) / 60);
  const resto = total % 60;
  return `${horas}:${String(minutos).padStart(2, '0')}:${String(resto).padStart(2, '0')}`;
}

/**
 * Y al revés. `null` si la tele no lo sabe: al arrancar contesta
 * `NOT_IMPLEMENTED` o `0:00:00` de duración, y un cero ahí no es un cero.
 */
export function deReloj(texto: string | null): number | null {
  if (!texto) return null;
  const partes = /^(\d+):(\d{1,2}):(\d{1,2})(?:\.\d+)?$/.exec(texto.trim());
  if (!partes) return null;
  return Number(partes[1]) * 3600 + Number(partes[2]) * 60 + Number(partes[3]);
}

/**
 * El mando de una tele concreta.
 *
 * Cada método es una orden SOAP. Todo lo que devuelve la tele como fallo sale
 * como `ErrorDeTele`, con el código y dicho de forma que se pueda enseñar.
 */
export class MandoDeTele {
  readonly tele: Tele;
  readonly #pedir: Fetch;

  constructor(tele: Tele, pedir: Fetch) {
    this.tele = tele;
    this.#pedir = pedir;
  }

  /** Le dice qué vídeo poner. No arranca: para eso está `reproducir`. */
  async poner(url: string, titulo: string): Promise<void> {
    /*
      La ficha del vídeo va **escapada dos veces**, y no es un descuido: es un
      XML (DIDL-Lite) que viaja como texto dentro de otro XML (el sobre SOAP).
      La URL va escapada dentro de la ficha, y la ficha entera dentro del
      sobre. Con una sola vez, el `&` de una URL con parámetros rompe la orden.
    */
    const ficha =
      '<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" ' +
      'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/">' +
      `<item id="0" parentID="-1" restricted="1"><dc:title>${escapar(titulo)}</dc:title>` +
      '<upnp:class>object.item.videoItem</upnp:class>' +
      `<res protocolInfo="http-get:*:${tipoDeVideo(url)}:*">${escapar(url)}</res></item></DIDL-Lite>`;

    await this.#orden(
      'SetAVTransportURI',
      `<CurrentURI>${escapar(url)}</CurrentURI><CurrentURIMetaData>${escapar(ficha)}</CurrentURIMetaData>`,
    );
  }

  async reproducir(): Promise<void> {
    await this.#orden('Play', '<Speed>1</Speed>');
  }

  async pausar(): Promise<void> {
    await this.#orden('Pause', '');
  }

  async parar(): Promise<void> {
    await this.#orden('Stop', '');
  }

  async saltarA(segundos: number): Promise<void> {
    await this.#orden('Seek', `<Unit>REL_TIME</Unit><Target>${aReloj(segundos)}</Target>`);
  }

  /** En qué está y por dónde va, en una sola llamada para quien pregunta. */
  async situacion(): Promise<Situacion> {
    const transporte = await this.#orden('GetTransportInfo', '');
    const posicion = await this.#orden('GetPositionInfo', '');
    const duracion = deReloj(etiqueta(posicion, 'TrackDuration'));
    return {
      estado: etiqueta(transporte, 'CurrentTransportState') ?? 'STOPPED',
      posicion: deReloj(etiqueta(posicion, 'RelTime')),
      // Una duración de cero es que aún no la sabe, no que dure cero.
      duracion: duracion && duracion > 0 ? duracion : null,
    };
  }

  async #orden(accion: string, argumentos: string): Promise<string> {
    const sobre =
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" ' +
      's:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body>' +
      `<u:${accion} xmlns:u="${AV_TRANSPORT}"><InstanceID>0</InstanceID>${argumentos}</u:${accion}>` +
      '</s:Body></s:Envelope>';

    const respuesta = await this.#pedir(this.tele.control, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset="utf-8"',
        SOAPACTION: `"${AV_TRANSPORT}#${accion}"`,
      },
      body: sobre,
    });
    const texto = await respuesta.text();

    if (!respuesta.ok) {
      const codigo = Number(etiqueta(texto, 'errorCode')) || null;
      const dicho = codigo ? EXPLICACIONES[codigo] : undefined;
      throw new ErrorDeTele(
        dicho ?? `la tele no aceptó "${accion}" (${codigo ?? respuesta.status}${etiqueta(texto, 'errorDescription') ? `: ${etiqueta(texto, 'errorDescription')}` : ''})`,
        codigo,
      );
    }
    return texto;
  }
}
