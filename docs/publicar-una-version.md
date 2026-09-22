# Publicar una versión

Los aparatos se actualizan solos desde el servidor de la casa. Esto es lo que
hay que hacer para poner una versión nueva a su alcance.

Se hace **una vez la preparación** y, a partir de entonces, publicar son tres
órdenes.

## La preparación, una sola vez

### 1. Guardar la clave de firma

En `C:\Users\Usuario\.chocitatv\` están la clave con la que se firma la
aplicación y su contraseña, fuera del repositorio porque es público.

**Cópialo a sitio seguro.** Android solo acepta una actualización firmada con
la misma clave, así que perder ese fichero obliga a desinstalar y reinstalar en
todos los aparatos, y a volver a emparejarlos uno por uno.

### 2. Desplegar el servidor con las rutas nuevas

Las rutas `/api/version` y `/api/apk` son código nuevo, así que hay que
rehacer la imagen. En el VPS, con el repositorio ya actualizado:

```bash
docker compose -f apps/sync/compose.yaml --env-file ~/m3u-sync.env up -d --build
```

No hay que tocar `compose.yaml`: el APK se guarda dentro de `/datos`, que ya es
el volumen `m3u-sync-datos` de siempre.

## Publicar, cada vez

### 1. Compilar

```bash
cd apps/tv/android && ./gradlew.bat assembleRelease
```

### 2. Preparar la ficha

```bash
node tools/publicar.mjs
```

Escribe el `version.json` que acompaña al APK y **comprueba la firma antes de
nada**: si sale `CN=Android Debug`, para y no subas nada, porque los aparatos
lo rechazarían con "aplicación no instalada". Tiene que decir
`CN=ChocitaTV, OU=Casa, O=ChocitaTV, C=ES`.

También imprime el `sha256`, que es lo que cada aparato comprueba después de
bajarlo.

### 3. Subirlo

Los dos ficheros salen de
`apps/tv/android/app/build/outputs/apk/release/`. Primero al VPS:

```bash
scp apps/tv/android/app/build/outputs/apk/release/app-release.apk TU-VPS:/tmp/chocitatv.apk
scp apps/tv/android/app/build/outputs/apk/release/version.json    TU-VPS:/tmp/version.json
```

Y de ahí al volumen del servidor, **con el APK llamado `chocitatv.apk`**, que es
el nombre que busca:

```bash
docker exec m3u-sync mkdir -p /datos/apk
docker cp /tmp/chocitatv.apk m3u-sync:/datos/apk/chocitatv.apk
docker cp /tmp/version.json  m3u-sync:/datos/apk/version.json
```

No hace falta reiniciar el servidor: mira la fecha del fichero y se entera solo.

### 4. Comprobar que se ve

Desde cualquier aparato ya emparejado, abre la aplicación y mira el menú del
perfil: si lo publicado es más nuevo que lo que corre ahí, aparece
**"Actualizar a ‹fecha›"**.

En el registro del servidor queda la línea
`[apk] publicada 0.0.1 · 2026-09-22 10:45 · 684d6d6`.

## Lo que hace cada aparato

Pregunta al conectar, **una vez**, y no en cada sincronización: una versión
nueva no aparece cada dos minutos y a quien está viendo algo no hay que
interrumpirle.

Si hay algo más nuevo —se compara la **fecha de compilación**, no el commit—,
sale la entrada en el menú. Al pulsarla se baja el APK a la caché, comprueba el
tamaño y el `sha256`, y se lo pasa al instalador de Android.

La primera vez, cada aparato pedirá permiso para **instalar aplicaciones
desconocidas**. Es un permiso del sistema y se concede una sola vez por
aparato.

## Lo que no se puede hacer así

**Un aparato nuevo, o uno sin emparejar, no ve nada de esto**: el APK va por la
API con el token de la casa, que es justo lo que evita tener una dirección
abierta con el instalable. Para el primer arranque de un aparato sigue
haciendo falta `adb`.

Y si el enlace es malo, **por cable**. Medido en la tablet Samsung: por wifi el
envío se colgaba indefinidamente —respondía a adb pero perdía el 100 % de los
pings— y por USB tardó 2,8 segundos.
