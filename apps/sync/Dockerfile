# Imagen del servidor de sincronización.
#
# No hay `npm install`: el servidor no tiene ni una dependencia externa, y los
# tres paquetes del monorepo que usa entran por copia. Así la construcción no
# necesita red, no arrastra el react-native de apps/tv ni el electron del
# escritorio, y la imagen se queda en Node y unos cuantos ficheros de texto.
#
# El contexto de construcción es la raíz del repositorio, no esta carpeta:
#   docker compose -f apps/sync/compose.yaml build
FROM node:24-alpine

WORKDIR /app

# Los paquetes compartidos van **fuera** de node_modules, y se enlazan desde
# dentro. No es un capricho: Node ejecuta el TypeScript borrando los tipos,
# pero **se niega a hacerlo con ficheros que estén bajo node_modules**
# (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING), porque un paquete publicado
# debería traer JavaScript. Copiarlos ahí dentro rompe el arranque.
#
# Con el enlace no pasa: Node resuelve el enlace antes de cargar y ve la ruta
# real, /app/packages/..., que ya no está bajo node_modules. Es exactamente lo
# que hace npm con los workspaces en el repositorio, y por eso allí funciona.
COPY packages/core    /app/packages/core
COPY packages/ui      /app/packages/ui
COPY packages/storage /app/packages/storage

RUN mkdir -p /app/node_modules/@m3u \
 && ln -s ../../packages/core    /app/node_modules/@m3u/core \
 && ln -s ../../packages/ui      /app/node_modules/@m3u/ui \
 && ln -s ../../packages/storage /app/node_modules/@m3u/storage

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
