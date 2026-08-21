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
| Reproductor (Electron 43 + mpv) | reproduce, con la interfaz encima del vídeo |
| Pantalla completa y salida (botón / atrás ×2) | listas |
| Navegación y foco para mando (`packages/ui`) | listos, con tests |
| Barra de grupos en las tres secciones y en la serie | lista, con tests |
| Favoritos por perfil, con pulsación larga | listos, con tests |
| Parrilla del directo (EPG por canal) | lista, con tests |
| Orden por título, valoración o novedades | listo, con tests |
| Presentador y puerto de datos, con adaptador SQLite | listos, con tests |
| Alta de listas y sesión persistente | listas, con tests |
| Catálogo por `player_api.php`, sin descargar el M3U | listo, con tests |
| Biblioteca guardada en el aparato, con refresco a los 3 días | lista |
| App para Android, con reproductor (ExoPlayer) | navega y reproduce |
| Interfaz de escritorio (la vista) | pendiente |
| Descarga a disco | pendiente |

## Comprobado contra el panel real

- 218.662 entradas clasificadas sin dudosas: 486 canales en 37 grupos, 17.968
  películas y 6.598 series con 164.967 episodios.
- **La fusión por calidad absorbe 35.000 duplicados**: las películas bajan de
  23.179 entradas a 17.968 fichas, y los episodios de 194.820 a 164.967.
- `player_api.php` responde y `get_series_info` devuelve las temporadas hechas.
- **La ficha del episodio llega en esa misma respuesta.** Medido sobre las
  categorías de ficción: de 270 episodios, imagen en el 85-100 %, sinopsis en
  algo más de la mitad, nota en dos de cada tres, fecha en todos y duración en
  casi todos. `duration_secs` llega a cero a menudo y hay que leer `duration`
  ("00:57:00").
- **La fecha de alta está en `added`**, salvo en series, que solo dan
  `last_modified`. Es lo que ordena por novedades.
- **El EPG existe y es utilizable**: `get_short_epg` son 3,4 KB por canal
  —seis programas con título, sinopsis y horas— frente a los 186 KB de
  `get_simple_data_table`. Cobertura medida: GENERALISTAS 21/21, MOVISTAR
  15/15, SERIES 52/53, NOTICIAS 8/11; en cambio A3Player 0/12 y ARABES 0/10.
  Los títulos van en base64 y **los tiempos en UTC**.
- **`max_connections` varía según la cuenta**: 1 en la primera lista y 3 en una
  segunda del mismo proveedor. Con una sola ranura, reproducir y descargar se
  excluyen, y un mpv zombi deja la cuenta bloqueada. El árbitro tiene que leer
  ese número del handshake en vez de suponerlo.
- mpv se empotra en la ventana de Electron y decodifica por hardware (d3d11va).
  Probado con una película del panel: MKV con H.264 y **AC-3 de 6 canales**, que
  es justo lo que Chromium no reproduce. La interfaz se dibuja encima del vídeo.
- **`active_cons` del handshake no es fiable.** Marcaba 0 con una película
  sonando y oscilaba entre 0 y 1 con la app cerrada y sin procesos vivos. El
  árbitro de conexión no puede usarlo como semáforo: le toca reconocer el 403.
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
packages/ui/       navegación, foco y puerto de datos: sin plataforma, para TV
apps/desktop/      Electron + mpv
apps/tv/           React Native (react-native-tvos) para Android TV
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

## App de Android TV

`apps/tv` es la app de verdad: **Electron no se ejecuta en un televisor**, así
que `apps/desktop` queda como banco de pruebas del reproductor y prototipo
visual. Lo que se comparte entre las dos es `packages/core` y `packages/ui`.

Necesita JDK 17, el SDK de Android con la plataforma 36 y `build-tools` 36.0.0.
La ruta del SDK va en `apps/tv/android/local.properties`, que no se sube.

Arrancar Metro y, con un aparato conectado, compilar e instalar:

```bash
npm start --workspace m3utv
```

