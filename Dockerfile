# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS backend
WORKDIR /app

COPY backend/package*.json ./backend/
WORKDIR /app/backend
RUN npm ci --no-audit --no-fund

COPY backend/. ./
RUN npx prisma generate --config prisma7.config.ts

EXPOSE 3000
CMD ["npm", "run", "start:dev"]
