import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { HEALTH_REDIS_CLIENT } from './health.tokens';

const DEFAULT_HEALTH_CHECK_TIMEOUT_MS = 2000;

export function getHealthCheckTimeoutMs(): number {
  const raw = process.env.HEALTH_CHECK_TIMEOUT_MS;
  return raw ? Number(raw) : DEFAULT_HEALTH_CHECK_TIMEOUT_MS;
}

export type CheckStatus = 'up' | 'down';

export interface HealthChecks {
  database: CheckStatus;
  redis: CheckStatus;
}

/**
 * Each dependency gets its own timeout so one hanging check can never make
 * the whole endpoint hang. Only ever logs the real failure (which may
 * contain a hostname, connection string, or other detail not meant for a
 * public response) — check()'s return value, and therefore the HTTP
 * response, never carries more than "up" or "down" per dependency.
 */
@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(HEALTH_REDIS_CLIENT) private readonly redis: Redis,
    @Optional() private readonly timeoutMs: number = getHealthCheckTimeoutMs(),
  ) {}

  async check(): Promise<HealthChecks> {
    const [database, redis] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
    ]);
    return { database, redis };
  }

  private async checkDatabase(): Promise<CheckStatus> {
    try {
      await this.withTimeout(this.prisma.$queryRaw`SELECT 1`);
      return 'up';
    } catch (err) {
      this.logger.error(
        `Database health check failed: ${(err as Error).message}`,
      );
      return 'down';
    }
  }

  private async checkRedis(): Promise<CheckStatus> {
    try {
      await this.withTimeout(this.redis.ping());
      return 'up';
    } catch (err) {
      this.logger.error(`Redis health check failed: ${(err as Error).message}`);
      return 'down';
    }
  }

  /** Clears the fallback timer regardless of which side wins the race — a
   * bare Promise.race([promise, timeoutPromise]) leaves the timer running
   * (and the health check reachable via a stale closure) for the rest of
   * timeoutMs every time the real check wins, which adds up fast on an
   * endpoint a load balancer might poll every few seconds. */
  private withTimeout<T>(promise: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Health check timed out')),
        this.timeoutMs,
      );
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (err: unknown) => {
          clearTimeout(timer);
          reject(err instanceof Error ? err : new Error(String(err)));
        },
      );
    });
  }
}
