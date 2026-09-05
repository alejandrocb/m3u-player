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
node tools/probe/src/intro.ts "<url>" [serie]   # ¿traen capítulos los ficheros?
npm run bench -- .probe-cache/<lista>.m3u # medir el almacenamiento
.\app.cmd                                 # abrir la app de escritorio
.\app.cmd --sw                            # ídem, con salida de vídeo por software
```

**En PowerShell, `npm` y `npx` fallan** con `UnauthorizedAccess`: la política de
ejecución de scripts del equipo bloquea `npm.ps1`. Usa `npm.cmd` / `npx.cmd`, o
los lanzadores directos (`.\app.cmd`, `.\node_modules\.bin\electron.cmd`).

**Y `npm.cmd` parte por el `&` cualquier URL que le pases**, entrecomillada o
no: es un fichero por lotes, así que el argumento acaba pasando por `cmd.exe`,
que vuelve a interpretar el `&` como separador de comandos. Al `probe` le
llegaba `get.php?username=U` a secas y el panel contestaba `403`. Para pasarle
una URL, llama a Node directamente y sáltate el intermediario:

```bash
node tools/probe/src/index.ts 'http://servidor:8080/get.php?username=U&password=P&type=m3u_plus'
```

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

### El inicio es la pantalla, y las pestañas lo filtran

Arriba hay cinco: **Todo, Películas, Series, TV en directo y Mi Lista**. Las
cinco pintan lo mismo —filas de fichas— y solo cambian qué filas. **Pulsar la
pestaña solo filtra**: no hay ninguna otra pantalla detrás a la que entrar.

Las filas de cada pestaña:

- **Películas y series**: novedades, recomendadas y luego **una fila por
  categoría del proveedor** —acción, comedia, terror—, ocho como mucho.
- **TV en directo**: una fila por grupo de canales y **todos los canales**. Un
  grupo de canales es una lista corta y cerrada, así que aquí no se recorta:
  esconder uno sería esconder un canal.
- **Mi Lista**: lo marcado, por clases, con su propio selector de tipo.

**El selector de Mi Lista va dentro de la lista, como una fila más**, y no en
otra barra. Así se recorre con el mando igual que las carátulas —arriba,
abajo, izquierda, derecha— sin inventar otro sitio donde pueda estar el foco.
Por eso existe la acción `filtrar` junto a `reproducir` y `entrar`.

**El orden de las filas por categoría lo decide el perfil.** Cada
reproducción suma uno a las categorías de lo que se pone, en la tabla
`affinity`, que se sincroniza como el resto: lo que ves en la tele ordena
también el inicio de la tablet. Sin datos todavía, mandan las categorías con
más contenido. Se cuentan reproducciones y no fichas abiertas: mirar no es
ver.

**Las filas van por tema, y las categorías del proveedor son el respaldo.** Un
tema es de qué va la ficha —drama, comedia, documental— y es lo que uno busca.
La categoría es dónde la ha colocado el proveedor en su lista: dice casi lo
mismo, a gritos —"PELICULAS ACCION"—, pero no siempre, que también hay
categorías que son un canal, un año o una promoción. Por eso el rótulo de esas
se limpia con `nombreDeCategoria` y el del tema se pinta tal cual.

El problema es de dónde sale el tema. **De las series viene con el catálogo**
(`get_series` trae el género), así que ahí los temas mandan desde el primer
arranque. **De las películas no**: `get_vod_streams` da título, cartel, nota y
año, y el género está en `get_vod_info`, que es **una petición por título** y
hay 18.042. Así que lo va rellenando el servidor de la casa, empezando por lo
último que ha entrado, que es lo que llena los carruseles.

**Y pregunta a dos sitios, en este orden.** Primero a **TMDb**: no limita
conexiones y devuelve una **lista cerrada de géneros en español**, que es lo
que hace que las filas salgan limpias —del panel viene texto libre, y por eso
existe `contarTemas`—. Lo que no reconozca, **al panel**, que de su propio
catálogo sabe más que nadie: acierta el 97 % de lo que se le pregunta.

El ritmo sale de eso: con TMDb, dos mil por pasada y una por hora, y el
catálogo entero cubierto en una tarde; sin token, quinientas al día y de
madrugada, algo más de un mes. El token se lee de `TMDB_TOKEN` y **no está en
el repositorio, que es público**: vive en un fichero del VPS. Sin él todo sigue
funcionando, solo que más despacio.

**Y de paso viene la ficha entera**, no solo el género: sinopsis, reparto,
imagen apaisada y tráiler, para las 18.000 películas y las 6.500 series. Son
dos peticiones por título —la búsqueda ya trae género, sinopsis y fondo; la
ficha añade reparto y tráiler— y se piden juntas, porque quien abre una
película quiere las dos cosas y volver mañana a por la mitad costaría otra
búsqueda. El aparato lo guarda en las mismas columnas que llenaría el panel
(`plot`, `actors`, `backdrop`, `genre`, `trailer`) y **solo donde falte**: lo
que se preguntó al panel por su cuenta es más de fiar.

**De las series no se le pregunta al panel.** Su ficha está en
`get_series_info`, que devuelve además la lista entera de episodios: pedirla
6.500 veces por una sinopsis sería bajarse el catálogo de capítulos completo
para tirarlo. Su género, además, ya viene con el catálogo.

**Y de la misma búsqueda sale la nota de TMDb**, con cuántos la han votado y
su popularidad (`nota_tmdb`, `votos_tmdb`, `popularidad`). No cuestan ni una
petición de más y arreglan lo que la del proveedor no puede: esa está inflada
—cientos de dieces que solo quieren decir que no la ha votado nadie—, y por eso
hoy solo sirve para descartar. Con los votos delante sí se distingue un 8 de
mil personas de un 10 de dos. Una nota con cero votos **no se guarda**: no es
un cero, es que no hay nota.

Al guardar una ficha del servidor **solo se marca `detalle_pedido` si trae
sinopsis**. Esa marca quiere decir "ya se preguntó" y evita que la pantalla de
información vuelva al panel en cada arranque; ponerla con un género suelto
dejaría la ficha vacía para siempre.

Casar nuestra película con la de TMDb se hace por **título y año**, y ahí el
sesgo es **el contrario** del que lleva el clasificador: ante la duda, **sin
género**. Una película sin género sale igual en su fila; una con el género de
otra ensucia una fila entera del inicio y nadie sabe por qué. Por eso solo se
acepta un resultado si el título cuadra —comparado con `fold`— o si, buscando
con año, ha quedado un único candidato.

Mientras tanto el inicio no se queda a medias: si no hay al menos cuatro temas
que den para una fila entera (`TEMAS_SUFICIENTES`), se usan las categorías del
proveedor, que están todas desde el primer minuto. El cambio de unas a otros no
tiene fecha ni interruptor: ocurre solo, en cuanto hay géneros bastantes.

Tres detalles que no son opcionales:

- **Lo que el panel deja en blanco también se apunta**, con el género vacío. Si
  no, cada pasada volvería sobre las mismas cuatrocientas que el panel no sabe
  contestar y el recorrido no avanzaría nunca.
- **Las calidades se juntan antes de repartir el presupuesto**, no después. La
  misma película viene dos o tres veces con el mismo identificador: contando
  entradas en vez de películas, la pasada de quinientas se quedaba en la mitad.
- **La marca de agua es la hora de la pasada**, no un contador. Así vale para
  las dos listas de una casa —el reloj del servidor es el mismo para todas— y
  de ahí sale también cuándo fue la última pasada, sin una tabla aparte. El
  aparato la guarda en `meta` y pide `GET /api/generos?desde=…`; al reimportar
  el catálogo la pone a cero, porque lo recién traído no lleva ningún género.

**Y nada se repite entre filas.** Una película es "Drama, Romance" y sale de
las dos consultas; el orden recomendado, además, empieza por lo más reciente,
así que "Recomendadas" se solapaba casi entera con "Novedades". El inicio
acababa con la misma carátula tres veces y el catálogo parecía la mitad de
grande. Manda la fila de más arriba —la que uno ve antes— y cada fila pide
`CARRUSEL * DE_SOBRA` para poder tirar las repetidas sin quedarse a medias.

Un tema cuenta para la afinidad igual que una categoría: `gruposDe` devuelve
las dos cosas de cada ficha, y como los nombres no se pisan —"PELICULAS ACCION"
y "Acción"— caben en la misma tabla. El género del panel viene con varios
dentro de un solo campo y separados como le parece —"Drama, Romance",
"Acción / Aventura"—, así que `temasDe` lo parte y `contarTemas` junta las
escrituras que dicen lo mismo, quedándose con la más frecuente: sin eso,
"Ciencia ficción" y "CIENCIA FICCION" salían como dos filas medio vacías.

### Cuatro pantallas, y a la cuarta se llega manteniendo pulsado

El **inicio** —que se filtra con las pestañas y no se apila—, **una serie**, el
**buscador** y la **información** de una película o una serie.

A la información no se llega pulsando: **el toque normal reproduce**, que es lo
que uno quiere casi siempre. Mantener pulsado abre un menú con las tres cosas
que se pueden hacer con una ficha —Información, Mi Lista y Descargar—, y es el
mismo gesto con el dedo y con el OK del mando. Antes ese gesto marcaba en Mi
Lista directamente; cabía una sola acción y ahora hacen falta tres.

La pantalla de información enseña lo que no cabe en una carátula: el fondo
apaisado degradado hacia el negro, el cartel, la sinopsis, el reparto y los
botones. **Los botones son `elementos`**, como las carátulas de una fila: así
el mando los recorre con el mismo código y no hay otro sitio donde pueda estar
el foco. Lo que se pinta va aparte, en `EstadoPantalla.ficha`, por lo mismo que
`inicio`: no es una rejilla.

Un canal no tiene información que enseñar —ni sinopsis, ni reparto, ni
tráiler—, así que su menú solo trae Mi Lista. Y una serie no se descarga: se
descargan sus episodios.

**El tráiler lo pone YouTube.** Viene en la ficha larga (`youtube_trailer`), a
veces como identificador pelado y a veces como URL entera, y se abre fuera con
`Linking`: montar un reproductor de otra plataforma dentro es mucho trabajo
para minuto y medio, y además así no gasta una conexión del panel.

Hubo una cuarta forma: la rejilla completa de películas, series y directo, con
su barra de categorías a la izquierda. Se llegaba a ella pulsando dos veces la
pestaña que ya estaba puesta, y era **el mismo contenido con otra cara**: uno
entraba sin querer, veía otra cosa, y al darle a "atrás" aparecía la buena. Se
quitó entera.

La barra lateral sobrevive en un solo sitio, dentro de una serie, donde los
"grupos" son sus temporadas y a la derecha van los episodios. Elegir temporada
**reemplaza** la pantalla en vez de apilar otra: "atrás" sale de la serie de
una vez, en lugar de ir deshaciendo las temporadas que hayas mirado.

`EstadoPantalla.formato` le dice a la vista cómo dibujar las fichas, porque no
se deduce del contenido: `carteles` (2:3, el buscador), `episodios` (fila con
fotograma y sinopsis) y `lista`. Las filas del inicio no pasan por ahí: cada
una lleva su propio `formato` —cartel o canal—.

### La parrilla del directo: la trae el servidor de una vez

En la ficha de cada canal —la enfocada en el televisor, todas con el dedo— van
la hora de inicio y el título de lo que están echando, con la barra marcando
por dónde va. Y dentro del reproductor, donde iría "0:00 / 0:00", lo mismo con
la hora de fin.

De dónde salen esos datos, por este orden:

1. **La parrilla que prepara el servidor de la casa.** Se trae el EPG completo
   (`xmltv.php`) dos veces al día por lista, lo guarda en la tabla `programa` y
   entrega por `GET /api/epg` **solo el resumen**: dos programas por canal, el
   de ahora y el siguiente. Son decenas de kilobytes en una sola petición.
2. **El panel, canal a canal**, para lo que el servidor no tenga: una casa sin
   servidor, una lista aún sin preparar, o un canal que no salía en el EPG.
   `get_short_epg` con un retardo de 350 ms desde que el foco se para —el foco
   se mueve más rápido de lo que responde el panel— y media hora de caché en
   memoria.

Medido contra la lista real, que es lo que decidió el reparto: `xmltv.php` son
**5,5 MB en 4,9 s, 191 canales y 11.515 programas**; `get_short_epg` son 3,4 KB
pero **una petición por canal**, y `get_simple_data_table` 186 KB por canal.
Para un televisor lo primero es inviable; para el servidor es una descarga que
aprovechan los tres aparatos, igual que las portadas.

Lo que había que comprobar antes de montarlo era **si los identificadores
casan**: los `channel id` del XMLTV son nuestros `tvg-id`, 191 de 191. Sin eso
habría hecho falta emparejar por nombre.

**Y se casa dos veces: primero por identificador y luego por nombre.** El EPG
trae **una sola "Telecinco HD"** y el catálogo trae tres —FHD, HD y SD, cada
una con su `tvg-id`—, así que casando estricto dos de las tres se quedan en
blanco. Por eso hay una segunda vuelta con `claveDeParrilla`, que tira la
calidad y las mayúsculas: `Telecinco FHD`, `Telecinco HD` y `Telecinco SD` caen
en `telecinco`, y también `BE MAD` y `Be Mad`, que el proveedor manda como dos
canales distintos. Es lo que hacen los reproductores comerciales, y es lo que
hace que las tres calidades enseñen lo mismo. Nunca es el primer intento: el
identificador no se equivoca, y esto solo entra donde no hay nada.

**El identificador de un canal no es el que lleva la ficha.** Un `Elemento`
lleva la clase delante —`canal:tvg:24 Horas`— para que dos fichas de la misma
fila no compartan clave, y el canal de verdad sale de su acción
(`canalDeElemento`). Y el de la biblioteca lleva a su vez el prefijo `tvg:`,
que el EPG no usa. Son dos traducciones seguidas, y saltarse cualquiera de las
dos da el mismo síntoma: la parrilla llega entera del servidor, no casa con un
solo canal y la fila sale sin programación **sin un solo error por ninguna
parte**. Pasó con las dos.

Por eso el puerto tiene **dos formas de preguntar**, y no son intercambiables:

- `deCanal(id)` puede acabar en el panel, así que se pide **solo para el canal
  enfocado**.
- `deCanales(ids)` devuelve **únicamente lo ya preparado** y no pregunta nada:
  es lo que permite pintar la fila entera. Si cayera al panel, veinte fichas a
  la vista serían veinte peticiones.

**272 de los 463 canales no traen `tvg-id`** y no tienen programación por
ninguno de los dos caminos: son los de eventos —NBA, NFL, jornadas de liga,
UFC—. La ficha tiene que quedar bien sin ella, y por eso no se reserva hueco
para lo que falte: sin programa no se pinta nada.

Se probó también el EPG público de davidmuma (`guiatv.xml`), por si cubría a
los que no tienen: **31,3 MB, 641 canales y 80.704 programas**, pero sus
identificadores son nombres ("La 1 HD") y no `tvg-id`, así que solo casan 130
de los 191. Casando además por nombre se llega a 190 canales, uno menos que los
que ya cubre el panel, y de los 272 sin `tvg-id` rescataría 27. O sea: cuesta
seis veces más, obliga a emparejar por nombre y aporta veintisiete canales.
Queda como complemento posible —lo haría el servidor, que no gasta conexiones
del panel—, no como sustituto.

La vista previa del canal enfocado, que se fue con la rejilla vieja, sigue
pendiente: depende del árbitro de conexión, porque previsualizar es una
reproducción más.

### Un perfil es una persona: solo suena en un sitio

Si esta persona empieza algo en la tablet, lo que estuviera sonando en la tele
**se para**, y la tele explica por qué: "ha empezado a ver algo en Tablet del
salón". Manda el último que le da a reproducir, que es lo que uno espera.

Va por `profile_setting`, con la clave `reproduciendo`: un ajuste más del
perfil, así que **viaja con la sincronización sin ninguna tubería nueva**. El
que empieza escribe el anuncio con el nombre de su aparato; el que lo recibe,
si está reproduciendo y el anuncio es de otro, corta.

Dos detalles que no son opcionales:

- **Al parar solo se borra el anuncio si sigue siendo el nuestro.** Si lo que
  nos ha parado es que la persona se fue a otro aparato, el anuncio puesto es
  el de ese otro: borrarlo sería lo contrario de lo que se quiere.
- **Mientras algo suena se sincroniza cada doce segundos** en vez de cada dos
  minutos. Es lo que hace que el otro aparato se calle en segundos y no en
  minutos; fuera de la reproducción no hace falta, el "seguir viendo" no tiene
  prisa.

Con `max_connections` a 1 esto además libera la ranura del panel para el
aparato que acaba de empezar. Lo que falta es que ese espere a que se libere
de verdad —el panel tarda ~30 s— en vez de comerse un 403: eso es el árbitro
de conexión, que sigue pendiente.

### El botón de los créditos, y por qué no hay "saltar intro"

Al llegar a los créditos sale **"Siguiente capítulo"**, y para eso no hace falta
ningún dato de nadie: se toma el mismo umbral con el que se da un capítulo por
visto (95 %), así que en uno de cincuenta minutos aparece en los últimos dos y
medio. El error es siempre por defecto —tarde, nunca en mitad de la escena— y
el aviso se queda puesto aunque los controles se escondan, que es justo el
momento en que uno mira la pantalla esperando que pase algo.

**Saltar la intro se probó y se quitó.** Queda escrito porque el trabajo de
medir sí sirve, y para no volver a empezar por el mismo sitio:

- **Los ficheros no lo saben.** Medido con `tools/probe/src/intro.ts` contra la
  lista real: son MKV y traen marcas de capítulo, pero **sin nombre** —lo
  escrito es la propia hora, `00:06:16.251`— y repartidas cada cinco o seis
  minutos, que es un troceado automático del que codificó y no un capitulado
  que sepa dónde está la careta. No hay forma de decir cuál de las marcas es la
  intro.
- **Hay dos clases de serie**, y eso descarta el atajo fácil: en unas la careta
  empieza siempre en el mismo minuto —se reconocería por su posición— y en
  otras la serie arranca con una escena y la mete después, en un sitio distinto
  cada vez. Estas segundas solo se reconocen **por el sonido**.
- Se llegó a montar el marcado a mano —un botón "La intro acaba aquí" que
  guardaba el segmento para la temporada y lo repartía por la sincronización— y
  **se descartó por cómo se usaba**: pedirle al que mira que marque la careta
  no compensa lo que ahorra.

Lo que quedaría, si algún día se retoma, es la huella de audio: comparar dos
capítulos y buscar el trozo que se repite, que es lo que hace el plugin de
Jellyfin y funcionaría con los dos tipos de serie. El coste no es la CPU sino
la descarga —en un MKV el audio va entrelazado con el vídeo, así que bajarse
quince minutos de audio es bajarse quince minutos de película, unos 400 MB por
capítulo—: viable bajo demanda al abrir una serie, impensable para las 6.500
del catálogo. Y si se hiciera, el formato a guardar es el de Jellyfin —tipo,
principio y final—, que es lo que permitiría importarlo de un servidor suyo.

### Lo que ya se ha visto se releva, no se queda

Una película se da por vista al **90 %** y un capítulo al **95 %**
(`FIN_PELICULA` y `FIN_EPISODIO`). Son distintos a propósito: los créditos de
una película son largos, y encadenar el capítulo siguiente exige más certeza de
que el anterior ha terminado de verdad.

Y "visto" no significa lo mismo en los dos sitios:

- **Una película vista se cae de "seguir viendo".** Estaba quedándose ahí para
  siempre, con la barrita al 99 %.
- **Un capítulo visto da paso al siguiente.** Una serie se ve en orden, así que
  lo que uno quiere ver es el que viene, no el que acaba de terminar; dejar el
  terminado obliga a entrar en la serie y buscar. Lo resuelve
  `Biblioteca.episodioSiguiente`, que salta de temporada si el que se acabó era
  el último de la suya. Sin siguiente, la serie se ha terminado y sale de la
  fila.

**La reproducción continua es un ajuste del perfil** (`continua`, encendido por
defecto), no del aparato: hay a quien le gusta que siga solo y hay a quien le
parece que le roban la noche. Se cambia desde el menú del perfil y viaja con la
sincronización como el resto de sus ajustes.

### En "seguir viendo", una fila por serie

Una serie se ve en orden, así que lo que hace falta es **por dónde vas**, no
la lista de los últimos cuatro capítulos: eso llena la fila con la misma
carátula repetida y esconde lo demás. El historial viene de lo más reciente a
lo más viejo, así que el primero de cada serie es el bueno. Por eso quien
llama pide más avances de los que caben: el recorte por serie se hace después.

### Mi Lista: lo marcado tiene su pestaña

Cada perfil tiene la suya. Se marca **manteniendo pulsado** sobre la ficha —el
toque normal ya reproduce o entra, y con el mando es el OK largo—, se puede
hacer **en cualquier sitio**: en la rejilla y en las filas del inicio, sea
película, serie o canal.

Ya no es un grupo de la barra lateral. Tenerlo en los dos sitios era el mismo
contenido por dos caminos, y en la barra se mezclaba con las categorías del
proveedor, que son otra cosa.

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

### Qué se recomienda: la nota sirve para descartar, no para ordenar

En la lista real **la valoración está inflada**: hay cientos de películas con
un 10 pelado, que no significa que sean buenas sino que no las ha valorado
nadie. Así que el criterio de la portada y de la fila "Recomendadas" ordena
por **año, luego por lo último que ha entrado, y luego por nota**, y usa la
nota para filtrar: fuera lo que baje de 7 y fuera lo que llegue a 10.

También quedan fuera las que llevan **"Screening"** en el título: son
grabaciones de pase de prensa, previas al estreno, y se ven mal. Siguen en el
catálogo —el sesgo del clasificador es no ocultar nada—, solo que no presiden
el inicio.

El criterio vive en `packages/core/src/recomendar.ts` porque lo aplican los
dos lados: el aparato, cuando saca sus sugerencias por su cuenta, y el
servidor de la casa, que las prepara una vez al día. Si cada uno usara el
suyo, la portada cambiaría según quién la hubiera calculado. En SQL entra por
`Orden = 'recomendada'`, que es **el único orden que además filtra**.

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

**Al entrar en una casa, el aparato adopta sus perfiles.** Los perfiles son del
grupo: al aprobar el alta queda la señal `adoptar` y, al conectar con la lista,
el aparato vacía los suyos y se trae los del grupo. `vaciarLoLocal` **borra de
verdad**, y es la única excepción a la regla de no borrar nunca: enterrar sería
peor, porque las lápidas viajan y el identificador de un perfil sale de su
nombre, así que enterrar "alejandro" aquí enterraría el de la casa.

**Ojo con el episodio: su número de fila no significa nada fuera del aparato.**
Los episodios no se importan con el catálogo —se piden al abrir cada serie—,
así que el `id` que les da SQLite depende de en qué orden haya abierto series
cada aparato. El historial guardaba ese número y por eso una serie a medias en
la tele no aparecía en la tablet, y podía aparecer **otro capítulo**: el que
tuviera ese número allí. El avance viaja con `claveDeEpisodio`
(`doctor-who-2005:s1e7`), y las URLs se buscan traduciendo esa clave a la fila
local. Es el mismo principio que el resto: **los identificadores salen del
contenido**.

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

### El árbitro: quién se queda la conexión

`max_connections` limita cuántas cosas se pueden estar bajando a la vez **de la
cuenta**, no de este aparato: si la tele está viendo algo y la tablet abre otra
cosa, la segunda ranura ya está ocupada aunque este aparato no haya hecho nada.
De ahí que el árbitro (`packages/ui/src/arbitro.ts`) tenga dos mitades.

**Lo que sabe de sí mismo.** Cuántas cosas tiene abiertas este aparato y con
qué prioridad: `reproducir` > `previa` > `descargar`. Reproducir es lo que
alguien está mirando y gana siempre; la descarga va la última **porque es la
única que no pierde nada**, que los ficheros aceptan `Range` y se reanuda donde
iba. Cuando hace falta sitio, `pedir` devuelve a quién hay que echar: el
árbitro no conoce reproductores ni descargas, solo reparte.

**Lo que aprende a golpes.** Que la casa esté al tope no se puede saber de
antemano —`active_cons` del handshake no vale de semáforo, medido—, así que se
descubre con el `403` del panel. Y entonces **no es un fallo: es una espera**.
El reproductor lo enseñaba como "El servidor rechazó la conexión (403)", uno
cerraba y volvía a entrar, y vuelta a empezar; ahora sale una cuenta atrás y se
reintenta solo.

Dos números salen de medir el panel, no de elegirlos:

- **El enfriamiento, 30 s.** Es lo que tarda el panel en soltar de verdad una
  ranura después de cerrar. Lo recién soltado no se puede reusar: pedirlo antes
  es comerse un 403. Ojo, esto **solo se nota cuando no hay ranuras libres**:
  con las tres de esta cuenta, zapear sigue siendo instantáneo.
- **Las ranuras salen del handshake.** No hay ningún número escrito a mano: una
  cuenta del proveedor da 1 y otra da 3, y `ajustarRanuras` se lo cree.

Lo expulsado **no enfría**: la ranura se la queda quien acaba de entrar sin
soltarla en el panel. Si enfriara, echar a una descarga para poner una película
haría esperar treinta segundos a la película, que es lo contrario de lo que se
busca.

Y al cerrar el reproductor la ranura se suelta **siempre**, que es la mitad que
fallan los reproductores comerciales: dejan la conexión colgada y la cuenta se
queda bloqueada hasta que el panel la caduca por su cuenta.

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

### El mando dentro del reproductor

Las flechas saltan diez segundos y el OK pausa, que es lo que uno espera con un
mando delante de la tele.

**El recorrido va de arriba abajo, en el orden en que se ven las cosas**: la
barra de tiempo, la fila de reproducir y la fila de ajustes. El foco entra en
el círculo de reproducir, que es lo que uno toca casi siempre; subiendo se va a
la barra y bajando, a audio, subtítulos y el capítulo siguiente. Cada cosa
donde se ve, sin recorridos que aprender.

Y hay **dos saltos, uno por sitio**: diez segundos en el círculo de reproducir
—volver a oír una frase— y de medio minuto en adelante en la barra, subiendo
hasta cinco si se mantiene pulsado, que cruza un capítulo en cuatro
pulsaciones. Marcarlos los dos a la vez fue un error intermedio: no se sabía
cuál movían las flechas. **Bajando se entra en la fila de botones** —desde el
principio, audio, subtítulos, siguiente— y ahí las flechas los recorren; con un
panel de pistas abierto, el mando es suyo hasta elegir una. Subiendo se vuelve
al vídeo.

Dos cosas que costaron encontrar, y que valen para cualquier pantalla nueva:

- **`focusable={false}` en todo lo del reproductor.** Con el foco del sistema
  puesto en los botones, Android le entregaba el OK al botón enfocado y la
  pulsación **no llegaba nunca** al manejador de teclas: se podía llegar a los
  botones con el mando pero no activarlos. Es la misma regla que ya seguía la
  biblioteca, y el síntoma es el contrario del clásico: no es que la pulsación
  cuente dos veces, es que no cuenta ninguna.
- **El foco tiene que cantar sobre cualquier fotograma.** El 18 % de blanco que
  marcaba lo enfocado desaparecía sobre una imagen clara. Va el verde de la
  marca sobre fondo oscuro, como en el resto de la aplicación.
- **Y tiene que ser lo único que se vea así.** Había tres cosas compitiendo: el
  círculo de reproducir con su borde claro parecía enfocado siempre, la pista
  de audio puesta llevaba fondo verde, y lo enfocado de verdad un borde blanco.
  Ahora **el aro verde es el foco y nada más**: lo que está puesto se marca con
  el texto en verde, y el círculo de reproducir tiene el borde muy tenue.
- **"Atrás" cierra primero lo de dentro.** Estando en la fila de botones o en
  las pistas, atrás salía del vídeo y devolvía a la serie —dos pantallas de
  más—. El reproductor registra su propio manejador, que devuelve `false`
  cuando no hay nada abierto para que siga el de la aplicación: Android los va
  llamando del último registrado al primero hasta que uno diga que sí.

- **El audio y los subtítulos se recuerdan por serie y por perfil.** Uno ve
  Friends en inglés con subtítulos en inglés y otro doblada, así que va en
  `profile_setting` con la clave `pistas:<serie>` y viaja con la
  sincronización. **Se recuerda el idioma, no el número de pista**: el número
  depende de cómo empaquetara el fichero quien lo codificó y cambia de un
  capítulo a otro, así que guardarlo acabaría poniendo el comentario del
  director. Si el capítulo no trae ese idioma manda lo que venga por defecto,
  que es mejor oírlo en español que no oírlo. Y apagar los subtítulos también
  se recuerda: si se guardara como "nada elegido", volverían a salir.
- **El punto por el que ibas es del capítulo que dejas.** Al encadenar con el
  siguiente hay que olvidarlo: si no, el que viene arranca donde acabó el
  anterior —o sea, en los créditos—, se da por terminado en el acto y carga el
  siguiente, y así hasta el infinito. Un capítulo al que se llega desde el
  anterior empieza por el principio.

La primera pulsación con los controles escondidos solo los enseña —igual que el
OK—, así que para entrar en los botones desde el vídeo parado hacen falta dos.

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
- **Al renombrar la aplicación hay que tocar `MainActivity` también.**
  `getMainComponentName()` devuelve el nombre a mano y tiene que ser
  **exactamente** el `name` de `app.json`, que es el que registra `index.js`.
  Si no coinciden, la aplicación se cierra nada más abrirse con
  `"…" has not been registered`. Y lo peor: **no se nota al instalar**, porque
  mientras Gradle siga sirviendo el bundle de antes todo funciona. Salta en la
  primera compilación que rehace el bundle, que puede ser dos cambios después,
  cuando ya no es evidente de dónde viene.
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
- **Una regex escrita desde un heredoc puede llegar rota y en silencio.**
  `store.ts` tenía `/\b(rating|sort_title)\b/` con **retrocesos de verdad**
  (0x08) en vez de `\b`: el heredoc se comió las barras invertidas al
  escribir el fichero. La regex no casaba nunca, así que el prefijo de tabla
  no se ponía y la consulta con `JOIN` quedaba ambigua. No lo cazó nadie
  porque el escritorio es un prototipo y esa ruta no se prueba. Los ficheros
  con barras invertidas se escriben con la herramienta de escritura, no
  redirigiendo un heredoc.
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
- **En directo, `onProgress` avisa una vez y no vuelve**, y `currentTime` llega
  como `TIME_UNSET`: el `Long.MIN_VALUE` de ExoPlayer, que en JavaScript se ve
  como −9,2·10¹⁸. Un flujo en directo no tiene posición, así que no hay nada
  que contar. Por eso un canal **no se anotaba nunca** en el historial —no
  llegaba al mínimo de treinta segundos— y "seguir viendo" no lo veía por
  mucho rato que estuviera puesto. Lo que se anota de un directo es cuánto
  llevas, medido con un reloj propio del reproductor, y sobre todo **cuándo**:
  es la hora la que decide si el programa que veías sigue echándose.
- **`memo` no sirve de nada si las props cambian de identidad.** En la tele,
  cada pulsación del mando tardaba **casi un segundo** en pintarse. Medido con
  un `console.log` alrededor del manejador: `mover` tardaba **1 ms** y el
  pintado, **1.100 ms**; el presentador no tenía nada que ver. La cadena de
  culpables, y hasta que no se quitó la última no bajó de 800 ms:
  1. `FichaDeFila` y `Carrusel` sin `memo`: el `extraData` de una `FlatList`
     cambia con el foco y se repintaban las veinte fichas de la fila.
  2. Cada ficha recibía **dos funciones nuevas por pintado** —`() =>
     onTocar(index)`—, así que `memo` comparaba props distintas siempre. Se
     arregla pasando el índice y una función estable.
  3. La columna se le pasaba **a todas las filas**, no solo a la activa, así
     que las ocho de la pantalla veían una prop nueva en cada movimiento.
  4. Y las funciones que bajan desde la pantalla —`onTocar`, `onTurno`— se
     escribían en línea en el JSX. Esa fue la última, y la que de verdad lo
     bajó todo: **de 800 ms a 90 ms**.

  La moraleja para la próxima pantalla: envolver en `memo` es la mitad
  barata; la otra mitad es que **todo lo que baje sea estable**, y eso se
  comprueba midiendo, no leyendo.
- **Un foco, y solo uno.** Con el mando en la cabecera, ninguna fila del inicio
  puede quedarse marcada, y mientras se escribe en el buscador los resultados
  tampoco. El síntoma es un borde que se queda puesto donde ya no está el
  mando, y engaña sobre dónde va a caer la próxima pulsación.
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
- **Para instalar por wifi, hay que dejarlo puesto desde el USB.** Con el
  aparato enchufado: `adb tcpip 5555`, y desde entonces `adb connect
  <ip>:5555` hasta que se reinicie —al reiniciar vuelve a modo USB y hay que
  repetirlo—. La dirección se saca del propio aparato con
  `adb shell ip -f inet addr show wlan0`. Sin esto, el puerto 5555 está
  cerrado y no hay forma de instalar sin cable.
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
  inviable para 18.000 desde un televisor, y por eso lo hace el servidor de la
  casa una vez para todos. En el aparato se sigue pidiendo al abrir una ficha
  que el servidor aún no haya cubierto. Medido contra el panel real: sinopsis, reparto y fondo, los tres.
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

### Los perfiles son de la casa, y su identificador sale del nombre

El identificador de un perfil se calcula del nombre al crearlo
(`idDePerfil`), igual que el de una película sale de su título. Es lo que
permite que la tele y la tablet hablen del mismo perfil sin traducir nada.

La contrapartida: **escribir un nombre distinto en cada aparato crea dos
perfiles distintos**, y como el historial cuelga del perfil, cada uno se queda
con el suyo aunque la sincronización funcione perfectamente. "Alejandro" y
"Alejandro 1" no son la misma persona para el sistema.

Y si además los aparatos están en **grupos distintos**, no comparten nada en
absoluto: el grupo es la frontera de la sincronización. Se reconoce enseguida
porque cada aparato ve un solo perfil y no el del otro, y porque el trabajo
diario del servidor prepara la misma lista dos veces, una por grupo.

Al emparejarse, el aparato **adopta los perfiles de la casa** en vez de
quedarse con el que se creó él solo: queda la señal `adoptar`, y al conectar
con la lista vacía los suyos y se trae los del grupo.

### La pantalla de perfiles es donde se administra

Logotipo arriba, "¿Quién está viendo?" y los perfiles en **círculos**, como en
cualquier servicio de estos. Redondos y no cuadrados a propósito: es lo que
hace que se lean como personas y no como una ficha más de contenido, que en
esta aplicación son todas rectángulos.

Editar vive aquí y en ningún otro sitio. Antes el nombre y el color se
cambiaban desde el menú de la biblioteca, a ciegas —"Cambiar color" iba dando
la vuelta a la paleta—; ahora se entra en "Administrar perfiles", se toca el
que sea y se ve lo que se está eligiendo. **El borrado avisa**: se lleva por
delante el historial y la Mi Lista de esa persona, y lo hace en todos los
aparatos de la casa.

**Con un solo perfil no se pregunta.** La pantalla de "¿quién está viendo?"
con un único círculo no elige nada: era una pulsación de más en cada arranque.
Se sigue llegando a ella desde el menú, con el botón "Perfiles".

Y **el menú del círculo empieza por las otras personas**, con su cara y su
nombre. Había un "Cambiar de perfil" que llevaba a otra pantalla para acabar
eligiendo lo mismo; ahora se pasa de una a otra en dos pulsaciones. Al volver
del menú "Perfiles" hay que **releer el perfil** de la base antes de pintar la
biblioteca: la copia que llevábamos es de antes de editarlo, y sin eso
cambiabas de retrato y la cabecera seguía con la inicial.

**El retrato es una palabra, no una imagen.** El perfil guarda el nombre de uno
de los diez que trae la aplicación (`apps/tv/src/retratos/`), así que viaja
como cualquier otro dato del perfil y no hay nada que subir a ninguna parte.
Son siluetas en el negro de la aplicación con los huecos transparentes, y se
pintan **encima del color del perfil**: los diez valen para los cinco colores.
Un nombre desconocido —de una versión más nueva, llegado por sincronización—
no rompe nada: se cae en la inicial, que es como empiezan todos.

Al añadir la columna `avatar` se vio que **el servidor no aplicaba
`COLUMNAS_MIGRADAS`** a la base de cada casa: se creaba con el esquema de la
primera versión y ahí se quedaba. La sincronización pide todas las columnas de
la tabla, así que reventaba con "no such column". Ahora eso lo hace
`migrarTablasDePerfil`, en el propio esquema, y lo usan el servidor y los
tests. **Añadir una columna a un perfil obliga a redesplegar el VPS**: un
servidor viejo no se cae —solo escribe los campos que conoce—, pero el dato
nuevo no llega al otro aparato hasta que se actualiza.

## Estado y siguiente paso

El README lleva la tabla de estado y las cifras medidas contra la lista real
(218.662 entradas, ~6 s de importación completa, consultas de 0-1 ms).

Pendiente: la descarga a disco y la interfaz del escritorio. Del reproductor
solo queda decidir qué hacer con el redimensionado de la ventana transparente.

El árbitro de conexión ya reparte y el reproductor lo usa; falta **verlo
esperar contra el panel de verdad**, que exige tener las tres ranuras ocupadas
a la vez, y engancharle la descarga cuando exista.

Compartir el historial entre aparatos está terminado de punta a punta: el
modelo, el servidor (`apps/sync`, ver su README), el cliente (`ClienteSync`) y
la pantalla de emparejamiento. Falta **probarlo contra el VPS de verdad** y
decidir cada cuánto conviene sincronizar —ahora son dos minutos mientras la
biblioteca está abierta, más una vez al conectar—.
