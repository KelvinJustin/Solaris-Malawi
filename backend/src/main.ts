import { NestFactory } from '@nestjs/core';
import { json, type NextFunction, type Request, type Response } from 'express';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import crypto from 'node:crypto';
import { withQueryTags } from '@prisma/sqlcommenter-query-tags';
import { AppModule } from './app.module.js';
import dotenv from 'dotenv';

dotenv.config();

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
    bodyParser: false,
  });

  app.use(
    json({
      verify: (req: any, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );

  app.use(cookieParser());

  app.use((req: Request, res: Response, next: NextFunction) => {
    const requestId =
      (req.headers['x-request-id'] as string | undefined) ??
      crypto.randomUUID();
    const route = req.originalUrl?.split('?')[0] ?? req.url ?? 'unknown-route';

    return withQueryTags(
      {
        requestId,
        route,
        method: req.method,
      },
      async () => {
        next();
      },
    );
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Apply /v1 prefix to ALL routes globally
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
    prefix: 'v',
  });

  // Allow the React frontend to make requests with cookies.
  // FRONTEND_URL must be the EXACT origin of the frontend (no trailing slash).
  // `credentials: true` is required for the browser to send/accept cookies,
  // and it cannot be combined with origin '*'.
  app.enableCors({
    origin: process.env.FRONTEND_URL ?? 'http://localhost:5173',
    credentials: true,
  });

  await app.listen(process.env.PORT || 3000);
}

await bootstrap();
