import { Inject, Module, OnModuleDestroy } from '@nestjs/common';
import IORedis from 'ioredis';
import { buildCacheConnectionOptions } from './cache.config';
import { CacheService } from './cache.service';
import { CACHE_REDIS_CLIENT } from './cache.tokens';

@Module({
  providers: [
    {
      provide: CACHE_REDIS_CLIENT,
      useFactory: () => {
        const redis = new IORedis(buildCacheConnectionOptions());
        // Same rationale as HealthModule's dedicated client: an unhandled
        // 'error' event is fatal to the process, and a down cache must only
        // ever degrade to a miss, never crash the API or worker.
        redis.on('error', () => {});
        return redis;
      },
    },
    CacheService,
  ],
  exports: [CacheService],
})
export class CacheModule implements OnModuleDestroy {
  constructor(@Inject(CACHE_REDIS_CLIENT) private readonly redis: IORedis) {}

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit().catch(() => {});
  }
}
