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
| Infrastructure service | Redis in Docker Compose (not currently used by backend modules) |
| Object storage | S3-compatible storage (MinIO locally; Cloudflare R2 in production) |
| Testing | Vitest |
| Container orchestration | Docker Compose |

The project does not ship with a bundled PostgreSQL container in Docker Compose. The application expects a reachable database configured through `DATABASE_URL`.

## 2. Prerequisites

Install:

- Node.js 24+
- npm
- Git
- Docker and Docker Compose (optional when running the API directly; needed to use the provided Compose setup)
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

Configure the required application, database, authentication, SMTP, object-storage, and checkout settings from `.env.example`. The following shows core application and NOWPayments settings; the example file also includes frontend/CORS, Redis, SMTP, and storage options:

```env
PORT=3000
NODE_ENV=development
DATABASE_URL="postgresql://user:password@localhost:5432/Solaris?schema=public"
FRONTEND_URL=http://localhost:5173
REDIS_HOST=localhost
REDIS_PORT=6379
JWT_SECRET=REPLACE_WITH_A_RANDOM_SECRET
OTP_SECRET=REPLACE_WITH_A_SEPARATE_RANDOM_SECRET
ENCRYPTION_SALT=12
SMTP_SERVER=127.0.0.1
SMTP_PORT=1025
SMTP_USER=
SMTP_API_KEY=
SMTP_FROM="Solaris Malawi <no-reply@Solaris.local>"
ARCJET_KEY=REPLACE_WITH_YOUR_ARCJET_KEY
R2_ENDPOINT=http://localhost:9000
R2_REGION=us-east-1
R2_FORCE_PATH_STYLE=true
R2_ACCOUNT_ID=local-minio
R2_ACCESS_KEY_ID=YOUR_S3_ACCESS_KEY
R2_SECRET_ACCESS_KEY=YOUR_S3_SECRET_KEY
R2_BUCKET_NAME="solaris-kyc-documents"
CHECKOUT_TOKEN_ENCRYPTION_KEY=REPLACE_WITH_A_GENERATED_BASE64_KEY
CHECKOUT_BASE_URL=http://localhost:3000/v1
TEST_PROVIDER_BASE_URL=https://solaris-test-provider.onrender.com
SIGNING_SECRET=REPLACE_WITH_A_SIGNING_SECRET
NOWPAYMENTS_API_KEY=REPLACE_WITH_YOUR_NOWPAYMENTS_API_KEY
NOWPAYMENTS_IPN_SECRET=REPLACE_WITH_YOUR_NOWPAYMENTS_IPN_SECRET
NOWPAYMENTS_BASE_URL=https://api-sandbox.nowpayments.io/v1
PUBLIC_API_BASE_URL=REPLACE_WITH_YOUR_PUBLIC_HTTPS_URL
NOWPAYMENTS_FEE_BPS=0
```

For local NOWPayments sandbox IPNs, `PUBLIC_API_BASE_URL` must be a publicly reachable HTTPS URL (for example, a temporary tunnel); localhost cannot receive provider callbacks. Sandbox and production use separate credentials and endpoints. Crypto transactions store the exact asset, network, and amount entered by the merchant. NOWPayments also requires a fiat `price_amount`; the backend gets a USD reference estimate from NOWPayments while passing the exact crypto amount as `pay_amount`. This reference does not convert the transaction or merchant balance to MWK. See [NOWPayments integration](../architecture/nowpaymentsIntegration.md) for the API flow and configuration details.

The example file documents local MinIO defaults and how to switch to Cloudflare R2. Never commit `.env` or real secrets.

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

The API container still depends on the host environment to reach a PostgreSQL instance through `DATABASE_URL`. Redis is a Compose dependency but is not currently used by backend code. Compose does not start PostgreSQL, MinIO, or an SMTP capture service. The example `.env` targets MinIO at `localhost:9000` and SMTP at `127.0.0.1:1025`; start those services separately or change the corresponding settings to reachable services.

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

The default Vitest suite uses mocks. PostgreSQL-backed ledger, settlement, and NOWPayments integration cases run with `npm run test:ledger:integration`; they require a dedicated test database and must never target development or production data. This suite does not validate live provider behavior or real-world bank/provider statement formats.

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