# Chokepoint application (§16.1 local-first, fixture mode: no credentials).
# Multi-stage: build the static app, ship it with the production server.
FROM node:24-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
# Runtime deps only; tsx is installed explicitly (it is a devDependency used
# as the server runtime).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm install --no-save tsx@4
COPY --from=build /repo/dist ./dist
COPY --from=build /repo/tests/fixtures ./tests/fixtures
COPY --from=build /repo/src ./src
COPY --from=build /repo/scripts ./scripts
COPY --from=build /repo/tsconfig.json ./
COPY --from=build /repo/vite.config.ts ./
EXPOSE 8787
CMD ["npx", "tsx", "scripts/serve.ts"]
