# syntax=docker/dockerfile:1
# Multi-stage build for the proispro Fastify/TS API.
# Stage 1 compiles TypeScript; stage 2 is a slim, non-root runtime.
# Build context is the api/ directory (see azure.yaml: service 'api', docker.context '.').

# ---- build ----
FROM node:20-slim AS build
WORKDIR /app

# Install all deps (incl. dev) to compile TS.
COPY package.json package-lock.json* ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Drop dev dependencies for the runtime image.
RUN npm prune --omit=dev

# ---- runtime ----
FROM node:20-slim AS runtime
ENV NODE_ENV=production
# ACA sets PORT; default matches infra/modules/containerapps.bicep (3000).
ENV PORT=3000
WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json

# Run as the built-in non-root 'node' user.
USER node

EXPOSE 3000
CMD ["node", "dist/server.js"]
