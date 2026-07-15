import { Global, Module } from '@nestjs/common';
import type { Env } from './env';
import { loadEnv } from './env';

export const ENV = Symbol('ENV');

@Global()
@Module({
  providers: [{ provide: ENV, useFactory: (): Env => loadEnv() }],
  exports: [ENV],
})
export class AppConfigModule {}
