import type { INestApplication } from '@nestjs/common';
import { json, urlencoded } from 'express';
import { requestContextMiddleware } from './request-context';

const MAX_JSON_BYTES = '2mb';

export function applyPlatform(app: INestApplication): void {
  app.use(json({ limit: MAX_JSON_BYTES }));
  app.use(urlencoded({ extended: false, limit: MAX_JSON_BYTES }));
  app.use(requestContextMiddleware);
  app.enableCors({
    origin: false,
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-ID'],
    exposedHeaders: ['X-Request-ID'],
  });
}
