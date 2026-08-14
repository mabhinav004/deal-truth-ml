import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import type { Env } from '../env';
import { applyPlatform } from './platform';

export interface HttpApp {
  request(input: string, init?: RequestInit): Promise<Response>;
  close(): Promise<void>;
}

export async function createApp(env: Env): Promise<HttpApp> {
  const nest = await NestFactory.create(AppModule.register(env), {
    logger: false,
    bodyParser: false,
  });
  applyPlatform(nest);
  await nest.listen(0, '127.0.0.1');
  const address = nest.getHttpServer().address();
  if (!address || typeof address === 'string') {
    await nest.close();
    throw new Error('Failed to bind test server.');
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    async request(input: string, init?: RequestInit): Promise<Response> {
      const url = new URL(input, baseUrl);
      return fetch(`${baseUrl}${url.pathname}${url.search}`, init);
    },
    close: () => nest.close(),
  };
}
