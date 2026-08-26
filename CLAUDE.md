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
- **`apps/sync`** — el servidor del VPS: emparejamiento por código, grupos por
  casa y el `POST /api/sync`. Sin dependencias, en un contenedor detrás de
  Caddy. Cada grupo tiene su SQLite **con el mismo esquema que los aparatos**,
  para poder usar el mismo código de fusión a los dos lados.
- **`packages/ui`** — el comportamiento de la interfaz sin pintarla: pila de
  navegación, foco en rejilla y el puerto de datos que la vista consume. Sin
  dependencias de plataforma, como el core: **el destino es Android TV y
  tablets**, así que la vista de `apps/desktop` es un prototipo desechable y
  esto es lo que se reutiliza en React Native.
- **`apps/desktop`** — Electron + mpv. JavaScript (`.mjs`), sin bundler todavía.
- **`tools/probe`** — diagnóstico y medición contra la lista real del usuario.

### Las cuatro pantallas tienen la misma forma

TV en directo, películas, series y el interior de una serie son **la misma
pantalla**: una barra a la izquierda con los grupos y una rejilla a la derecha
con lo que haya en el grupo marcado. En una serie los "grupos" son sus
temporadas y la rejilla son los episodios.

Antes eran ocho pantallas apiladas de dos en dos (directo → grupo, serie →
temporada). Con la barra, elegir grupo **reemplaza** la pantalla en vez de
apilar otra: "atrás" sale de la sección de una vez, en lugar de ir deshaciendo
las categorías que hayas mirado.

`EstadoPantalla.formato` le dice a la vista cómo dibujar las fichas, porque no
se deduce del contenido: `carteles` (2:3, películas y series), `canales` (16:9,
el logotipo manda), `episodios` (fila con fotograma y sinopsis) y `lista`.

### La parrilla del directo

TV en directo tiene tres columnas: categorías, canales en lista y, a la
derecha, el canal enfocado con lo que está echando y lo que viene detrás.

La mitad derecha de la pantalla es esa columna, y ahí se ve **el canal
reproduciéndose en pequeño**, con su programación debajo. Pulsar sobre el vídeo
—o aceptar otra vez sobre el canal que ya se está viendo— lo abre entero, y
"atrás" devuelve a la vista previa.

Con `max_connections` a 1, la vista previa ocupa la única ranura: por eso solo
arranca cuando el foco lleva **un segundo quieto**, y no mientras se zapea, y
se para al salir del directo.

**El vídeo no es hijo de esta columna.** La columna deja el hueco, lo mide y el
reproductor —que vive en la capa de arriba— se coloca encima. Si colgara de
aquí, al pasar a pantalla completa cambiaría de sitio en el árbol, React lo
volvería a montar y ExoPlayer soltaría la conexión: **medio minuto de 403**
cada vez que se agranda.

El EPG se pide con `get_short_epg` canal a canal, con un retardo de 350 ms
desde que el foco se para —el foco se mueve más rápido de lo que responde el
panel— y se cachea media hora en memoria. Medido: 3,4 KB por canal frente a
los 186 KB de `get_simple_data_table`, que trae la semana entera.

En el reproductor de directo eso reemplaza a la línea de tiempo: donde iría
"0:00 / 0:00" van la hora de inicio, el título del programa y la hora de fin,
con la barra marcando por dónde va.

### Los favoritos son un grupo más

Cada perfil tiene los suyos y salen en la barra de las tres secciones, entre
"todas" y las categorías del proveedor. Se marcan **manteniendo pulsado** sobre
la ficha —el toque normal ya reproduce o entra— y el corazón se queda puesto.

Lo que se marca es la película, el canal o **la serie entera**: un episodio
suelto no, porque lo que uno guarda es la serie.

`PuertoFavoritos` va aparte de `Biblioteca` a propósito: el catálogo es el mismo
para toda la casa y esto es de cada uno. Sin ese puerto la interfaz funciona
igual, solo que sin corazones ni grupo.

