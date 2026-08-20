# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Reproductor de escritorio para listas M3U / paneles Xtream Codes, con tres
secciones: TV en directo (por grupos de canales), películas y series. El
objetivo a medio plazo incluye **descargar contenido a disco**, que es lo que
no hacen los reproductores comerciales del estilo de IBO Player Pro.

La conversación con el usuario es en español; el código y los comentarios
también.

## Comandos

```bash
npm test                                  # todas las suites
node --test packages/core/test/classify.test.ts   # una sola suite
npm run typecheck                         # tsc, sin emitir
npm run probe -- "<url de get.php>"       # diagnóstico de una lista real
npm run probe -- --m3u samples/muestra.m3u
npm run bench -- .probe-cache/<lista>.m3u # medir el almacenamiento
.\app.cmd                                 # abrir la app de escritorio
.\app.cmd --sw                            # ídem, con salida de vídeo por software
```

**En PowerShell, `npm` y `npx` fallan** con `UnauthorizedAccess`: la política de
ejecución de scripts del equipo bloquea `npm.ps1`. Usa `npm.cmd` / `npx.cmd`, o
los lanzadores directos (`.\app.cmd`, `.\node_modules\.bin\electron.cmd`).

## Cómo se ejecuta el TypeScript

**No hay paso de compilación.** Node ejecuta los `.ts` directamente borrando los
tipos, así que el código debe ser "borrable":

- Nada de propiedades de parámetro en constructores (`constructor(private x)`),
  ni `enum`, ni `namespace`. `erasableSyntaxOnly` está activo en tsconfig y lo
  detecta, pero el error real aparece al ejecutar.
- Los imports relativos llevan la extensión `.ts` explícita.
- Requiere Node >= 22.18 (se desarrolla con 24).

## Arquitectura

Monorepo de workspaces npm. La separación importante es **`packages/core` no
importa nada de Node, Electron ni navegador**, a propósito: es lo que permitirá
reutilizarlo tal cual cuando llegue el port a móvil/TV. Todo lo específico de
plataforma vive fuera.

- **`packages/core`** — parser de M3U extendido, clasificador y construcción de
  la biblioteca. Sin dependencias.
- **`packages/storage`** — persistencia en SQLite con `node:sqlite` (viene
  dentro de Node y de Electron 43; **no hay módulos nativos que compilar**, y no
  debe introducirse ninguno). Búsqueda global con FTS5.
- **`apps/desktop`** — Electron + mpv. JavaScript (`.mjs`), sin bundler todavía.
- **`tools/probe`** — diagnóstico y medición contra la lista real del usuario.

### El invariante del dominio: fusionar variantes de calidad

El proveedor manda **una entrada por cada calidad** del mismo contenido: "24
Horas FHD" y "24 Horas SD", "El aviso (2018) 1080p" y "El aviso (2018) 720p",
"Doctor Who S2 E1" en 720p y en 1080p. Sin fusionarlas, la biblioteca se llena
de duplicados: en la lista real son 35.000 fichas repetidas.

`buildLibrary` fusiona por identidad y guarda las calidades como `variants[]`,
ordenadas de mejor a peor. Las identidades son:

| Entidad | Identidad |
|---|---|
| Canal | `tvg-id`; si falta, nombre sin sufijo de calidad + grupo |
| Película | título limpio + año |
| Serie | título limpio + año, **sin** el grupo |
| Episodio | temporada + número, dentro de su serie |

La serie no incluye el grupo en su identidad a propósito: el proveedor reparte
la misma serie entre `TV Series NETFLIX` y `TV Series OTROS`, y debe salir una
sola ficha.

### El sesgo del clasificador: nunca ocultar contenido

`classify()` decide entre directo, película, serie y basura combinando tres
señales, en orden de fiabilidad: la ruta de la URL (`/live/`, `/movie/`,
`/series/`), el `group-title`, y el patrón del nombre.

