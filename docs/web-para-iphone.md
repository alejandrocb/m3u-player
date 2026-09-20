# Una web para el iPhone

Propuesta, 2026-09-21. Todavía no hay nada escrito de esto.

En la casa hay un iPhone y ChocitaTV es un APK: ese aparato se queda fuera.
Es el mismo callejón que la tele Samsung con Tizen, donde ya se descartó
portar la aplicación, y la salida fue la misma idea que se propone aquí:
**no llevar la aplicación al aparato, llevarle solo lo que necesita.**

## Lo primero, porque decide el alcance: el iPhone no puede reproducir esto

**En iOS todos los navegadores son Safari por dentro.** Chrome, Firefox y Edge
comparten WebKit y su decodificador; cambiar de navegador no cambia un solo
códec. (Desde iOS 17.4 la normativa europea obliga a permitir otros motores,
pero Google no ha publicado un Chrome con motor propio, así que en la práctica
no existe.)

Y lo que sirve el panel son **MKV con audio AC3**, medido. WebKit no abre ni el
contenedor ni ese audio. Lo que sí traga es **HLS** —el formato de Apple, con
aceleración por hardware— y MP4 con H.264 y AAC.

La buena noticia sale de la misma medición: **el vídeo ya es H.264**. No hay
que recodificar imagen, que sería inviable; solo estorban el envoltorio y el
audio.

## Fase 1: la web no reproduce nada

El iPhone entra, ve el catálogo, busca, abre fichas, gestiona Mi Lista, ve por
dónde va cada cosa… y **manda a la tele**.

Esto resuelve el caso real de la casa —alguien con iPhone quiere poner algo en
el salón— sin tocar un solo códec, sin que el vídeo pase por el VPS y sin gastar
una ranura del panel. Es casi todo el valor por una fracción del trabajo.

### De dónde sale el catálogo

Es la pregunta que decide la arquitectura, porque **una web no tiene base
local**: hoy cada aparato se baja el catálogo del panel y lo guarda en su
SQLite, y el servidor **no lo tiene**. Lo que el VPS guarda hoy es `ficha`
(sinopsis, reparto, géneros de TMDb), `portada`, `programa` y `parrilla`; no
hay ni una tabla con las 18.000 películas.

Lo que hace falta es que el servidor importe el catálogo **igual que lo hace un
aparato**, y ahí está la sorpresa agradable: el código ya existe y está
probado en producción.

- `construirCatalogo` vive en `@m3u/core`, que no importa nada de plataforma.
- `bibliotecaDesde(store)` de `@m3u/storage` **ya implementa el puerto
  `Biblioteca` sobre `node:sqlite`**, que es justo lo que corre en el VPS.
- El servidor ya habla con el panel (`XtreamClient`, `credentialsFromUrl`) y ya
  tiene un trabajo diario que lo hace.

O sea: importar el catálogo en el servidor es **reutilizar tres piezas que ya
están**, no escribir una cuarta. Y ocupa poco: son identificadores y títulos,
unos pocos megas por lista.

Esto era, literalmente, para lo que se separaron los paquetes.

### Y la interfaz

`Presentador` de `@m3u/ui` tampoco depende de plataforma: junta navegación,
foco y datos y produce el estado de la pantalla. Un navegador es otra vista
más, como lo son Electron y React Native.

Dos caminos, y me inclino por el segundo:

1. **El presentador en el navegador**, pidiendo datos por API. Es lo más
   parecido a la aplicación actual, pero obliga a exponer el puerto
   `Biblioteca` entero como API pública y a pelearse con la latencia.
2. **El presentador en el servidor**, que devuelve la pantalla ya montada y el
   navegador solo la pinta y manda las cuatro señales. Menos API que diseñar,
   menos que puede desincronizarse, y el móvil no hace nada pesado.

En los dos casos **la vista hay que escribirla entera**: la de React Native no
se reaprovecha. Es la parte gorda del trabajo.

## Los dos pasos, y recordar el aparato

La casa ya tiene un modelo de esto, y es mejor que inventar otro: **código
corto que se aprueba, token largo que se entrega una sola vez**. Un navegador
entra por el mismo sitio.

1. El iPhone abre la web y enseña un código, como hace un aparato nuevo.
2. Se aprueba desde la web de administración —donde ya se aprueban los demás—.
3. El navegador recibe un token y **lo recuerda**, así que no vuelve a pedir
   nada.

Lo que hay que añadir y no existe hoy:

- **El token va en una cookie `httpOnly`, `Secure` y `SameSite=Lax`**, no en
  `localStorage`. Un fallo de XSS en la página puede leer `localStorage`; una
  cookie `httpOnly` no la ve el JavaScript.
- **Poder revocar**, y verlo. La pantalla de aparatos tiene que listar también
  los navegadores —"iPhone de Alejandro, visto por última vez el martes"— y
  permitir echarlos. Sin esto, un teléfono perdido no tiene solución.
- **Caducidad larga pero no eterna**, y renovable mientras se use.

## Los problemas de seguridad, sin adornos

Un navegador es un blanco mucho más blando que un APK, y hay una consecuencia
concreta que condiciona el diseño:

- **El token del navegador no puede ver `/api/listas`.** Esa ruta entrega las
  listas **con las credenciales del panel dentro**. En un APK viven en el
  llavero del sistema; en una web, cualquiera que coja el teléfono
  desbloqueado las lee desde las herramientas de desarrollo. Así que hace falta
  **un tipo de token con menos permisos**: entra a perfiles, catálogo e
  historial, y nunca a las credenciales. Eso también significa que la fase 2
  tendrá que reproducir **a través del VPS**, porque el navegador no puede
  tener la URL del panel.
- **Un teléfono desbloqueado es la sesión.** Recordar el aparato es
  exactamente renunciar a preguntar otra vez; el precio es que quien tenga el
  teléfono entra. Para lo que hay aquí —historial y catálogo de casa— es un
  precio razonable, pero conviene decirlo en voz alta y tener el botón de
  revocar.
- **La web amplía la superficie del VPS.** Hoy solo contesta a aparatos con
  token y a la página de administración. Una web pública de verdad es otra
  cosa: formularios, sesiones y páginas servidas a cualquiera que pase.

## Lo que se ve mal en un iPhone, y hay que resolver

- **La interfaz actual no vale.** Está pensada para un televisor a tres metros
  y para una tablet; en una pantalla de seis pulgadas hay que rehacer la
  disposición, no encogerla.
- **`100vh` miente en Safari**: la barra del navegador entra y sale y el alto
  cambia. Se usa `100dvh`.
- **El recorte y la isla dinámica**: hay que respetar `env(safe-area-inset-*)`
  o el contenido se mete debajo.
- **No hay `hover`.** Todo lo que hoy depende del foco del mando no existe
  aquí, igual que ya pasa en la tablet con el dedo.
- **Los carteles pesan.** Veinte carátulas por pantalla desde el panel, sin
  caché ni tamaños intermedios, es mucho dato en una conexión móvil.
- **Añadir a la pantalla de inicio** (PWA) quita la barra del navegador y lo
  deja a pantalla completa. Es casi gratis y mejora mucho la sensación.

## Fase 2, si aun así se quiere ver en el teléfono

El VPS reempaqueta a HLS con ffmpeg: **el vídeo se copia tal cual** (`-c:v
copy`, porque ya es H.264) y solo el audio pasa a AAC. Barato en CPU.

Lo que cuesta de verdad:

- **El vídeo pasa por el VPS**: panel → VPS → iPhone. Varios megabits por
  espectador; hay que mirar el ancho de banda y la cuota contratados.
- Gasta una ranura del panel mientras dure, como cualquier reproducción, así
  que entra en el árbitro.
- Hay que **matar bien** esos procesos: un ffmpeg colgado se come el VPS.

Es el mismo patrón que ya se montó para la tele Samsung: **un puente que
traduce**. Allí el teléfono le habla a la tele en su idioma; aquí el VPS le
hablaría al iPhone en el suyo.

## Lo que descarto

- **Una aplicación nativa de iOS.** Es otra aplicación entera —otra interfaz,
  otro reproductor, otra base— y además necesita cuenta de desarrollador de
  Apple y renovarla cada año. El mismo razonamiento que descartó Tizen.
- **Reproducir MKV en el navegador con un decodificador en WebAssembly.** Se
  puede, y va mal: consume batería, se calienta y no usa el hardware.

## Por dónde empezaría

1. Que el servidor importe el catálogo de cada lista, reutilizando
   `construirCatalogo` y `@m3u/storage`. **Esto no necesita ninguna web** y ya
   sirve para otra cosa: hoy cada aparato hace 66 peticiones al panel para lo
   mismo.
2. El token de navegador, con menos permisos, y el alta por código.
3. La vista: inicio, ficha, buscador y "Ver en la tele".

El primer paso es el que más despeja, y es útil aunque la web no se llegue a
hacer nunca.