### La interfaz, partida en dos: puerto y vista

`packages/ui` define **qué** hace la interfaz y cada plataforma pone el **cómo**:

- `puerto.ts` declara `Biblioteca`, que es lo único que la interfaz necesita
  saber de los datos. Todo devuelve promesas aunque `node:sqlite` sea síncrono:
  en cuanto los datos cruzan un IPC o un puente nativo dejan de serlo, y una
  interfaz escrita contra un puerto síncrono habría que reescribirla entera.
- `presentador.ts` junta navegación, foco y datos, y produce el estado de la
  pantalla actual. Ahí vive la paginación (60 fichas, se amplía al acercarse el
  foco al final) y la decisión de si una ficha se reproduce o abre pantalla.
- `packages/storage/src/adaptador.ts` implementa el puerto sobre SQLite. En
  Android TV habrá otro adaptador sobre otro SQLite, y esa es toda la diferencia.
- `cuentas.ts` guarda las listas dadas de alta y cuál tiene sesión abierta. La
  app arranca ahí, no en la biblioteca: se elige lista y se conecta, y los
  arranques siguientes entran directos hasta que se cierre sesión. Las URLs
  llevan credenciales, así que el almacenamiento es otro puerto: llavero de
  Android en `apps/tv/src/almacen.ts`, y `safeStorage` cuando le toque al
  escritorio.

La vista —HTML en `apps/desktop`, React Native en `apps/tv`— solo dibuja el
estado y manda cuatro señales: arriba, abajo, aceptar y atrás.

### De dónde salen los datos en cada plataforma

En el escritorio se descarga el M3U entero y se importa a SQLite: 218.662
entradas, ~6 s. **En Android eso no vale.** Los 71 MB de texto, como cadena de
JavaScript, ocupan el doble, y la tablet se cerró con `OutOfMemoryError` antes
de parsear nada. Así que ahí:

- El catálogo se trae de `player_api.php`, **categoría a categoría**, con
  `construirCatalogo`. Salen las mismas cifras que por el M3U (482 canales,
  17.965 películas, 6.540 series) sin ningún pico de memoria.
- **Los episodios no se importan.** `get_series_info` es una petición por serie
  y hay 6.598: se piden al abrir cada serie y se guardan desde entonces. De esa
  misma respuesta sale la ficha del episodio —fotograma, sinopsis, nota, año y
  duración—, así que se guarda entera: volver a pedirla costaría otra petición.
- **Lo que trae de verdad cada episodio**, medido sobre NETFLIX y HBO: imagen el
  85-100 %, sinopsis algo más de la mitad, nota dos de cada tres, fecha todos y
  duración casi todos. La vista omite lo que falte.
- **El título del episodio hay que limpiarlo.** El panel manda tres formas:
  `Outer Banks 1080P S01E01` (sin título), `Euphoria 1080p - S01E01 - Piloto` y
  `True Detective - S01E01 - La larga y clara oscuridad`. Sin limpiarlo, la
  columna de episodios repite el nombre de la serie treinta veces. De eso se
  encarga `tituloDeEpisodio`, y cuando no queda título se numera.
- **La fecha de alta viene en dos campos distintos.** Las películas y los
  canales traen `added`; las series no, traen `last_modified`, que sube cuando
  les añaden episodios —para "lo último que ha entrado" viene incluso mejor—.
  Es lo que ordena por novedades.
- Lo importado se guarda en SQLite con el mismo esquema que el escritorio
  (`@m3u/storage/schema`), y vale **tres días**: mientras tanto el arranque es
  inmediato. Hay botón para forzar el refresco.

La importación completa tarda ~50 s contra el panel, casi todo en las 66
peticiones, que van en fila. Paralelizarlas es la optimización pendiente.

### La portada del inicio: apaisada o no sale

