FROM node:24-bookworm-slim

WORKDIR /app

# Install OpenSSL for Prisma
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# Install dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy source and generate Prisma client
COPY . .
RUN npx prisma generate

# Build the app
RUN npm run build

EXPOSE 3000

CMD ["npm", "run", "start:prod"]