```bash
npm run android --workspace m3utv
```

Empaquetar el bundle sin necesidad de SDK, útil para comprobar que las
importaciones del monorepo resuelven:

```bash
cd apps/tv && npx react-native bundle --platform android --dev true --entry-file index.js --bundle-output /tmp/bundle.js --assets-dest /tmp/assets
```

### Trabajar contra el aparato sin cable

Con el aparato enchufado por USB una sola vez, se le dice que escuche por red y
a partir de ahí se trabaja por wifi:

```bash
adb tcpip 5555
```

```bash
adb connect <ip-del-aparato>:5555
```

La IP sale de `adb shell ip -f inet addr show wlan0`. Después:

```bash
adb reverse tcp:8081 tcp:8081
```

**Esa redirección es lo que conecta la app con Metro**, y se pierde cada vez
que cambia el transporte: al quitar el cable, al reconectar por wifi o al
reiniciar `adb`. Si la app arranca con la pantalla roja de "no se pudo conectar
al servidor de desarrollo", casi siempre es eso y no el código.

El modo TCP tampoco sobrevive a reiniciar el aparato: hay que volver a
enchufarlo y repetir `adb tcpip`. Para que aguante reinicios está la
depuración inalámbrica con código de emparejamiento (`adb pair`), que es de
Android 11 en adelante.

Cuando ya no se está iterando, el APK de release no necesita nada de esto: el
JavaScript va dentro y funciona sin Metro ni portátil.

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

Dentro de la ventana conviven dos ventanas hijas: la de mpv (clase `mpv`) y la
superficie de Chromium (clase `Intermediate D3D Window`). Quién se dibuja
encima decide si se ve el vídeo o la interfaz.

**Medido en Electron 43.4.1 con mpv 0.41: gana Chromium.** Enumerando las hijas
en orden Z, la superficie de Chromium sale por encima de la de mpv:

```
Z0 (arriba)  'Intermediate D3D Window'   visible  1264x681
Z1 (debajo)  'mpv'                       visible  1264x681
```

Eso hace que la interfaz se dibuje sobre el vídeo sin trucos. La única
condición es que la ventana **no pinte un fondo opaco**, porque ese fondo tapa
el vídeo: por eso la ventana se crea con `transparent: true` y alfa cero, y el
HTML lleva `background: transparent`.

Antes se daba por hecho lo contrario —que mpv subía su ventana hija al empezar
a decodificar— y se usaban dos ventanas, una anfitriona para el vídeo y otra
superpuesta para la interfaz, marcada como siempre-encima. Con estas versiones
eso mostraba **una pantalla negra**: mpv reproducía correctamente (socket de
control respondiendo, `vo-configured: true`, tiempo avanzando), pero el fondo
opaco de la anfitriona lo tapaba. Se comprobó igual en D3D11 y en `--sw`.

Comprobado con una película real del panel (MKV, H.264 y AC-3 5.1) decodificando
por `d3d11va`: el vídeo se ve debajo de la interfaz y a través de los bloques
translúcidos. El plano de superposición de hardware no llega a aparecer.

Al verificarlo, ojo con las capturas de pantalla: el vídeo acelerado puede salir
negro en la captura y verse perfectamente en el monitor. Conviene contrastar
preguntando a mpv por su socket (`vo-configured`, `time-pos`, `width`) y
enumerando las ventanas hijas en orden Z.

### El precio: la ventana no se redimensiona a mano

`transparent: true` en Windows hace que Electron marque la ventana como no
redimensionable. Medido:

| Operación | Resultado |
|---|---|
| Arrastrar los bordes | **no** (la ventana no tiene `WS_THICKFRAME`) |
| `setResizable(true)` | no lo revierte, `isResizable()` sigue en `false` |
| `setSize()` | se ignora |
| `setBounds()` | funciona |
| `maximize()` / pantalla completa | funcionan |

Así que la interfaz tendrá que traer marco propio y redimensionar con
`setBounds`, o conformarse con tamaño fijo más maximizar.
