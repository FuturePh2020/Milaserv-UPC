import { Module } from '@nestjs/common';
import { AppConfigModule } from './core/config/config.module';
import { HealthController } from './core/health/health.controller';

@Module({
  imports: [AppConfigModule],
  controllers: [HealthController],
})
export class AppModule {}