La carátula del proveedor es un cartel 2:3 y la portada es un rectángulo
ancho. Recortando el cartel sale la cara del actor a pantalla completa y
borrosa, y estirarlo es peor. La imagen que vale es `backdrop_path`, que viene
en la ficha larga —`get_vod_info` en las películas, `get_series_info` en las
series—, así que la regla es **sin imagen apaisada no hay sugerencia**: se
pregunta por ocho candidatas y se cogen las cuatro primeras que la traigan. Si
no la trae ninguna, el inicio arranca por "Seguir viendo".

La ficha de una serie se pide **aparte de sus temporadas** aunque salgan de la
misma respuesta: la portada quiere la ficha de cuatro series y no sus
episodios, que es la parte gorda. Se guarda en las mismas cinco columnas que
las películas (`plot`, `actors`, `backdrop`, `genre`, `detalle_pedido`).

**Eso lo prepara el servidor**, una vez al día y por lista, no por aparato: es
una petición por candidata y bastantes no sirven, así que multiplicado por los
tres aparatos de la casa y por cada arranque salían muchas peticiones
repetidas contra el panel para el mismo resultado. El VPS ya guarda las URLs de
las listas, así que no expone ningún secreto nuevo.

Y hace algo que un televisor no puede: **mide la imagen** antes de proponerla,
leyendo las medidas de la cabecera del fichero con una petición `Range`
(`apps/sync/src/imagen.ts`, sin dependencias: son JPEG, PNG, GIF y WebP). Hay
paneles que meten el cartel vertical en el campo del fondo.

Los identificadores se calculan con el mismo `slug(título-año)` de
`@m3u/core`, y por eso valen para reproducir en el aparato. Aun así, el
presentador comprueba que cada sugerencia exista en la base local antes de
enseñarla: el catálogo del aparato puede ser de hace tres días.

En la carátula enfocada van el título, el género, el año y la nota, **dentro de
la imagen** y sobre un degradado oscuro: en blanco sobre el cartel a pelo, la
mitad de las veces el texto cae encima de una cara clara. Debajo no, porque
entonces la fila tiene que reservar un hueco que está vacío en todas las fichas
menos una.

**Con el dedo no hay foco**, así que la ficha de la carátula —que en el
televisor solo se enseña en la enfocada— se enseña siempre en tablet y
teléfono: si no, ahí no se vería nunca ni el título ni la nota. Lo que cambia
no es el aparato sino la forma de señalar, y es la única diferencia que se
permite entre plataformas: **una sola interfaz**, con lo que dependa de tener
foco resuelto en el sitio donde se pinta. `DESPLAZA_EL_DEDO` (`!Platform.isTV`)
es la que lo decide, la misma que ya desactivaba el desplazamiento del sistema.

La portada solo responde al dedo **en el botón de reproducir**. Con la portada
entera pulsable, en la tablet arrancaba la película al tocar la imagen sin
querer.

**El género de una serie viene con el catálogo** (`get_series` lo trae) y se
guarda al importar. El de una película no: `get_vod_streams` da título, cartel,
nota y año, y el género está en la ficha larga, una petición por título. Por eso
lo averigua el servidor en la misma pasada diaria, para las cuarenta más
recientes y las cuarenta mejor valoradas —que es justo lo que llena los
carruseles del inicio—, y el aparato lo anota en su base con `guardarGeneros`.
Lo que no coincida sale sin género y ya está.

**El servidor manda datos, nunca interfaz, y nunca es imprescindible.** Si no
contesta, si aún no ha preparado esa lista o si la casa no tiene servidor, el
aparato saca sus portadas preguntando al panel como siempre. `GET
/api/portadas` devuelve `[]` y no pasa nada.

### Compartir el historial entre aparatos: nada se borra de verdad

Dejar una película a medias en la tele y seguirla en la tablet exige compartir
las cuatro tablas de perfil (`profile`, `progress`, `favorite`,
`profile_setting`). Sale casi gratis porque **los identificadores salen del
contenido**: `lola-pater-2017` es la misma película en los dos aparatos, así
que sincronizar es mandar filas y no traducir nada.

