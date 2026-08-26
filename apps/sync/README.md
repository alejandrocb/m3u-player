# Servidor de sincronización

Comparte el historial, los favoritos, los perfiles y los ajustes entre los
aparatos de una misma casa, y reparte las listas para no tener que escribirlas
con el mando en cada tele.

No tiene **ninguna dependencia**: HTTP con `node:http`, base con `node:sqlite`,
contraseñas con `node:crypto`. La imagen es Node y unos cuantos ficheros.

## Cómo se organiza

- Un **grupo** es una casa (*Casa Triana*, *Casa Fariones*) y es la frontera de
  la sincronización: lo que se ve en una no sale de ahí.
- Cada grupo tiene sus **aparatos** (TV Salón, Tablet…) y sus **listas**.
- Los perfiles siguen viviendo dentro del grupo, para cuando en una casa no ven
  lo mismo dos personas.

Cada grupo guarda su historial en **su propio fichero SQLite**, con el mismo
esquema exacto que los aparatos. Eso permite que el servidor use el mismo
código de sincronización que la app (`@m3u/storage/sincronizar` y `fusionar`),
que es lo que garantiza que los dos lados resuelvan los conflictos igual.

## Desplegar

Desde la raíz del repositorio, en el VPS:

```bash
docker compose -f apps/sync/compose.yaml up -d --build
```

Queda escuchando en `127.0.0.1:3300`. **No lo publiques en `0.0.0.0`**: por ahí
pasan tokens y las URLs del panel, que llevan usuario y contraseña dentro. El
que da la cara a internet es Caddy, que además pone el TLS.

Añade el bloque al `/etc/caddy/Caddyfile`:

```
sync.tudominio.com {
    reverse_proxy 127.0.0.1:3300
}
```

Y recarga sin cortar nada:

```bash
sudo systemctl reload caddy
```

El subdominio necesita su registro **A** en el DNS antes de que Caddy pueda
pedir el certificado.

## La primera cuenta

Al arrancar sin ninguna cuenta, el servidor escribe un código de instalación en
el registro:

```bash
docker compose -f apps/sync/compose.yaml logs sync
```

Con ese código, la web deja crear el usuario administrador. Solo lo ve quien
puede leer los registros del contenedor, y en cuanto existe una cuenta deja de
valer: una página de instalación abierta a quien llegue primero es la forma
clásica de perder un servidor recién levantado.

## Dar de alta un aparato

1. En el aparato, la app enseña un código corto: `K7M2-P4XR`.
2. En la web, dentro del grupo que toque, escribes ese código y le pones
   nombre.
3. El aparato recoge su token y las listas de la casa. No hay que teclear nada
   con el mando.

El código corto **no vale para llevarse el token**: el aparato pregunta con un
secreto largo que nunca se enseña. Adivinar el código no sirve de nada.

El token se entrega **una sola vez** y de él solo queda la huella. Si un
aparato lo pierde —borrar datos, reinstalar— se vuelve a emparejar.

## Las portadas del inicio

Además de sincronizar, el servidor **prepara una vez al día las sugerencias que
presiden el inicio** de cada lista: título, nota, año, sinopsis, reparto,
género y una imagen apaisada. Los aparatos las recogen con `GET /api/portadas`.

Se hace aquí porque cuesta una petición al panel por candidata y muchas no
traen imagen apaisada, así que hay que preguntar por bastantes más de las que
salen. Hecho en el servidor, se paga una vez para toda la casa en vez de una
vez por aparato y arranque. Y de paso se puede comprobar que la imagen sea de
verdad apaisada, midiéndola: hay paneles que ponen el cartel vertical en el
campo del fondo.

Es una **caché**: la tabla `portada` se puede borrar entera y se vuelve a
llenar sola en la siguiente revisión, que es cada hora. Si el trabajo falla
—panel caído, credenciales caducadas— se anota en el registro y se queda lo
que hubiera preparado antes; los aparatos, mientras tanto, sacan sus portadas
preguntando al panel ellos mismos.

```bash
docker compose -f apps/sync/compose.yaml logs -f sync | grep portadas
```

## Copias de seguridad

Todo está en el volumen `m3u-sync-datos`: `panel.sqlite` con los grupos, los
aparatos y las listas, y un `grupo-<id>.sqlite` por casa. Copiar esos ficheros
es la copia de seguridad completa.

```bash
docker run --rm -v m3u-sync-datos:/datos -v "$PWD":/copia alpine \
  tar czf /copia/sync-$(date +%F).tar.gz -C /datos .
```

## Variables

| Variable | Por defecto | Para qué |
|---|---|---|
| `PUERTO` | `3300` | Dónde escucha |
| `ESCUCHA` | `0.0.0.0` | Interfaz; dentro del contenedor da igual, lo acota Docker |
| `DATOS` | `/datos` | Dónde van las bases |
