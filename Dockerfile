FROM node:24

RUN apt-get update && apt-get install -y python3 make g++ libimage-exiftool-perl ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy all files
COPY . .

# Install all dependencies (including dev for building)
RUN npm install

# Build everything
RUN npm run build

# Final cleanup: remove dev dependencies to save space (optional, but safer to keep for now)
# RUN npm prune --production

# Data directory
RUN mkdir -p /data/uploads

ENV PORT=3000
ENV DATABASE_URL=file:/data/app.sqlite
ENV UPLOAD_DIR=/data/uploads

# Set the public directory for Hono to find the frontend build
# Note: Stage 1 build puts web dist into apps/web/dist
RUN cp -r apps/web/dist ./public

EXPOSE 3000
CMD ["node", "apps/api/dist/index.js"]
