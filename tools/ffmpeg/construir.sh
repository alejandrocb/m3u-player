#!/usr/bin/env bash
#
# Compila `media3-decoder-ffmpeg` y deja el AAR en /salida.
#
# El resultado es lo que le falta al reproductor para sonar con DTS, Dolby
# TrueHD y los Dolby de gama alta: esos códecs se pagan por aparato y casi
# ningún Android los trae, ni teléfonos ni cajas de TV. Medido en casa: la
# tele no decodifica DTS y la tablet Samsung no decodifica **ningún** Dolby,
# ni siquiera AC3.
#
# La versión de media3 tiene que ser **la misma que usa la aplicación**
# (`RNVideo_media3Version` de react-native-video): la extensión se enchufa en
# el reproductor por reflexión y una versión distinta no encaja.

set -euo pipefail

MEDIA3="${MEDIA3:-1.8.0}"
# La rama de FFmpeg que media3 da por buena para esta versión.
FFMPEG="${FFMPEG:-release/6.0}"
# El nivel mínimo de API, no la arquitectura: el guion compila las cuatro por
# su cuenta. 21 es lo que pide media3 y cubre de sobra a la Samsung (Android 8).
NIVEL="${NIVEL:-21}"

# Los decodificadores que se meten dentro.
#
# Los que importan son los de licencia —`dca` es DTS, y van también TrueHD y
# los Dolby—; el resto son baratos de incluir y evitan volver aquí por un
# fichero raro. Ojo: cada uno engorda el `.so`, así que no se mete "todo".
DECODIFICADORES=(
  ac3 eac3            # Dolby Digital y Digital Plus
  dca                 # DTS, que es el que falla en la tele
  mlp truehd          # Dolby TrueHD
  vorbis opus flac alac
  mp3 aac
  pcm_mulaw pcm_alaw
)

echo "==> media3 ${MEDIA3}, FFmpeg ${FFMPEG}, API ${NIVEL}"

git clone -q --depth 1 --branch "${MEDIA3}" https://github.com/androidx/media.git /media3
RUTA="/media3/libraries/decoder_ffmpeg/src/main"

echo "==> bajando FFmpeg"
git clone -q --depth 1 --branch "${FFMPEG}" https://github.com/FFmpeg/FFmpeg.git "${RUTA}/jni/ffmpeg"

echo "==> compilando FFmpeg para las cuatro arquitecturas (esto tarda)"
cd "${RUTA}/jni"
./build_ffmpeg.sh "${RUTA}" "${NDK_PATH}" linux-x86_64 "${NIVEL}" "${DECODIFICADORES[@]}"

echo "==> lo que ha quedado:"
ls -la "${RUTA}/jniLibs"/*/ | head -20

echo "==> empaquetando el AAR"
cd /media3
# Sin daemon ni caché de configuración: es un contenedor de usar y tirar.
./gradlew --no-daemon :lib-decoder-ffmpeg:assembleRelease

mkdir -p /salida
find /media3/libraries/decoder_ffmpeg/buildout -name '*.aar' -exec cp -v {} /salida/ \;
ls -la /salida
echo "==> listo"
