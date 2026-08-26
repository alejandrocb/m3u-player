/**
 * Lo mínimo para hablar HTTP sin traerse un framework.
 *
 * Son cuatro ayudas: leer el cuerpo, responder, y las cookies. Un Express
 * aquí serían decenas de dependencias para no ahorrar casi nada, y este
 * servidor tiene que poder actualizarse dentro de tres años sin arrastrar la
 * cadena de suministro de nadie.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Tope del cuerpo de una petición.
 *
 * Una tanda de sincronización de una casa entera son unos pocos cientos de
 * kilobytes; ocho megas es holgado de sobra y evita que una petición
 * malintencionada se coma la memoria del contenedor.
 */
const TOPE_CUERPO = 8 * 1024 * 1024;

export function leerCuerpo(req: IncomingMessage): Promise<string> {
  return new Promise((resolver, rechazar) => {
    let total = 0;
    const trozos: Buffer[] = [];

    req.on('data', (trozo: Buffer) => {
      total += trozo.length;
      if (total > TOPE_CUERPO) {
        rechazar(new Error('cuerpo demasiado grande'));
        req.destroy();
        return;
      }
      trozos.push(trozo);
    });
    req.on('end', () => resolver(Buffer.concat(trozos).toString('utf8')));
    req.on('error', rechazar);
  });
}

export async function leerJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const cuerpo = await leerCuerpo(req);
  if (!cuerpo) return {};
  try {
    const dato = JSON.parse(cuerpo) as unknown;
    return dato && typeof dato === 'object' ? (dato as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function leerFormulario(req: IncomingMessage): Promise<URLSearchParams> {
  return new URLSearchParams(await leerCuerpo(req));
}

export function json(res: ServerResponse, codigo: number, cuerpo: unknown): void {
  const texto = JSON.stringify(cuerpo);
  res.writeHead(codigo, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(texto),
    // Nada de esto debe quedarse en ninguna caché intermedia.
    'cache-control': 'no-store',
  });
  res.end(texto);
}

export function html(res: ServerResponse, codigo: number, cuerpo: string): void {
  res.writeHead(codigo, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(cuerpo),
    'cache-control': 'no-store',
    // La web no carga nada de fuera: sin esto, una inyección de HTML podría
    // traerse un script de otro sitio.
    'content-security-policy': "default-src 'self'; style-src 'unsafe-inline'; img-src 'self' data:",
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  });
  res.end(cuerpo);
}

export function redirigir(res: ServerResponse, a: string): void {
  res.writeHead(303, { location: a, 'cache-control': 'no-store' });
  res.end();
}

export function cookies(req: IncomingMessage): Record<string, string> {
  const crudas = req.headers.cookie;
  if (!crudas) return {};

  const salida: Record<string, string> = {};
  for (const trozo of crudas.split(';')) {
    const igual = trozo.indexOf('=');
    if (igual === -1) continue;
    salida[trozo.slice(0, igual).trim()] = decodeURIComponent(trozo.slice(igual + 1).trim());
  }
  return salida;
}

/**
 * La cookie de sesión, con todo lo que hace falta para que no se escape.
 *
 * `HttpOnly` la esconde de JavaScript, `Secure` la ata a HTTPS —Caddy va
 * delante, así que siempre lo es— y `SameSite=Lax` impide que otra web haga
 * peticiones en tu nombre, que es lo que hace innecesario un token CSRF en un
 * panel de este tamaño.
 */
export function cookieDeSesion(valor: string, dias: number): string {
  const caduca = dias > 0 ? `Max-Age=${dias * 24 * 60 * 60}` : 'Max-Age=0';
  return `sesion=${encodeURIComponent(valor)}; Path=/; HttpOnly; Secure; SameSite=Lax; ${caduca}`;
}

/** El token que trae una petición de aparato, si es que trae alguno. */
export function tokenDe(req: IncomingMessage): string | null {
  const cabecera = req.headers.authorization;
  if (!cabecera || !cabecera.startsWith('Bearer ')) return null;
  const token = cabecera.slice(7).trim();
  return token || null;
}

/** Escapa texto para meterlo en el HTML sin abrir un agujero. */
export function escapar(valor: unknown): string {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