**Ante la duda, mostrar.** Una película escondida es un fallo invisible; una
mal colocada se ve y se corrige. En concreto:

- El filtro de avisos del proveedor exige **doble señal** (palabra de aviso y
  palabra de contexto de servicio) y no se aplica a nada que huela a VOD.
  Antes ocultaba *El aviso*, *Tres anuncios en las afueras* y *Contacto
  sangriento*, que son películas reales.
- Las entradas dudosas se conservan en `library.unclassified` y el `probe` las
  imprime: es la lista de tareas para afinar el clasificador.

Rarezas reales de la lista que el parseo ya contempla: números de episodio de
cinco cifras (el proveedor cuela el id del stream), el año usado como número de
temporada (`S2026 E24`), y decoración en los grupos (`== NOTICIAS`).

### Restricciones del proveedor que condicionan el diseño

- **`max_connections: 1`.** Reproducir y descargar se excluyen mutuamente. Hace
  falta un árbitro que posea la única ranura: la reproducción siempre gana y la
  descarga se pausa (los ficheros aceptan `Range`, así que reanuda donde iba).
- Cuando la ranura está ocupada, el servidor devuelve **`HTTP 403` con el cuerpo
  `{"message": "Max Connections Reached"}`**. Hay que reconocer ese error
  concreto y esperar, no darlo como fallo de reproducción.
- **El panel tarda ~30 s en liberar la conexión** tras cerrar el reproductor,
  aunque no quede ningún proceso vivo en la máquina.
- Cerrar mpv debe liberar la conexión *siempre*: un proceso zombi deja la cuenta
  bloqueada.
- **La extensión de la URL miente a veces** (un `.mkv` que por dentro es MP4).
  Las descargas deben nombrarse por el contenedor real, leyendo los primeros
  bytes; `tools/probe/src/sniff.mjs` ya identifica contenedores así.

### Reproducción: mpv, no `<video>`

El VOD viene en MKV y AVI, que Chromium no reproduce, y con audio AC3/E-AC3 que
tampoco decodifica. mpv se empotra pasándole el HWND de la ventana (`--wid`) y
se controla por su socket JSON (tubería con nombre en Windows).

Chromium y mpv se disputan el orden Z dentro de la misma ventana, así que la app
usa **dos ventanas**: la anfitriona solo aloja a mpv, y la interfaz vive en una
ventana transparente superpuesta marcada como siempre-encima **solo mientras la
app tiene el foco** (si no, flota sobre el resto del escritorio). Esto todavía
no está confirmado del todo: falta comprobarlo fuera de una sesión RDP, donde la
salida D3D11 de mpv puede acabar en un plano de superposición de hardware que se
salta el orden Z. `.\app.cmd --sw` fuerza salida por software para descartarlo.

## Trampas conocidas

- **Regex construidas con plantillas**: dentro de `` ` ` ``, `\b` es un carácter
  de retroceso y `\s` se queda en `s`. Usa `String.raw`. Costó dos bugs
  silenciosos en `normalize.ts`.
- **`node:sqlite` devuelve objetos sin prototipo.** El almacén los convierte a
  objetos normales antes de devolverlos; mantén esa costumbre o `deepEqual`
  fallará en los tests.
- **FTS5 se rompe con la puntuación del usuario.** `toMatchQuery` entrecomilla
  palabra a palabra; no pases texto crudo a `MATCH`.
- **`.probe-cache/` contiene la lista real con las credenciales del panel en
  cada URL**, y `.probe-cache/test-url.txt` también. Está en `.gitignore`. Al
  imprimir cualquier URL, redáctala como hacen `probe` y `main.mjs`.

## Estado y siguiente paso

El README lleva la tabla de estado y las cifras medidas contra la lista real
(218.662 entradas, ~6 s de importación completa, consultas de 0-1 ms).

Pendiente: confirmar el orden Z, el árbitro de conexión, la interfaz y la
descarga a disco.
