# Build the web app, then run the API server, which also serves web/dist. Pattern from id-jag-standalone.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY web/package.json web/
COPY server/package.json server/
RUN npm ci
COPY web web
RUN npm run build -w web

# LOCAL DEMONSTRATION ONLY: the stub issuer used by docker-compose.yml. Not part of the app image.
FROM node:22-alpine AS stub
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY web/package.json web/
COPY server/package.json server/
RUN npm ci --omit=dev -w server && npm cache clean --force
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
ENV NODE_ENV=production PORT=8080 HOST=0.0.0.0 DATA_DIR=/data IDP=pf ALLOW_MOCK_SIGNIN=0
COPY package.json package-lock.json ./
COPY web/package.json web/
COPY server/package.json server/
RUN npm ci --omit=dev -w server && npm cache clean --force && mkdir -p /data && chown node:node /data
COPY server/src server/src
COPY --from=build /app/web/dist web/dist
USER node
EXPOSE 8080
CMD ["node", "server/src/index.js"]
