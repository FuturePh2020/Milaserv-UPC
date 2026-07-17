import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { json } from 'express';
import { AppModule } from './app.module';
import type { Env } from './core/config/env';
import { ENV } from './core/config/config.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const env = app.get<Env>(ENV);

  app.use(helmet());
  // Master-data imports (branches §16.1, leads §14.1) exceed express's 100kb default.
  app.use(json({ limit: '5mb' }));
  app.enableCors({ origin: env.CORS_ORIGIN.split(','), credentials: true });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.enableShutdownHooks();

  await app.listen(env.API_PORT);
  console.log(`Milaserv360 API listening on :${env.API_PORT} (${env.NODE_ENV})`);
}

void bootstrap();
