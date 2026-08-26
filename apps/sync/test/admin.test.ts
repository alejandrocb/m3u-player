/**
 * La web de administración: quién puede entrar y quién no.
 *
 * Lo que se comprueba aquí no es que las páginas queden bonitas, sino que no
 * haya forma de administrar nada sin haber entrado, y que la primera cuenta
 * no se la pueda crear el primero que pase.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { Panel } from '../src/panel.ts';
import { crearServidor } from '../src/servidor.ts';

const CODIGO = 'ABCD-2345';

interface Montaje {
  url: string;
  panel: Panel;
  cerrar: () => Promise<void>;
}

async function montar(): Promise<Montaje> {
  const carpeta = mkdtempSync(join(tmpdir(), 'm3u-admin-'));
  const panel = new Panel(carpeta);
  const servidor = crearServidor(panel, () => CODIGO);

  await new Promise<void>((listo) => servidor.listen(0, '127.0.0.1', listo));
  const puerto = (servidor.address() as AddressInfo).port;

  return {
    url: `http://127.0.0.1:${puerto}`,
    panel,
    cerrar: async () => {
      await new Promise<void>((hecho) => servidor.close(() => hecho()));
      panel.cerrar();
      try {
        rmSync(carpeta, { recursive: true, force: true });
      } catch {
        // En Windows el fichero puede quedar bloqueado un instante.
      }
    },
  };
}

/** Manda un formulario, sin seguir la redirección para poder mirarla. */
function enviar(url: string, ruta: string, campos: Record<string, string>, cookie?: string) {
  const cabeceras: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded' };
  if (cookie) cabeceras.cookie = cookie;
  return fetch(`${url}${ruta}`, {
    method: 'POST',
    headers: cabeceras,
    body: new URLSearchParams(campos).toString(),
    redirect: 'manual',
  });
}

/** La cookie de sesión que devuelve una respuesta, lista para reenviar. */
function galletaDe(respuesta: Response): string {
  const puesta = respuesta.headers.get('set-cookie') ?? '';
  return puesta.split(';')[0] ?? '';
}

async function crearAdmin(m: Montaje): Promise<string> {
  const respuesta = await enviar(m.url, '/inicial', {
    codigo: CODIGO,
    usuario: 'alejandro',
    contrasena: 'una-contrasena-larga',
  });
  return galletaDe(respuesta);
}

test('sin cuenta, la web pide el código de instalación', async () => {
  const m = await montar();
  try {
    const pagina = await (await fetch(m.url)).text();
    assert.match(pagina, /Crear el administrador/);
    assert.match(pagina, /Código de instalación/);
    // Y el código no se filtra en la página: solo está en el registro.
    assert.doesNotMatch(pagina, new RegExp(CODIGO));
  } finally {
    await m.cerrar();
  }
});

test('con un código equivocado no se crea la cuenta', async () => {
  const m = await montar();
  try {
    const respuesta = await enviar(m.url, '/inicial', {
      codigo: 'ZZZZ-9999',
      usuario: 'intruso',
      contrasena: 'una-contrasena-larga',
    });

    assert.equal(respuesta.status, 403);
    assert.equal(m.panel.hayAdmin(), false);
  } finally {
    await m.cerrar();
  }
});

test('una contraseña corta no vale', async () => {
  const m = await montar();
  try {
    const respuesta = await enviar(m.url, '/inicial', { codigo: CODIGO, usuario: 'alejandro', contrasena: 'corta' });

    assert.equal(respuesta.status, 400);
    assert.equal(m.panel.hayAdmin(), false);
  } finally {
    await m.cerrar();
  }
});

test('con el código bueno se crea la cuenta y se entra', async () => {
  const m = await montar();
  try {
    const cookie = await crearAdmin(m);
    assert.equal(m.panel.hayAdmin(), true);
    assert.match(cookie, /^sesion=/);

    const panel = await (await fetch(m.url, { headers: { cookie } })).text();
    assert.match(panel, /Nuevo grupo/);
  } finally {
    await m.cerrar();
  }
});

test('creada la cuenta, el código de instalación ya no abre nada', async () => {
  const m = await montar();
  try {
    await crearAdmin(m);

    const pagina = await (await fetch(m.url)).text();
    assert.match(pagina, /Usuario/);
    assert.doesNotMatch(pagina, /Código de instalación/);
  } finally {
    await m.cerrar();
  }
});

test('sin sesión no se administra nada', async () => {
  const m = await montar();
  try {
    await crearAdmin(m);

    const creado = await enviar(m.url, '/grupo', { nombre: 'Casa Intrusa' });
    assert.equal(creado.status, 401);
    assert.deepEqual(m.panel.grupos(), []);
  } finally {
    await m.cerrar();
  }
});

test('una contraseña incorrecta no abre sesión', async () => {
  const m = await montar();
  try {
    await crearAdmin(m);

    const respuesta = await enviar(m.url, '/entrar', { usuario: 'alejandro', contrasena: 'la-que-no-es' });
    assert.equal(respuesta.status, 401);
    assert.equal(respuesta.headers.get('set-cookie'), null);
  } finally {
    await m.cerrar();
  }
});

test('la cookie de sesión no se la puede leer un script', async () => {
  const m = await montar();
  try {
    const respuesta = await enviar(m.url, '/inicial', {
      codigo: CODIGO,
      usuario: 'alejandro',
      contrasena: 'una-contrasena-larga',
    });

    const puesta = respuesta.headers.get('set-cookie') ?? '';
    assert.match(puesta, /HttpOnly/);
    assert.match(puesta, /Secure/);
    assert.match(puesta, /SameSite=Lax/);
  } finally {
    await m.cerrar();
  }
});

test('el panel enseña el servidor de una lista, no sus credenciales', async () => {
  const m = await montar();
  try {
    const cookie = await crearAdmin(m);
    const grupo = m.panel.crearGrupo('Casa Triana');
    m.panel.guardarLista(grupo.id, 'Principal', 'http://panel.example:8080/get.php?username=pepe&password=secreta');

    const pagina = await (await fetch(m.url, { headers: { cookie } })).text();
    assert.match(pagina, /panel\.example/);
    // Ni el usuario ni la contraseña del panel salen en la portada.
    assert.doesNotMatch(pagina, /secreta/);
    assert.doesNotMatch(pagina, /pepe/);
  } finally {
    await m.cerrar();
  }
});

test('al salir, la sesión deja de valer', async () => {
  const m = await montar();
  try {
    const cookie = await crearAdmin(m);
    await enviar(m.url, '/salir', {}, cookie);

    const creado = await enviar(m.url, '/grupo', { nombre: 'Casa Triana' }, cookie);
    assert.equal(creado.status, 401);
  } finally {
    await m.cerrar();
  }
});
