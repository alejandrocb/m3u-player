/**
 * Parser de M3U extendido (el `type=m3u_plus` de los paneles Xtream).
 *
 * Tolerante a propósito: estas listas traen líneas rotas, atributos sin
 * comillas y directivas de Kodi/VLC por medio. Nada de esto debe abortar el
 * parseo — una lista de 60.000 líneas no se puede tirar por una mala.
 */

import type { RawEntry } from '../models.ts';

export interface M3UDocument {
  /** Atributos del #EXTM3U inicial. `url-tvg`/`x-tvg-url` traen el EPG. */
  header: Record<string, string>;
  entries: RawEntry[];
  /** Líneas que no encajaban en ningún sitio, para diagnosticar. */
  malformed: number;
}

/** Captura pares clave="valor", y también clave=valor sin comillas. */
const ATTR_PATTERN = /([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s,]+))/g;

function parseAttrs(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of source.matchAll(ATTR_PATTERN)) {
    const key = match[1]!.toLowerCase();
    attrs[key] = match[2] ?? match[3] ?? match[4] ?? '';
  }
  return attrs;
}

export function parseM3U(text: string): M3UDocument {
  const doc: M3UDocument = { header: {}, entries: [], malformed: 0 };

  // Se acepta \r\n y \n; algunas listas mezclan ambos.
  const lines = text.split(/\r?\n/);

  let pending: { name: string; attrs: Record<string, string>; line: number } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;

    if (line.startsWith('#EXTM3U')) {
      Object.assign(doc.header, parseAttrs(line.slice('#EXTM3U'.length)));
      continue;
    }

    if (line.startsWith('#EXTINF:')) {
      // Formato: #EXTINF:<duracion> <atributos>,<nombre>
      // El nombre va tras la PRIMERA coma que no esté entre comillas: las comas
      // de los atributos van siempre entrecomilladas, y el nombre puede llevar
      // las suyas propias ('Canal 1, el original').
      const payload = line.slice('#EXTINF:'.length);
      const split = splitOnFirstUnquotedComma(payload);
      if (!split) {
        doc.malformed++;
        continue;
      }
      pending = { name: split.name.trim(), attrs: parseAttrs(split.head), line: i + 1 };
      continue;
    }

    // #EXTGRP asigna grupo cuando el proveedor no usa group-title.
    if (line.startsWith('#EXTGRP:')) {
      if (pending && !pending.attrs['group-title']) {
        pending.attrs['group-title'] = line.slice('#EXTGRP:'.length).trim();
      }
      continue;
    }

    // Directivas de reproductor: se guardan porque algunos streams exigen
    // un User-Agent o un Referer concretos para responder.
    if (line.startsWith('#EXTVLCOPT:') || line.startsWith('#KODIPROP:')) {
      if (pending) {
        const body = line.slice(line.indexOf(':') + 1);
        const eq = body.indexOf('=');
        if (eq > 0) pending.attrs[`opt-${body.slice(0, eq).trim().toLowerCase()}`] = body.slice(eq + 1).trim();
      }
      continue;
    }

    if (line.startsWith('#')) continue;

    if (!pending) {
      // URL suelta sin su #EXTINF: se conserva con nombre vacío en vez de perderla.
      doc.entries.push({ name: '', url: line, attrs: {}, line: i + 1 });
      doc.malformed++;
      continue;
    }

    doc.entries.push({ name: pending.name, url: line, attrs: pending.attrs, line: pending.line });
    pending = null;
  }

  return doc;
}

function splitOnFirstUnquotedComma(payload: string): { head: string; name: string } | null {
  let quote: string | null = null;

  for (let i = 0; i < payload.length; i++) {
    const char = payload[i]!;
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === ',') {
      return { head: payload.slice(0, i), name: payload.slice(i + 1) };
    }
  }

  return null;
}

/** URL del EPG declarada en la cabecera, si la lista la trae. */
export function epgUrlFromHeader(header: Record<string, string>): string | null {
  return header['url-tvg'] || header['x-tvg-url'] || header['tvg-url'] || null;
}
