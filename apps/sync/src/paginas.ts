/**
 * El HTML de la web de administración.
 *
 * Se pinta en el servidor y no lleva JavaScript: son formularios. Para lo que
 * hay que hacer aquí —aprobar un aparato, pegar una URL— no aporta nada, y a
 * cambio la página funciona igual dentro de tres años y no hay nada que
 * empaquetar ni actualizar.
 */

import { escapar } from './http.ts';
import type { Aparato, Grupo, Lista } from './panel.ts';

const ESTILO = `
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body {
  margin: 0; padding: 24px; background: #06131c; color: #dfe7ee;
  font: 16px/1.5 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
}
main { max-width: 900px; margin: 0 auto; }
h1 { font-size: 28px; margin: 0 0 4px; color: #fff; }
h2 { font-size: 21px; margin: 32px 0 12px; color: #fff; }
h3 { font-size: 17px; margin: 20px 0 8px; color: #8fa3b3; font-weight: 600; }
p.pie { color: #5d6f7d; font-size: 14px; margin-top: 4px; }
a { color: #35d07f; }
.tarjeta { background: rgba(255,255,255,0.06); border-radius: 10px; padding: 18px; margin-bottom: 14px; }
.fila { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; justify-content: space-between; }
.crece { flex: 1; min-width: 200px; }
label { display: block; color: #8fa3b3; font-size: 14px; margin: 10px 0 4px; }
input, select {
  width: 100%; padding: 11px 13px; border-radius: 8px; border: 2px solid transparent;
  background: rgba(255,255,255,0.08); color: #fff; font-size: 16px;
}
input:focus, select:focus { outline: none; border-color: #35d07f; }
button {
  padding: 11px 20px; border-radius: 8px; border: 0; cursor: pointer;
  background: rgba(255,255,255,0.1); color: #dfe7ee; font-size: 15px;
}
button.principal { background: #35d07f; color: #06131c; font-weight: 700; }
button.peligro { background: rgba(255,107,107,0.18); color: #ff9b9b; }
form.linea { display: flex; gap: 10px; align-items: flex-end; flex-wrap: wrap; }
form.linea .campo { flex: 1; min-width: 160px; }
code { background: rgba(255,255,255,0.09); padding: 3px 8px; border-radius: 5px; font-size: 15px; }
code.codigo { font-size: 22px; letter-spacing: 2px; color: #35d07f; }
.aviso { background: rgba(255,107,107,0.14); border-left: 3px solid #ff6b6b; padding: 12px 14px; border-radius: 6px; }
.suave { color: #8fa3b3; font-size: 14px; }
.vacio { color: #5d6f7d; font-style: italic; }
table { width: 100%; border-collapse: collapse; }
td, th { text-align: left; padding: 9px 8px; border-bottom: 1px solid rgba(255,255,255,0.08); }
th { color: #8fa3b3; font-weight: 600; font-size: 14px; }
`;

