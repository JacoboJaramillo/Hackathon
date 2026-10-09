# Build stage: full dependencies to compile Next.js.
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && npm prune --omit=dev

# Runtime stage: production dependencies only, non-root user, no secrets in
# layers (keys arrive as env vars from Secret Manager at deploy time).
FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/server.mjs /app/next.config.mjs ./
COPY --from=build --chown=node:node /app/server ./server
USER node
EXPOSE 8080
ENV PORT=8080
CMD ["node", "server.mjs"]
