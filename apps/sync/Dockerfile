# Imagen del servidor de sincronización.
#
# No hay `npm install`: el servidor no tiene ni una dependencia externa, y los
# tres paquetes del monorepo que usa se copian directamente dentro de
# node_modules. Así la construcción no necesita red, no arrastra el
# react-native de apps/tv ni el electron del escritorio, y la imagen se queda
# en Node y unos cuantos ficheros de texto.
#
# El contexto de construcción es la raíz del repositorio, no esta carpeta:
#   docker compose -f apps/sync/compose.yaml build
FROM node:24-alpine

# Node ejecuta el TypeScript borrando los tipos, sin paso de compilación, que
# es como funciona todo el proyecto. Desde la 22.18 viene activado de serie.
WORKDIR /app

# Los paquetes compartidos, como si npm los hubiera enlazado.
COPY packages/core   /app/node_modules/@m3u/core
COPY packages/ui     /app/node_modules/@m3u/ui
COPY packages/storage /app/node_modules/@m3u/storage

# Y el servidor.
COPY apps/sync/package.json /app/package.json
COPY apps/sync/src /app/src

# Los datos van en un volumen: la imagen se puede tirar y reconstruir sin
# perder ni los grupos ni el historial de las casas.
ENV DATOS=/datos
ENV PUERTO=3300
VOLUME /datos

# Sin privilegios: la imagen de Node ya trae el usuario `node`.
RUN mkdir -p /datos && chown -R node:node /datos /app
USER node

EXPOSE 3300
CMD ["node", "src/index.ts"]