Las reglas, que hay que respetar al tocar cualquier escritura de perfil:

- **Gana el cambio más reciente**, fila a fila. No se fusionan contenidos: el
  minuto por el que ibas es el último que se anotó, no la media de dos. La
  regla vive en `fusionar` (`packages/ui/src/sincronizacion.ts`) porque el
  servidor tiene que aplicar **exactamente la misma**; si decidiera distinto,
  cada aparato acabaría con una versión creyendo que están de acuerdo.
- **Ningún `DELETE`.** Una baja marca `deleted = 1` y deja la fila de lápida.
  Borrarla no deja nada que contar, y el otro aparato la volvería a subir:
  quitas algo de favoritos y al día siguiente ha vuelto.
- **Toda escritura sella `updated` y `origin`.** La fecha decide quién gana y
  el aparato desempata los empates al milisegundo, que es lo que garantiza que
  los dos lleguen a la misma conclusión decidiendo por separado.
- Las lecturas filtran `deleted = 0`. Es fácil olvidarlo al añadir una
  consulta y el síntoma es contenido fantasma.
- No hay registro de cambios aparte: las propias tablas lo son, y se pide "lo
  posterior a esta fecha". El SQL genérico está en
  `packages/storage/src/sincronizar.ts`, contra `SINCRONIZADAS` del esquema:
  añadir una tabla al reparto es una línea allí.

**Hay dos marcas de agua, y no son intercambiables.** La de subida va en la
fecha del cambio (`updated`, el reloj del aparato) y la de bajada en el sello
de recepción del servidor (`recibido`, el reloj del VPS). Confundirlas se traga
cambios enteros: si la tele anota algo el martes y no se conecta hasta el
lunes, la tablet —cuya marca ya va por el domingo— nunca vería ese cambio si
las novedades se pidieran por su fecha. `recibido` es la única columna que el
servidor tiene de más, y la pone `sellarRecepcion` sobre lo que de verdad se
escribió.

El emparejamiento es por código corto: el aparato enseña `K7M2-P4XR` y tú lo
apruebas en la web. **El código no vale para llevarse el token**; para eso hay
un secreto largo que el aparato guarda y nunca muestra. Si fuera el mismo, quien
adivinara el código de la pantalla entraría en el grupo. El token se entrega una
sola vez y de él solo queda la huella.

Lo que esta regla **no** arregla es un reloj mal puesto: un aparato adelantado
gana siempre. Es la contrapartida de fechar en el origen, y el servidor
debería desconfiar de lo que llegue muy por delante de su hora.

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

- **`max_connections` no es siempre 1.** La primera cuenta da 1 y una segunda
  del mismo proveedor da 3, así que el árbitro tiene que leerlo del handshake y
  adaptarse, no dar por hecho que solo hay una ranura.
- **Con una sola ranura**, reproducir y descargar se excluyen mutuamente. Hace
  falta un árbitro que la posea: la reproducción siempre gana y la descarga se
  pausa (los ficheros aceptan `Range`, así que reanuda donde iba). Con varias,
  el mismo árbitro reparte en vez de excluir.
- Cuando la ranura está ocupada, el servidor devuelve **`HTTP 403` con el cuerpo
  `{"message": "Max Connections Reached"}`**. Hay que reconocer ese error
  concreto y esperar, no darlo como fallo de reproducción.
- **`active_cons` del handshake no sirve de semáforo.** Medido: marcaba 0 con
  una película sonando, y oscilaba entre 0 y 1 durante un minuto con la app
  cerrada y ningún proceso vivo. El árbitro tiene que fiarse de su propio
  estado y del 403, no de ese contador.
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

