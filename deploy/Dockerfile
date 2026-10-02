# BitMine backend image: one image runs either the API or the worker (see docker-compose.yml).
# Build from the repository root:  docker build -f deploy/Dockerfile -t bitmine-backend .

FROM node:22-alpine AS build
WORKDIR /app
COPY backend/package.json backend/package-lock.json ./
RUN npm ci
COPY backend/tsconfig.json backend/tsconfig.build.json ./
COPY backend/src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
# The disposable-email list is read from ../data relative to dist/auth/.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY backend/package.json ./
COPY backend/data ./data
USER node
EXPOSE 4000
CMD ["node", "dist/server.js"]
