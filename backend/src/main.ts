import { NestFactory } from '@nestjs/core';
import { json, type NextFunction, type Request, type Response } from 'express';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import cookieParser from 'cookie-parser';

import { withQueryTags } from '@prisma/sqlcommenter-query-tags';
import { AppModule } from './app.module.js';
import dotenv from 'dotenv';
import { createRequestId } from './logging/request-id.js';

dotenv.config();

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
    bodyParser: false,
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));

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
      (req as Request & { id?: string }).id ?? createRequestId(req);
    const requestPath =
      req.path ?? req.originalUrl?.split('?')[0] ?? 'unknown-route';
    const route = requestPath.replace(
      /(\/checkout\/)[^/]+(?=\/|$)/,
      '$1:token',
    );

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
