# Compila la extensión FFmpeg de media3, que es la que trae los códecs de
# audio con licencia: DTS, Dolby TrueHD y compañía.
#
# **Va en un contenedor a propósito.** El guion de FFmpeg es `bash` con
# autotools y no se lleva bien con Windows, y de paso esto queda repetible:
# quien lo necesite dentro de un año lanza lo mismo y saca el mismo AAR, sin
# ir adivinando qué versión del NDK tenía aquel equipo.
#
#   docker build -t chocita-ffmpeg tools/ffmpeg
#   docker run --rm -v "%cd%/tools/ffmpeg/salida:/salida" chocita-ffmpeg
#
# Tarda: se baja el NDK (~1 GB), las herramientas de Android y el código de
# FFmpeg, y compila para cuatro arquitecturas.

FROM eclipse-temurin:17-jdk-jammy

# `unzip` para el SDK, `pkg-config` y `make` para FFmpeg, `python3` porque lo
# pide el guion de media3.
RUN apt-get update && apt-get install -y --no-install-recommends \
      git curl unzip make pkg-config python3 ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV ANDROID_HOME=/opt/android
ENV NDK_VERSION=27.1.12297006

# Las herramientas de línea de comandos, que es lo único que hace falta para
# aceptar licencias e instalar el NDK.
RUN mkdir -p "${ANDROID_HOME}/cmdline-tools" \
  && curl -fsSL -o /tmp/tools.zip \
       https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip \
  && unzip -q /tmp/tools.zip -d "${ANDROID_HOME}/cmdline-tools" \
  && mv "${ANDROID_HOME}/cmdline-tools/cmdline-tools" "${ANDROID_HOME}/cmdline-tools/latest" \
  && rm /tmp/tools.zip

ENV PATH="${ANDROID_HOME}/cmdline-tools/latest/bin:${ANDROID_HOME}/platform-tools:${PATH}"

# El mismo NDK que usa la aplicación (`RNVideo_ndkversion`), para no mezclar.
RUN yes | sdkmanager --licenses > /dev/null \
  && sdkmanager --install "platform-tools" "platforms;android-35" "build-tools;35.0.0" "ndk;${NDK_VERSION}" > /dev/null

ENV NDK_PATH="${ANDROID_HOME}/ndk/${NDK_VERSION}"

COPY construir.sh /construir.sh
RUN chmod +x /construir.sh

CMD ["/construir.sh"]
