# m3u player

Reproductor de listas M3U / paneles Xtream Codes con tres secciones: **TV en directo**
(organizada por grupos de canales), **películas** y **series**.

Todo se ejecuta en local: las credenciales del panel no salen de la máquina.

## Estado

| Pieza | Estado |
|---|---|
| Parser M3U extendido (`m3u_plus`) | listo |
| Clasificador directo / película / serie | listo |
| Fusión de variantes de calidad y reconstrucción de series | listo |
| Cliente Xtream Codes (`player_api.php`) | listo y probado contra un panel real |
| Herramienta de diagnóstico (`probe`) | listo |
| Árbitro de conexión (`max_connections`) | pendiente |
| Almacenamiento en SQLite (`node:sqlite`) | listo, medido con la lista real |
| Búsqueda global (FTS5) | lista |
| Reproductor (Electron 43 + mpv) | reproduce; orden Z pendiente de confirmar |
| Interfaz | pendiente |
| Descarga a disco | pendiente |

## Comprobado contra el panel real

- 218.662 entradas clasificadas sin dudosas: 486 canales en 37 grupos, 17.968
  películas y 6.598 series con 164.967 episodios.
- **La fusión por calidad absorbe 35.000 duplicados**: las películas bajan de
  23.179 entradas a 17.968 fichas, y los episodios de 194.820 a 164.967.
- `player_api.php` responde y `get_series_info` devuelve las temporadas hechas.
- **`max_connections: 1`**. Reproducir y descargar se excluyen mutuamente, y un
  mpv zombi deja la cuenta bloqueada. De ahí el árbitro de conexión.
- mpv se empotra en la ventana de Electron y decodifica por hardware (d3d11va).
- Electron 43 trae Node 24.18 y Chrome 150, y `node:sqlite` con FTS5 funciona
  dentro del proceso principal: la app no necesita módulos nativos.
- **El panel tarda ~30 segundos en liberar la conexión** tras cerrar el
  reproductor. Mientras tanto responde `HTTP 403` con el cuerpo
  `{"message": "Max Connections Reached"}`. La app tiene que reconocer ese
  error concreto y esperar, en vez de dar un fallo genérico de reproducción.
- Los ficheros son MKV en su mayoría, con AVI y MP4 mezclados, y **la extensión
  de la URL a veces miente** (un `.mkv` que por dentro es MP4). Las descargas
  deben nombrarse por el contenedor real, no por la URL.
- Todos los ficheros aceptan `Range`: las descargas se pueden pausar y reanudar.

## Estructura

```
packages/core/     TypeScript puro, sin Node ni Electron: reutilizable en móvil/TV
  src/models.ts      modelo de dominio
  src/normalize.ts   limpieza de nombres, grupos y calidades
  src/classify.ts    directo | película | serie | basura
  src/m3u/           parser y constructor de biblioteca
  src/xtream/        cliente de player_api.php
packages/storage/  persistencia en SQLite (node:sqlite, sin módulos nativos)
apps/desktop/      Electron + mpv
tools/probe/       diagnóstico y medición sobre una lista real
samples/           lista de ejemplo para pruebas
```

`packages/core` no importa nada específico de plataforma a propósito: es lo que
permitirá reutilizarlo tal cual en React Native cuando toque el port a móvil/TV.

## Uso

Diagnosticar tu lista (imprime qué clasifica, qué agrupa y qué se le escapa):

```bash
npm run probe -- "http://servidor:8080/get.php?username=U&password=P&type=m3u_plus"
```

Sobre un fichero local, sin tocar la red:

```bash
npm run probe -- --m3u samples/muestra.m3u
```

Opciones: `--json informe.json` vuelca la biblioteca completa, `--no-cache` fuerza
la descarga (por defecto se cachea en `.probe-cache/`). Las contraseñas se ocultan
en todo lo que se imprime.

Medir el almacenamiento contra una lista real:

```bash
npm run bench -- .probe-cache/<lista>.m3u
```

Abrir la app de escritorio (en PowerShell, `npm`/`npx` están bloqueados por la
política de ejecución de scripts, de ahí el lanzador):

```bash
.\app.cmd
```

Tests y comprobación de tipos:

```bash
npm test
npm run typecheck
```

## Decisiones tomadas

- **Xtream primero, M3U como plan B.** Si `player_api.php` responde, las series
  llegan ya estructuradas en temporadas y no hay que adivinar nada por el nombre.
  Muchos revendedores capan la API, así que el parseo del M3U tiene que funcionar solo.
- **Los avisos del proveedor se ocultan, no se borran.** A veces el "anuncio" es
  que la cuenta caduca en tres días.
- **La identidad de una serie no incluye el grupo.** El mismo título aparece
  repartido entre varios grupos del proveedor y debe verse como una sola ficha.
- **La identidad de un canal es su `tvg-id`**, y si no lo trae, su nombre sin el
  sufijo de calidad más su grupo. Sin esto, cada canal sale duplicado una vez por
  calidad disponible.
- **El reproductor será mpv empotrado, no `<video>`.** El VOD viene en `.mkv`, que
  Chromium no reproduce ni con vídeo H.264 dentro.

## Rendimiento medido (218.662 entradas, 67 MB)

| Paso | Tiempo |
|---|---|
| Leer el fichero | 222 ms |
| Parsear el M3U | 968 ms |
| Construir la biblioteca | 2.427 ms |
| Importar a SQLite | 2.422 ms |
| **Total** | **~6 s** |

La base resultante ocupa 70,5 MB. Todas las consultas de la interfaz —listar
grupos, paginar películas, temporadas de una serie, búsqueda global— tardan
**entre 0 y 1 ms**, así que la interfaz puede pedir datos según hace falta en
lugar de cargar nada en memoria.

Los ~6 segundos son solo del primer arranque o de un refresco: van en segundo
plano y con WAL activado se puede leer la biblioteca anterior mientras tanto.

## Orden Z del vídeo

Chromium y mpv se disputan quién se dibuja encima dentro de la misma ventana:
mientras mpv no ha empezado a decodificar se ve el HTML, y en cuanto arranca el
vídeo mpv sube su ventana hija por encima y tapa la interfaz.

Por eso la app usa **dos ventanas**: la anfitriona solo aloja a mpv, y la
interfaz vive en una ventana transparente superpuesta. Esa superposición se
marca como siempre-encima —una ventana de nivel superior gana a la ventana hija
de otra—, pero **solo mientras la app tiene el foco**, porque si no se queda
flotando sobre el resto de aplicaciones del escritorio.
