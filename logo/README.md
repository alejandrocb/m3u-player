# El logotipo de ChocitaTV

Una choza con la luz encendida y **la puerta haciendo de ▶**. El nombre viene
de La Chocita, la casa de campo donde se junta la familia, que es exactamente
para lo que se hizo esta aplicación: una tele de casa que comparte lo que ve.

## Los ficheros

| Fichero | Para qué |
|---|---|
| `chocitatv.svg` | **El maestro.** El icono con su fondo negro redondeado. |
| `chocitatv-marca.svg` | La choza sola, sin fondo, para ponerla sobre lo que sea. |
| `chocitatv-logotipo.svg` | La marca con el nombre al lado. |
| `png/icono-*.png` | El icono con fondo, de 1024 a 32. |
| `png/marca-*.png` | La choza sola, con transparencia. |
| `png/logotipo-*.png` | Marca y nombre, con transparencia. |
| `png/banner-1280x720.png` | Para una portada o una ficha de tienda. |

Los PNG **salen del SVG**: si cambia el dibujo, se vuelven a exportar todos.
No hay nada dibujado a mano en ninguno de ellos.

## Los colores

| | |
|---|---|
| Fondo | `#0b0b0c` — el mismo negro de la aplicación |
| Verde | `#35d07f` — el de la marca, el del foco y el de las barras de avance |
| Verde del tejado | `#26ae69` — para separarlo del cuerpo sin usar una línea |
| Ámbar | `#f0c14a` — la luz de dentro, el mismo de las estrellas de la nota |

## Dónde está puesto

En Android, dentro de `apps/tv/android/app/src/main/res`:

- `mipmap-*/ic_launcher.png` y `ic_launcher_round.png`, de 48 a 192.
- `mipmap-*/ic_launcher_foreground.png`, de 108 a 432: es el primer plano del
  **icono adaptable**, que Android recorta con la máscara que quiera. Por eso
  la choza va ahí más pequeña: de los 108 del lienzo solo se garantizan los 72
  del centro.
- `mipmap-anydpi-v26/ic_launcher.xml`, que junta ese primer plano con el fondo
  (`values/colors.xml`).
- `drawable/tv_banner.png`, 320×180: **es lo que se ve en la fila del
  lanzador de Android TV**, y ahí no vale el icono, tiene que ser apaisado y
  llevar el nombre.

## Una nota sobre la letra

El nombre de los PNG está compuesto con **Segoe UI Bold**, que es la que hay
en el equipo donde se generaron. Para uso propio no hay problema; si algún día
esto va a una tienda, conviene rehacer el logotipo con una fuente libre
—Inter o Montserrat cumplen— y convertir el texto a trazados.
