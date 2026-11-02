# CMeIn's MCP server: a small service with its own image, sharing nothing with the product app at
# runtime. It reaches cmein.com only through its public API.
FROM node:22-slim AS build

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src
RUN npx tsc

# Drop the toolchain: the image that ships carries the compiled output and production deps only.
FROM node:22-slim

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY --from=build /app/dist ./dist

# Not root. Nothing here needs to be.
USER node

EXPOSE 8000
ENV PORT=8000

# The blog index is built at boot, so a container that is up but empty is not yet ready. /health
# says 503 until the articles are in, which is what the platform's probe should be reading.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
