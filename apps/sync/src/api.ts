/**
 * Lo que hablan los aparatos con el servidor.
 *
 * Cinco peticiones y ninguna más: darse de alta, esperar el visto bueno,
 * sincronizar, pedir las listas y recoger las portadas del inicio. Todo va con `Authorization: Bearer` salvo
 * el alta, que todavía no tiene token —**nunca en la URL**: lo que va en la
 * dirección acaba en los registros del servidor y en el historial del
 * navegador—.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

import { aplicarCambios, cambiosDesde, sellarRecepcion } from '@m3u/storage/sincronizar';
import { marcaTras } from '@m3u/ui';

import { json, leerJson, tokenDe } from './http.ts';
import type { Panel } from './panel.ts';

/** Un texto de la petición, o null si no vale. */
function texto(datos: Record<string, unknown>, clave: string, largo = 200): string | null {
  const valor = datos[clave];
  if (typeof valor !== 'string') return null;
  const limpio = valor.trim();
  return limpio && limpio.length <= largo ? limpio : null;
}

export async function manejarApi(
  panel: Panel,
  req: IncomingMessage,
  res: ServerResponse,
  ruta: string,
): Promise<boolean> {
  if (!ruta.startsWith('/api/')) return false;

  // --- Alta: el aparato pide un código para que lo apruebes --------------
  if (ruta === '/api/alta' && req.method === 'POST') {
    const datos = await leerJson(req);
    const alta = panel.pedirAlta({
      aparato: texto(datos, 'aparato', 64) ?? undefined,
      // El modelo del aparato, para que en el panel se distinga "Philips
      // 50PUS" de "Xiaomi Pad" sin tener que adivinar cuál es cuál.
      apodo: texto(datos, 'apodo', 80) ?? undefined,
    });
    json(res, 200, alta);
    return true;
  }

  // --- Espera: ¿ya me has aprobado? --------------------------------------
  if (ruta === '/api/espera' && req.method === 'POST') {
    const espera = texto(await leerJson(req), 'espera', 128);
    if (!espera) {
      json(res, 400, { error: 'falta el secreto de espera' });
      return true;
    }

    const resultado = panel.recoger(espera);
    if (resultado === null) {
      // Puede ser un secreto inventado o un alta ya caducada. No se distingue
      // a propósito: la respuesta no debe servir para ir tanteando.
      json(res, 404, { estado: 'desconocido' });
      return true;
    }
    if (resultado === 'pendiente') {
      json(res, 200, { estado: 'pendiente' });
      return true;
    }

    const grupo = resultado.aparato.grupoId ? panel.grupo(resultado.aparato.grupoId) : null;
    json(res, 200, {
      estado: 'aprobado',
      token: resultado.token,
      aparato: { id: resultado.aparato.id, nombre: resultado.aparato.nombre },
      grupo: grupo ? { id: grupo.id, nombre: grupo.nombre } : null,
      listas: grupo ? panel.listasDe(grupo.id).map(({ id, nombre, url }) => ({ id, nombre, url })) : [],
    });
    return true;
  }

  // A partir de aquí hace falta token.
  const token = tokenDe(req);
  const aparato = token ? panel.porToken(token) : null;
  if (!aparato || !aparato.grupoId) {
    if (ruta === '/api/sync' || ruta === '/api/listas' || ruta === '/api/portadas') {
      json(res, 401, { error: 'token no válido' });
      return true;
    }
    return false;
  }

  // --- Las listas del grupo ----------------------------------------------
  if (ruta === '/api/listas' && req.method === 'GET') {
    json(res, 200, { listas: panel.listasDe(aparato.grupoId).map(({ id, nombre, url }) => ({ id, nombre, url })) });
    return true;
  }

  // --- Las portadas del inicio --------------------------------------------
  if (ruta === '/api/portadas' && req.method === 'GET') {
    /*
      Lo preparado por el trabajo diario. El aparato lo usa si está y sigue
      funcionando por su cuenta si no: esto acelera el inicio, no lo sostiene.
    */
    const preparadas = panel
      .listasDe(aparato.grupoId)
      .map((lista) => panel.portadasDe(lista.id))
      .filter((guardado) => guardado !== null);

    const datos = preparadas.map((guardado) => guardado.datos as { portadas?: unknown[]; generos?: unknown[] });

    json(res, 200, {
      // La más vieja de las listas: es hasta cuándo se puede decir que todo
      // esto está al día.
      generado: preparadas.map((guardado) => guardado.generado).sort()[0] ?? null,
      portadas: datos.flatMap((uno) => uno?.portadas ?? []),
      generos: datos.flatMap((uno) => uno?.generos ?? []),
    });
    return true;
  }

  // --- La sincronización --------------------------------------------------
  if (ruta === '/api/sync' && req.method === 'POST') {
    const datos = await leerJson(req);
    const desde = typeof datos.desde === 'string' ? datos.desde : '';
    const entrantes = Array.isArray(datos.cambios) ? datos.cambios : [];

    const base = panel.baseDeGrupo(aparato.grupoId);

    // Primero se mete lo que trae y después se lee lo que hay. Al revés, un
    // aparato que acabe de perder sus datos necesitaría dos vueltas para
    // volver a estar completo. Que le regrese algo de lo que él mismo acaba
    // de mandar no cuesta nada: la fusión lo descarta por empate.
    const aplicados = aplicarCambios(base, entrantes);
    sellarRecepcion(base, aplicados, panel.selloNuevo());

    // Las novedades van por el sello del servidor, no por la fecha del
    // cambio: si no, lo que sube un aparato que llevaba días apagado se
    // quedaría por detrás de la marca de los demás y no lo vería nadie.
    const salientes = cambiosDesde(base, desde, 'recibido');

    panel.anotarSincronizacion(aparato.id);
    json(res, 200, { cambios: salientes, marca: marcaTras(desde, salientes) });
    return true;
  }

  return false;
}
