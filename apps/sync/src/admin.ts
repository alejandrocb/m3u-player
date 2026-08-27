/**
 * La web de administración: quién entra y qué puede hacer.
 *
 * Todo lo que cambia algo va por POST y con la cookie de sesión, que es
 * `SameSite=Lax`: otra web no puede hacer que tu navegador mande estos
 * formularios en tu nombre.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

import { hostDe } from '@m3u/ui';

import { cookieDeSesion, cookies, html, leerFormulario, redirigir } from './http.ts';
import { paginaEntrar, paginaLista, paginaPanel, paginaPrimerUso } from './paginas.ts';
import type { Panel } from './panel.ts';

const DIAS_SESION = 30;

/** El servidor de la URL, que es lo único que se puede enseñar sin descuidos. */
function anfitrion(url: string): string {
  try {
    return hostDe(url);
  } catch {
    return 'dirección no reconocida';
  }
}

function panelCompleto(panel: Panel): string {
  return paginaPanel({
    pendientes: panel.pendientes(),
    grupos: panel.grupos(),
    aparatosDe: (grupoId) => panel.aparatosDe(grupoId),
    listasDe: (grupoId) => panel.listasDe(grupoId),
    anfitrion,
  });
}

export async function manejarAdmin(
  panel: Panel,
  req: IncomingMessage,
  res: ServerResponse,
  ruta: string,
  codigoInicial: () => string | null,
): Promise<boolean> {
  const galleta = cookies(req).sesion ?? '';
  const usuario = galleta ? panel.sesion(galleta) : null;

  // --- Primer uso: no hay ninguna cuenta todavía --------------------------
  if (!panel.hayAdmin()) {
    if (ruta === '/inicial' && req.method === 'POST') {
      const datos = await leerFormulario(req);
      const esperado = codigoInicial();
      const dado = (datos.get('codigo') ?? '').trim().toUpperCase();

      if (!esperado || dado !== esperado) {
        html(res, 403, paginaPrimerUso('El código de instalación no es correcto.'));
        return true;
      }
      const nombre = (datos.get('usuario') ?? '').trim();
      const contrasena = datos.get('contrasena') ?? '';
      if (!nombre || contrasena.length < 8) {
        html(res, 400, paginaPrimerUso('Hace falta un usuario y una contraseña de al menos ocho caracteres.'));
        return true;
      }

      panel.crearAdmin(nombre, contrasena);
      const cookie = panel.entrar(nombre, contrasena);
      if (cookie) res.setHeader('set-cookie', cookieDeSesion(cookie, DIAS_SESION));
      redirigir(res, '/');
      return true;
    }

    html(res, 200, paginaPrimerUso());
    return true;
  }

  // --- Entrar y salir ------------------------------------------------------
  if (ruta === '/entrar' && req.method === 'POST') {
    const datos = await leerFormulario(req);
    const cookie = panel.entrar(datos.get('usuario') ?? '', datos.get('contrasena') ?? '');
    if (!cookie) {
      // Sin decir si falló el usuario o la contraseña.
      html(res, 401, paginaEntrar('Usuario o contraseña incorrectos.'));
      return true;
    }
    res.setHeader('set-cookie', cookieDeSesion(cookie, DIAS_SESION));
    redirigir(res, '/');
    return true;
  }

  if (ruta === '/salir' && req.method === 'POST') {
    if (galleta) panel.salir(galleta);
    res.setHeader('set-cookie', cookieDeSesion('', 0));
    redirigir(res, '/');
    return true;
  }

  if (!usuario) {
    html(res, ruta === '/' ? 200 : 401, paginaEntrar());
    return true;
  }

  // --- Ya dentro -----------------------------------------------------------
  if (ruta === '/' && req.method === 'GET') {
    html(res, 200, panelCompleto(panel));
    return true;
  }

  if (ruta === '/grupo' && req.method === 'POST') {
    const datos = await leerFormulario(req);
    const nombre = (datos.get('nombre') ?? '').trim();
    if (nombre) panel.crearGrupo(nombre);
    redirigir(res, '/');
    return true;
  }

  if (ruta === '/aprobar' && req.method === 'POST') {
    const datos = await leerFormulario(req);
    panel.aprobar(datos.get('codigo') ?? '', datos.get('grupo') ?? '', datos.get('nombre') ?? '');
    redirigir(res, '/');
    return true;
  }

  if (ruta === '/aparato/nombre' && req.method === 'POST') {
    const datos = await leerFormulario(req);
    const id = datos.get('id');
    if (id) panel.renombrarAparato(id, datos.get('nombre') ?? '');
    redirigir(res, '/');
    return true;
  }

  if (ruta === '/revocar' && req.method === 'POST') {
    const datos = await leerFormulario(req);
    const id = datos.get('id');
    if (id) panel.revocar(id);
    redirigir(res, '/');
    return true;
  }

  if (ruta === '/lista' && req.method === 'POST') {
    const datos = await leerFormulario(req);
    const grupo = datos.get('grupo') ?? '';
    const nombre = datos.get('nombre') ?? '';
    const url = datos.get('url') ?? '';
    if (grupo && url.trim()) panel.guardarLista(grupo, nombre, url, datos.get('id') ?? undefined);
    redirigir(res, '/');
    return true;
  }

  if (ruta === '/lista/borrar' && req.method === 'POST') {
    const datos = await leerFormulario(req);
    const id = datos.get('id');
    if (id) panel.borrarLista(id);
    redirigir(res, '/');
    return true;
  }

  if (ruta.startsWith('/lista/') && req.method === 'GET') {
    const id = ruta.slice('/lista/'.length);
    for (const grupo of panel.grupos()) {
      const lista = panel.listasDe(grupo.id).find((una) => una.id === id);
      if (lista) {
        html(res, 200, paginaLista(lista, grupo));
        return true;
      }
    }
    redirigir(res, '/');
    return true;
  }

  return false;
}
