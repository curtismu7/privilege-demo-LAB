# Privilege demo LAB in Docker (OrbStack). Build the web app, then run the API server, which also serves web/dist.
# The default image runs in mock mode: the mock issuer and every tool backend are in the process, and nothing leaves the container.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY web/package.json web/
COPY server/package.json server/
RUN npm ci --no-audit --no-fund
COPY web web
RUN npm run build -w web

# LOCAL DEMONSTRATION ONLY: the stub issuer behind docker compose --profile stub. Not part of the app image.
FROM node:22-alpine AS stub
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY web/package.json web/
COPY server/package.json server/
RUN npm ci --omit=dev -w server --no-audit --no-fund && npm cache clean --force
# The stub reads the chosen pack's personas (PACK), so it needs the pack folder and the two modules the packs import.
COPY server/src/auth/personas.js server/src/auth/personas.js
COPY server/src/mcp/backend.js server/src/mcp/backend.js
COPY server/src/cedar/engine.js server/src/cedar/engine.js
COPY server/src/packs server/src/packs
COPY stub-issuer stub-issuer
USER node
CMD ["node", "stub-issuer/server.mjs"]

# The app image (the last stage, so a plain `docker build .` produces it).
FROM node:22-alpine
WORKDIR /app
# HOST=0.0.0.0 is inside the container only; docker-compose.yml publishes the port on 127.0.0.1 and sets LAB_PUBLISH=loopback.
ENV NODE_ENV=production PORT=4510 HOST=0.0.0.0 DATA_DIR=/data
COPY package.json package-lock.json ./
COPY web/package.json web/
COPY server/package.json server/
RUN npm ci --omit=dev -w server --no-audit --no-fund && npm cache clean --force && mkdir -p /data && chown node:node /data
COPY server/src server/src
COPY --from=build /app/web/dist web/dist
USER node
EXPOSE 4510
CMD ["node", "server/src/index.js"]
