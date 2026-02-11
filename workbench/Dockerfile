FROM node:22-alpine AS deps
WORKDIR /app

# Install scrapekit core deps
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev 2>/dev/null || npm install --omit=dev

# Install workbench deps
COPY workbench/package.json workbench/package-lock.json* ./workbench/
RUN cd workbench && (npm ci --omit=dev 2>/dev/null || npm install --omit=dev)

# Build stage
FROM node:22-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/workbench/node_modules ./workbench/node_modules
COPY . .

# Build frontend
RUN cd workbench && npx vite build

# Build server TypeScript
RUN cd workbench && npx tsc -p tsconfig.server.json

# Production stage
FROM node:22-alpine
WORKDIR /app

# Install Chromium for Puppeteer
RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/workbench/node_modules ./workbench/node_modules
COPY --from=builder /app/workbench/dist ./workbench/dist
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/workbench/drizzle.config.ts ./workbench/drizzle.config.ts
COPY --from=builder /app/workbench/src/db ./workbench/src/db

WORKDIR /app/workbench
EXPOSE 3000

CMD ["node", "dist/server/index.js"]