Dentro de la ventana conviven la ventana hija de mpv (clase `mpv`) y la
superficie de Chromium (clase `Intermediate D3D Window`). **Medido en sesión de
consola con Electron 43.4.1 y mpv 0.41, Chromium queda por encima**, así que la
interfaz se dibuja sobre el vídeo y basta **una sola ventana**.

Lo único imprescindible es que esa ventana **no pinte fondo opaco**: se crea con
`transparent: true` y alfa cero, y el HTML lleva `background: transparent`. Un
fondo opaco tapa el vídeo entero y deja la pantalla en negro aunque mpv esté
reproduciendo — que es exactamente lo que hacía el diseño anterior de dos
ventanas, pensado para el orden Z contrario.

Al comprobarlo, no fiarse de una captura de pantalla a secas: el vídeo acelerado
puede salir negro en la captura y verse bien en el monitor. Contrastar siempre
preguntando a mpv por su socket (`vo-configured`, `time-pos`, `width`) y
enumerando las ventanas hijas en orden Z.

`transparent: true` tiene un precio en Windows: Electron marca la ventana como
no redimensionable y le quita `WS_THICKFRAME`, así que **no se puede arrastrar
el borde**. `setResizable(true)` no lo revierte y `setSize` se ignora, pero
`setBounds`, `maximize` y la pantalla completa sí funcionan.

Confirmado con vídeo real del panel: un MKV con H.264 y AC-3 5.1 decodificando
por `d3d11va` se ve correctamente **debajo** de la interfaz. El plano de
superposición de hardware, que era el riesgo, no aparece. `.\app.cmd --sw`
sigue disponible para forzar salida por software si algún equipo da problemas.

## Trampas conocidas

- **El EPG del panel viene en UTC y en base64.** Los títulos y las sinopsis van
  codificados, y los tiempos —incluidas las cadenas `start` y `end`, que
  parecen hora local— están en UTC. Comprobado: el programa que el panel da
  como `08:35` y marca `now_playing` se estaba emitiendo a las 10:35 en España.
  Se usan `start_timestamp` y `stop_timestamp`, y la hora la compone `Date` con
  el huso del aparato.
- **`now_playing` no sirve para saber qué se está emitiendo.** Lo calcula el
  servidor al responder, así que envejece en cuanto la pantalla lleva un rato
  abierta. El programa en curso se decide comparando con la hora del aparato.
- **Hermes no trae `TextDecoder`.** Descodificar base64 con `atob` +
  `TextDecoder` funciona en Node y falla en la tablet, y encima en silencio: la
  parrilla salía escrita en base64 mientras los tests pasaban en el portátil.
  Por eso `packages/core/src/epg.ts` lleva su propio descodificador, que además
  distingue lo que viene codificado de lo que no —"Telediario 1" es base64
  sintácticamente válido y se convertía en tres caracteres ilegibles—.
- **Gradle no vigila `packages/` al hacer el bundle.** El plugin de React
  Native solo mira lo que hay bajo `root`, que es `apps/tv`, así que al cambiar
  `packages/core` o `packages/ui` la tarea `createBundleReleaseJsAndAssets` se
  queda `UP-TO-DATE` y **el APK sale con el JavaScript de la vez anterior**. Se
  arregla declarando esas fuentes como entradas de la tarea, al final de
  `android/app/build.gradle`. Mover `root` a la raíz del monorepo no vale: el
  CLI deja de encontrar el proyecto y falla con "unknown command 'bundle'".
- **`onLayout` no avisa de que algo se ha movido, solo de que ha cambiado de
  tamaño.** El hueco del vídeo se medía al montarse y se quedaba con esa
  posición; cuando los márgenes de la pantalla bajaban el contenido, el vídeo
  se quedaba unos píxeles alto, montado sobre los botones de la cabecera. Se
  remide después de cada pintado y **con `measureLayout` contra el contenedor
  donde flota**, no con `measureInWindow`: las coordenadas absolutas no cuadran
  con el origen de ese contenedor.
