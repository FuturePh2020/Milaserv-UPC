import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { ConfigModule, ConfigService } from "@nestjs/config";

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: new URL(config.get<string>("REDIS_URL") ?? "redis://localhost:6379").hostname,
          port: Number(new URL(config.get<string>("REDIS_URL") ?? "redis://localhost:6379").port || 6379),
        },
      }),
    }),
  ],
  exports: [BullModule],
})
export class BullmqRootModule {}
