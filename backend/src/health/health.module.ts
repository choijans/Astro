import { Inject, Module, OnModuleDestroy } from '@nestjs/common';
import IORedis from 'ioredis';
import { PrismaModule } from '../prisma/prisma.module';
import { buildQueueConnectionOptions } from '../queue/queue.config';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { HEALTH_REDIS_CLIENT } from './health.tokens';

@Module({
  imports: [PrismaModule],
  controllers: [HealthController],
  providers: [
    HealthService,
    {
      provide: HEALTH_REDIS_CLIENT,
      useFactory: () => {
        const redis = new IORedis(buildQueueConnectionOptions());
        // ioredis emits 'error' on every failed (re)connect attempt; with no
        // listener, Node treats an unhandled 'error' event as fatal. A down
        // Redis must only ever degrade /health to 503, never crash the API.
        redis.on('error', () => {});
        return redis;
      },
    },
  ],
})
export class HealthModule implements OnModuleDestroy {
  constructor(@Inject(HEALTH_REDIS_CLIENT) private readonly redis: IORedis) {}

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit().catch(() => {});
  }
}
