import 'reflect-metadata';
import { config as loadDotEnv } from 'dotenv';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { envFromProcess, parseListenPort } from './process-env';
import { applyPlatform } from './http/platform';
import { logger } from './core/logging';

const DEFAULT_PORT = 8081;

loadDotEnv({ override: false });

async function bootstrap(): Promise<void> {
  const port = parseListenPort(process.env.PORT, DEFAULT_PORT);
  const nest = await NestFactory.create(AppModule.register(envFromProcess()), {
    logger: ['error', 'warn'],
    bodyParser: false,
  });
  applyPlatform(nest);
  await nest.listen(port, '0.0.0.0');
  logger.info('http.listen', { port });
}

void bootstrap();
