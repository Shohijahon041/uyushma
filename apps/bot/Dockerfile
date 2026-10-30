FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY apps/worker/package.json ./apps/worker/package.json
COPY apps/bot/package.json ./apps/bot/package.json
RUN npm ci --no-audit --no-fund --workspace @uyushma/bot --include-workspace-root

COPY apps/bot ./apps/bot
RUN npm run build -w @uyushma/bot

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/apps/bot/package.json ./apps/bot/package.json
COPY --from=build /app/apps/bot/dist ./apps/bot/dist

WORKDIR /app/apps/bot
USER node
CMD ["node", "dist/index.js"]