function pagina(titulo: string, cuerpo: string): string {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapar(titulo)}</title>
<style>${ESTILO}</style>
</head>
<body><main>${cuerpo}</main></body>
</html>`;
}

export function paginaEntrar(error?: string): string {
  return pagina(
    'Entrar',
    `<h1>Sincronización</h1>
     <p class="pie">Panel de administración</p>
     ${error ? `<p class="aviso">${escapar(error)}</p>` : ''}
     <form method="post" action="/entrar" class="tarjeta">
       <label for="usuario">Usuario</label>
       <input id="usuario" name="usuario" autocomplete="username" autofocus>
       <label for="contrasena">Contraseña</label>
       <input id="contrasena" name="contrasena" type="password" autocomplete="current-password">
       <p></p>
       <button class="principal" type="submit">Entrar</button>
     </form>`,
  );
}

export function paginaPrimerUso(error?: string): string {
  return pagina(
    'Primer uso',
    `<h1>Crear el administrador</h1>
     <p class="pie">
       Todavía no hay ninguna cuenta. El código de instalación se ha escrito en
       el registro del contenedor: <code>docker compose logs sync</code>.
     </p>
     ${error ? `<p class="aviso">${escapar(error)}</p>` : ''}
     <form method="post" action="/inicial" class="tarjeta">
       <label for="codigo">Código de instalación</label>
       <input id="codigo" name="codigo" autofocus autocapitalize="characters">
       <label for="usuario">Usuario</label>
       <input id="usuario" name="usuario" autocomplete="username">
       <label for="contrasena">Contraseña</label>
       <input id="contrasena" name="contrasena" type="password" autocomplete="new-password">
       <p></p>
       <button class="principal" type="submit">Crear</button>
     </form>`,
  );
}

function opcionesDeGrupo(grupos: Grupo[]): string {
  return grupos.map((grupo) => `<option value="${escapar(grupo.id)}">${escapar(grupo.nombre)}</option>`).join('');
}

function cuandoFue(iso: string | null): string {
  if (!iso) return 'nunca';
  const fecha = new Date(iso);
  return fecha.toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
}

const ESTADOS: Record<Aparato['estado'], string> = {
  pendiente: 'pendiente',
  aprobado: 'esperando a conectarse',
  activo: 'activo',
  revocado: 'revocado',
};

function bloquePendientes(pendientes: Aparato[], grupos: Grupo[]): string {
  if (pendientes.length === 0) return '';
  if (grupos.length === 0) {
    return `<h2>Aparatos esperando</h2>
      <p class="aviso">Hay ${pendientes.length} aparato(s) pidiendo alta, pero primero tienes que crear un grupo.</p>`;
  }

  const fichas = pendientes
    .map(
      (aparato) => `
      <div class="tarjeta">
        <div class="fila">
          <div>
            <code class="codigo">${escapar(aparato.codigo)}</code>
            <div class="suave">${escapar(aparato.apodo ?? 'aparato sin identificar')} · pidió el ${cuandoFue(aparato.pedido)}</div>
          </div>
        </div>
        <form method="post" action="/aprobar" class="linea" style="margin-top:12px">
          <input type="hidden" name="codigo" value="${escapar(aparato.codigo)}">
          <div class="campo">
            <label>Nombre</label>
            <input name="nombre" placeholder="TV Salón" required>
          </div>
          <div class="campo">
            <label>Grupo</label>
            <select name="grupo">${opcionesDeGrupo(grupos)}</select>
          </div>
          <button class="principal" type="submit">Aprobar</button>
        </form>
      </div>`,
    )
    .join('');

  return `<h2>Aparatos esperando</h2>
    <p class="suave">Comprueba que el código coincide con el que se ve en la pantalla del aparato.</p>
    ${fichas}`;
}

function bloqueGrupo(grupo: Grupo, aparatos: Aparato[], listas: Lista[], anfitrion: (url: string) => string): string {
  const filasAparatos =
    aparatos.length === 0
      ? '<tr><td colspan="4" class="vacio">Ningún aparato todavía.</td></tr>'
      : aparatos
          .map(
            (aparato) => `
        <tr>
          <td>
            <form method="post" action="/aparato/nombre" class="linea">
              <input type="hidden" name="id" value="${escapar(aparato.id)}">
              <input name="nombre" value="${escapar(aparato.nombre)}" aria-label="Nombre del aparato">
              <button type="submit">Guardar</button>
            </form>
            <div class="suave">${escapar(aparato.apodo ?? 'aparato sin identificar')}</div>
          </td>
          <td class="suave">${escapar(ESTADOS[aparato.estado])}</td>
          <td class="suave">${escapar(cuandoFue(aparato.ultima))}</td>
          <td>${
            aparato.estado === 'revocado'
              ? ''
              : `<form method="post" action="/revocar">
                   <input type="hidden" name="id" value="${escapar(aparato.id)}">
                   <button class="peligro" type="submit">Revocar</button>
                 </form>`
          }</td>
        </tr>`,
          )
          .join('');

  const filasListas =
    listas.length === 0
      ? '<tr><td colspan="3" class="vacio">Ninguna lista. Los aparatos de esta casa no recibirán nada.</td></tr>'
      : listas
          .map(
            (lista) => `
        <tr>
          <td>${escapar(lista.nombre)}</td>
          <td class="suave">${escapar(anfitrion(lista.url))}</td>
          <td>
            <a href="/lista/${escapar(lista.id)}">Editar</a>
          </td>
        </tr>`,
          )
          .join('');

  return `
    <h2>${escapar(grupo.nombre)}</h2>
    <div class="tarjeta">
      <h3>Aparatos</h3>
      <table>
        <tr><th>Nombre</th><th>Estado</th><th>Última sincronización</th><th></th></tr>
        ${filasAparatos}
      </table>

      <h3>Listas</h3>
      <table>
        <tr><th>Nombre</th><th>Servidor</th><th></th></tr>
        ${filasListas}
      </table>
      <p class="suave">Solo se muestra el servidor: la dirección lleva usuario y contraseña dentro.</p>

      <form method="post" action="/lista" class="linea" style="margin-top:14px">
        <input type="hidden" name="grupo" value="${escapar(grupo.id)}">
        <div class="campo">
          <label>Nombre</label>
          <input name="nombre" placeholder="Lista principal" required>
        </div>
        <div class="campo" style="flex:2">
          <label>Dirección</label>
          <input name="url" placeholder="http://servidor:8080/get.php?username=..." required>
        </div>
        <button type="submit">Añadir lista</button>
      </form>
    </div>`;
}

export function paginaPanel(datos: {
  pendientes: Aparato[];
  grupos: Grupo[];
  aparatosDe: (grupoId: string) => Aparato[];
  listasDe: (grupoId: string) => Lista[];
  anfitrion: (url: string) => string;
}): string {
  const grupos = datos.grupos
    .map((grupo) => bloqueGrupo(grupo, datos.aparatosDe(grupo.id), datos.listasDe(grupo.id), datos.anfitrion))
    .join('');

  return pagina(
    'Sincronización',
    `<div class="fila">
       <h1>Sincronización</h1>
       <form method="post" action="/salir"><button type="submit">Salir</button></form>
     </div>

     ${bloquePendientes(datos.pendientes, datos.grupos)}

     ${grupos || '<p class="vacio">Todavía no hay ningún grupo.</p>'}

     <h2>Nuevo grupo</h2>
     <form method="post" action="/grupo" class="linea tarjeta">
       <div class="campo">
         <label>Nombre de la casa</label>
         <input name="nombre" placeholder="Casa Triana" required>
       </div>
       <button class="principal" type="submit">Crear grupo</button>
     </form>`,
  );
}

export function paginaLista(lista: Lista, grupo: Grupo): string {
  return pagina(
    'Editar lista',
    `<h1>${escapar(lista.nombre)}</h1>
     <p class="pie">${escapar(grupo.nombre)}</p>
     <form method="post" action="/lista" class="tarjeta">
       <input type="hidden" name="id" value="${escapar(lista.id)}">
       <input type="hidden" name="grupo" value="${escapar(grupo.id)}">
       <label for="nombre">Nombre</label>
       <input id="nombre" name="nombre" value="${escapar(lista.nombre)}" required>
       <label for="url">Dirección completa</label>
       <input id="url" name="url" value="${escapar(lista.url)}" required>
       <p class="suave">Lleva usuario y contraseña dentro. Los aparatos del grupo la recibirán tal cual.</p>
       <button class="principal" type="submit">Guardar</button>
     </form>

     <form method="post" action="/lista/borrar" class="tarjeta">
       <input type="hidden" name="id" value="${escapar(lista.id)}">
       <button class="peligro" type="submit">Borrar esta lista</button>
     </form>

     <p><a href="/">Volver</a></p>`,
  );
}
