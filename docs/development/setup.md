# Development Setup

This document describes the setup used by the current Solaris Malawi repository.

## 1. Current stack

| Component | Technology |
|---|---|
| Runtime | Node.js 24 |
| Language | TypeScript |
| Backend | NestJS 12 |
| Database | PostgreSQL |
| ORM | Prisma 7 |
| Cache / infrastructure | Redis |
| Object storage | Cloudflare R2 |
| Testing | Vitest |
| Container orchestration | Docker Compose |

The project does not ship with a bundled PostgreSQL container in Docker Compose. The application expects a reachable database configured through `DATABASE_URL`.

## 2. Prerequisites

Install:

- Node.js 24+
- npm
- Git
- Docker and Docker Compose
- PostgreSQL access for the configured `DATABASE_URL`

Verify:

```bash
node --version
npm --version
git --version
docker --version
docker compose version
```

## 3. Clone and install

```bash
git clone https://github.com/KelvinJustin/Solaris-Malawi.git
cd Solaris-Malawi
npm install
```

## 4. Environment configuration

Create a local `.env` file from the repo example:

```bash
cp .env.example .env
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

At minimum, the app uses the following configuration keys from `.env.example`:

```env
PORT=3000
NODE_ENV=development
DATABASE_URL="postgresql://user:password@localhost:5432/Solaris?schema=public"
JWT_SECRET=REPLACE_WITH_A_RANDOM_SECRET
OTP_SECRET=REPLACE_WITH_A_SEPARATE_RANDOM_SECRET
ENCRYPTION_SALT=12
SMTP_SERVER=127.0.0.1
SMTP_PORT=1025
SMTP_USER=
SMTP_API_KEY=
SMTP_FROM="Solaris Malawi <no-reply@Solaris.local>"
ARCJET_KEY=REPLACE_WITH_YOUR_ARCJET_KEY
R2_ACCOUNT_ID="your-cloudflare-account-id"
R2_ACCESS_KEY_ID="your-r2-access-key"
R2_SECRET_ACCESS_KEY="your-r2-secret-key"
R2_BUCKET_NAME="solaris-kyc-documents"
CHECKOUT_TOKEN_ENCRYPTION_KEY=REPLACE_WITH_A_GENERATED_BASE64_KEY
CHECKOUT_BASE_URL=http://localhost:3000/v1
TEST_PROVIDER_BASE_URL=https://solaris-test-provider.onrender.com
SIGNING_SECRET=REPLACE_WITH_A_SIGNING_SECRET
```

Never commit `.env` or real secrets.

## 5. Prisma and database setup

Generate the Prisma client:

```bash
npx prisma generate
```

Apply migrations:

```bash
npx prisma migrate deploy
```

If the schema has changed during development, create a migration with:

```bash
npx prisma migrate dev --name <migration_name>
```

## 6. Run the app without Docker

```bash
npm run start:dev
```

The server runs on the configured port, usually `http://localhost:3000`.

## 7. Run with Docker Compose

This repo includes a Docker Compose setup for Redis and the API:

```bash
docker compose up --build
```

The Compose file exposes:

- API on `3000`
- Redis on `6379`

The API container still depends on the host environment to reach a PostgreSQL instance through `DATABASE_URL`.

Useful commands:

```bash
docker compose ps
docker compose logs -f api
docker compose logs -f redis
docker compose down
docker compose down -v
```

## 8. Typical workflow

```bash
git pull
npm install
cp .env.example .env
npx prisma generate
npm run test
npm run start:dev
```

## 9. Testing and quality checks

```bash
npm run test
npm run test:watch
npm run test:cov
npm run test:e2e
npm run build
```

The backend uses Vitest, but the project still benefits from broader integration tests around database transactions, provider behavior, and callback edge cases.

## 10. Security and operational rules

Do not commit:

- `.env`
- database credentials
- provider credentials
- private keys
- API keys
- JWT or OTP secrets
- webhook signing secrets

If a secret is accidentally exposed, rotate it and remove it from the repository history before continuing.