- **El rótulo "LIVE" no es nuestro.** Lo pinta `react-native-video` en su
  `ExoPlayerView.kt` cuando ExoPlayer ve que el flujo es en directo, y no hay
  propiedad para quitarlo: haría falta parchear la librería.
- **`npm run typecheck` no mira `apps/`.** El `tsconfig.json` de la raíz solo
  incluye `packages/*` y `tools/*`, así que los fallos de `App.tsx` y compañía
  no salen hasta que Metro monta el bundle. Para comprobar la app de Android:
  `cd apps/tv` y `npx.cmd tsc --noEmit -p tsconfig.json`,
  aunque hoy saca ruido de los tipos de React Native contra `packages/core`.
- **En release, `console.log` sí llega a logcat.** Se puede depurar en la tele
  con `adb logcat -s ReactNativeJS:V`, y los fallos de JavaScript salen
  enteros en `adb logcat -b crash`.
- **React Native 0.80+ trae degradados de verdad**, con
  `experimental_backgroundImage` y sintaxis CSS. No hace falta
  `react-native-linear-gradient` ni ningún otro módulo nativo. Simular un
  degradado con bandas de color no vale: dos rectángulos con opacidades
  distintas siempre dejan costura, y se ven como franjas.
- **Los emojis del reproductor los pinta Android con su paleta.** ⏪ y ⏩ salían
  con el fondo naranja del emoji del sistema, imposible de quitar por estilo.
  Los iconos se dibujan con vistas en `apps/tv/src/iconos.tsx`: un triángulo es
  una caja de tamaño cero con un solo borde relleno.

- **Los colores viven en `apps/tv/src/tema.ts`.** React Native no tiene hojas
  de estilo —ni cascada, ni selectores, ni herencia—, así que lo único que se
  puede compartir entre pantallas son los valores. Antes el verde estaba
  copiado a mano en cinco ficheros y el fondo, escrito dentro de cada
  degradado. Los degradados se montan con plantilla (`FONDO_RGB`) porque
  `experimental_backgroundImage` es texto CSS y ahí hacen falta las
  componentes sueltas.
- **Regex construidas con plantillas**: dentro de `` ` ` ``, `\b` es un carácter
  de retroceso y `\s` se queda en `s`. Usa `String.raw`. Costó dos bugs
  silenciosos en `normalize.ts`.
- **El SQLite de Android no trae FTS5 de serie.** `op-sqlite` compila SQLite a
  medida y lo deja fuera: la tabla virtual falla con `no such module: fts5`. Se
  activa con `"op-sqlite": { "fts5": true }` en el `package.json` de la app y
  recompilando. Por eso el esquema separa `SCHEMA_FTS_SQL` del resto: sin FTS5
  la biblioteca abre igual y busca con `LIKE`.
- **`localeCompare` con miles de elementos bloquea el hilo.** Ordenar 18.000
  títulos así se comió tres minutos al 180 % de CPU en la tablet, y dejó la
  pantalla congelada porque la interfaz comparte hilo. Se ordena con
  `ordenarPor`, que prepara la clave una vez por elemento. Es el mismo motivo
  por el que el esquema de SQLite lleva columnas `sort_*`.
- **Las barras del sistema no se van solas.** La de estado y la de navegación
  se quitan en `MainActivity.onCreate` con `WindowInsetsControllerCompat`, y
  **hay que volver a esconderlas en `onWindowFocusChanged`**: el sistema las
  saca al deslizar desde el borde o al volver de otra aplicación, y sin eso se
  quedan puestas para siempre. Se deja `BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE`
  a propósito: sin él no habría forma de salir de la aplicación en una tablet
  sin botones físicos.
