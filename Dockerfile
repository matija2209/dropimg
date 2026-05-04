# Stage 1: Build Frontend
FROM node:24 AS web-builder
WORKDIR /app
COPY package*.json ./
COPY apps/web/package*.json ./apps/web/
RUN npm install
COPY apps/web ./apps/web
RUN cd apps/web && npm run build

# Stage 2: Build Backend
FROM node:24 AS api-builder
WORKDIR /app
COPY package*.json ./
COPY apps/api/package*.json ./apps/api/
RUN npm install
COPY apps/api ./apps/api
RUN cd apps/api && npm run build

# Stage 3: Production
FROM node:24-slim
RUN apt-get update && apt-get install -y python3 make g++ libimage-exiftool-perl && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
COPY apps/api/package*.json ./apps/api/
RUN npm install --omit=dev

COPY --from=api-builder /app/apps/api/dist ./dist
COPY --from=api-builder /app/apps/api/drizzle ./drizzle
COPY --from=web-builder /app/apps/web/dist ./public

# Create data directory
RUN mkdir -p /data/uploads

ENV PORT=3000
ENV DATABASE_URL=file:/data/app.sqlite
ENV UPLOAD_DIR=/data/uploads

EXPOSE 3000
CMD ["node", "dist/index.js"]
