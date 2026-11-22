# ENTORNO DE LIBERACIÓN — la misma imagen corre en CI, en staging y en producción.
# Render la construye desde este archivo (render.yaml, runtime: docker).
#
# Local (PowerShell):  .\scripts\release-env.ps1
# A mano:              docker build -t ai-support-engine . ; docker run -p 3000:10000 ai-support-engine

# Versión exacta de Node, igual en todos los entornos.
FROM node:24.14.0-alpine

# HOST=0.0.0.0: dentro de un contenedor el servidor debe escuchar en todas las interfaces
# (en local escucha en 127.0.0.1). PORT=10000 es el puerto que espera Render.
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=10000

# Commit de esta imagen; lo reporta GET /health. En Render manda RENDER_GIT_COMMIT.
ARG APP_VERSION=local
ENV APP_VERSION=$APP_VERSION

WORKDIR /app

# Sin "npm install": el servidor no tiene dependencias. .dockerignore deja pasar solo
# package.json, src/ y el modelo ml exportado (sin pruebas, .env ni datos de entrenamiento).
COPY --chown=node:node . .

# Sin privilegios de root.
USER node

EXPOSE 10000

# Docker y CI usan este chequeo; Render usa su propio healthCheckPath (/health).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

# node directo (no npm start) para que el proceso reciba SIGTERM y Render pueda
# apagarlo limpio durante un despliegue sin tiempo de inactividad.
CMD ["node", "src/server.js"]