- **Hooks detrás de un `return` temprano cierran la aplicación.** Es el fallo
  que más veces ha caído aquí: cuatro, en `PantallaPerfiles`, `PantallaListas`
  y dos en `BibliotecaVista`. React exige el mismo número de hooks en cada
  pintado, y `if (!estado) return <Espera/>` se los salta en el primero. El
  síntoma es `Rendered more hooks than during the previous render` y la app
  cerrándose al entrar. **Todo `useState`, `useEffect`, `useCallback` y
  `useRef` va arriba del componente**, aunque solo lo use algo que está 400
  líneas más abajo.
- **`adb push` puede fallar en silencio y `pm install` decir "Success".**
  Instala el fichero que ya estuviera en `/data/local/tmp`, o sea el APK
  anterior, y te pasas media hora buscando en el código un fallo que no
  existe. Hay que **comparar el tamaño enviado con el local** antes de
  instalar: `adb shell wc -c < /data/local/tmp/app-release.apk`.
- **Instalar no reinicia la app.** Si estaba abierta, sigue corriendo el
  JavaScript viejo. `adb shell am force-stop com.m3utv` después de instalar.
- **En Git Bash, las rutas del aparato se convierten a rutas de Windows.**
  `adb push algo /data/local/tmp/` acaba enviando a `C:/Program Files/Git/data/...`.
  Hace falta `MSYS_NO_PATHCONV=1` delante, o usar PowerShell.
- **Ver la pantalla del aparato ahorra iteraciones**: `adb shell screencap -p
  /sdcard/x.png` y `adb pull`. Ojo con redirigir la salida de `exec-out` en
  PowerShell, que le mete BOM y corrompe el PNG.
- **MIUI bloquea `adb install`** con `INSTALL_FAILED_USER_RESTRICTED` aunque la
  depuración USB esté activa: hace falta además "Instalar vía USB" en las
  opciones de desarrollador, y Xiaomi lo vuelve a desactivar por su cuenta. El
  rodeo que sí funciona siempre es instalar desde el propio aparato:
  `adb push app.apk /data/local/tmp/` y luego `adb shell pm install -r -t
  /data/local/tmp/app.apk`.
- **El release de Android bloquea el tráfico sin cifrar.** El plugin de React
  Native pone `usesCleartextTraffic=false` en release, y los paneles Xtream
  sirven por HTTP: sin tocarlo, el APK bueno no descarga la lista ni reproduce,
  aunque en depuración vaya bien. Se resuelve con
  `res/xml/network_security_config.xml`, que además manda sobre el atributo del
  manifiesto en Android 7 y posteriores.
- **`hermesc` ya no está dentro de `react-native`.** Vive en el paquete
  `hermes-compiler`, pero el plugin de Gradle lo sigue buscando en
  `react-native/sdks/hermesc`, así que `assembleRelease` falla con "Couldn't
  determine Hermesc location". Se arregla con `hermesCommand` en el bloque
  `react {}` de `android/app/build.gradle`. Solo afecta a release: la
  compilación de depuración no pasa por Hermes.
- **En `local.properties`, la ruta del SDK con barras normales.** Un
  `.properties` de Java trata la barra invertida como escape, así que
  `sdk.dir=C:\Users\...` llega corrupto y Gradle falla con "el nombre de
  archivo, el nombre de directorio o la sintaxis de la etiqueta del volumen no
  son correctos", desde `SdkLocator.validateSdkPath`. Se escribe
  `sdk.dir=C:/Users/...`.
- **Gradle no encuentra React Native en el monorepo.** npm iza los
  `node_modules` de los workspaces a la raíz, pero la plantilla de React Native
  los busca dentro de `apps/tv`. Hay que reapuntar `includeBuild` en
  `android/settings.gradle` y `reactNativeDir`, `codegenDir` y `cliFile` en
  `android/app/build.gradle`. Si aparece "Included build ... does not exist",
  es esto. Metro necesita lo mismo por su lado: `watchFolders` con la raíz y
  `nodeModulesPaths`, en `apps/tv/metro.config.js`.
- **`assert.equal` de `node:assert/strict` estrecha tipos.** Está declarado como
  `asserts actual is T`, así que comprobar dos veces la misma expresión —por
  ejemplo `presentador.pantalla.tipo`, primero `'series'` y luego `'serie'`— la
  deja en `never` y `npm run typecheck` falla aunque los tests pasen. Se
  esquiva comparando el resultado de una llamada a función, que no deja
  referencia que estrechar.
- **`node:sqlite` devuelve objetos sin prototipo.** El almacén los convierte a
  objetos normales antes de devolverlos; mantén esa costumbre o `deepEqual`
  fallará en los tests.
- **`cast` es palabra reservada de SQL.** SQLite deja crear la columna con
  `ALTER TABLE`, pero `SELECT plot, cast, backdrop` no se puede parsear y la
  consulta revienta. Costó un buen rato porque el error se lo tragaba un
  `try/catch` de más arriba y la portada salía sin sinopsis, sin decir nada.
  La columna se llama `actors`. Al añadir cualquier columna, comprobar que el
  nombre no es una palabra reservada.
- **La ficha larga de una película** —sinopsis, reparto e imagen apaisada—
  **no viene con el catálogo**: `get_vod_streams` da título, cartel, nota y
  año. Lo demás está en `get_vod_info`, que es una petición por película:
  inviable para 18.000, pero se pide para la que preside el inicio y se
  guarda. Medido contra el panel real: sinopsis, reparto y fondo, los tres.
  El identificador de panel de una película **no se guarda al importar**; sale
  del último tramo de la URL de su variante (`/movie/usuario/clave/12345.mkv`).
- **La media estrella (U+2BE8) no está en la fuente de un televisor** y sale
  como un cuadrado. Se dibuja: una estrella llena recortada al 50 % sobre una
  hueca. Es el mismo motivo por el que los iconos del reproductor son vistas.
- **FTS5 se rompe con la puntuación del usuario.** `toMatchQuery` entrecomilla
  palabra a palabra; no pases texto crudo a `MATCH`.
- **`.probe-cache/` contiene la lista real con las credenciales del panel en
  cada URL**, y `.probe-cache/test-url.txt` también. Está en `.gitignore`. Al
  imprimir cualquier URL, redáctala como hacen `probe` y `main.mjs`.
- **La dirección del servidor de sincronización no va en el repositorio**, que
  es público. Metro resuelve el módulo inventado `servidor-sync` a
  `apps/tv/servidor.local.js` si existe y a `servidor.ejemplo.js` si no, con un
  `resolveRequest` en `metro.config.js`. Al clonar en un equipo nuevo hay que
  crear el local (`cp apps/tv/servidor.ejemplo.js apps/tv/servidor.local.js`) o
  la app pedirá la dirección a mano al emparejar.
- **La MAC no sirve para identificar un aparato en Android.**
  `getMacAddress()` devuelve `02:00:00:00:00:00` desde Android 6, leerla de
  `/sys/class/net/` está cerrado desde Android 10, y encima el sistema la
  aleatoriza por red. El identificador se lo inventa el propio aparato
  (`idDeAparato`, en la tabla `meta`) y sobrevive a reinicios y
  actualizaciones, no a borrar los datos.

## Estado y siguiente paso

El README lleva la tabla de estado y las cifras medidas contra la lista real
(218.662 entradas, ~6 s de importación completa, consultas de 0-1 ms).

Pendiente: el árbitro de conexión, la interfaz y la descarga a disco. Del
reproductor solo queda decidir qué hacer con el redimensionado de la ventana
transparente.

Compartir el historial entre aparatos está terminado de punta a punta: el
modelo, el servidor (`apps/sync`, ver su README), el cliente (`ClienteSync`) y
la pantalla de emparejamiento. Falta **probarlo contra el VPS de verdad** y
decidir cada cuánto conviene sincronizar —ahora son dos minutos mientras la
biblioteca está abierta, más una vez al conectar—.
