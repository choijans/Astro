import type { Redis } from 'ioredis';
import type { PrismaService } from '../prisma/prisma.service';
import { HealthService } from './health.service';

function makePrisma(impl: () => Promise<unknown>): PrismaService {
  return { $queryRaw: jest.fn(impl) } as unknown as PrismaService;
}

function makeRedis(impl: () => Promise<unknown>): Redis {
  return { ping: jest.fn(impl) } as unknown as Redis;
}

function neverResolves(): Promise<never> {
  return new Promise(() => {});
}

describe('HealthService.check', () => {
  it('reports both up when the database and Redis both succeed', async () => {
    const prisma = makePrisma(() => Promise.resolve([{ '?column?': 1 }]));
    const redis = makeRedis(() => Promise.resolve('PONG'));
    const service = new HealthService(prisma, redis, 2000);

    await expect(service.check()).resolves.toEqual({
      database: 'up',
      redis: 'up',
    });
  });

  it('reports the database down when its query rejects, without affecting the Redis result', async () => {
    const prisma = makePrisma(() =>
      Promise.reject(new Error('connection refused')),
    );
    const redis = makeRedis(() => Promise.resolve('PONG'));
    const service = new HealthService(prisma, redis, 2000);

    await expect(service.check()).resolves.toEqual({
      database: 'down',
      redis: 'up',
    });
  });

  it('reports Redis down when ping rejects, without affecting the database result', async () => {
    const prisma = makePrisma(() => Promise.resolve([{ '?column?': 1 }]));
    const redis = makeRedis(() => Promise.reject(new Error('ECONNREFUSED')));
    const service = new HealthService(prisma, redis, 2000);

    await expect(service.check()).resolves.toEqual({
      database: 'up',
      redis: 'down',
    });
  });

  it('reports both down when both fail', async () => {
    const prisma = makePrisma(() =>
      Promise.reject(new Error('connection refused')),
    );
    const redis = makeRedis(() => Promise.reject(new Error('ECONNREFUSED')));
    const service = new HealthService(prisma, redis, 2000);

    await expect(service.check()).resolves.toEqual({
      database: 'down',
      redis: 'down',
    });
  });

  it('reports a check down when it never settles within the timeout, instead of hanging', async () => {
    const prisma = makePrisma(neverResolves);
    const redis = makeRedis(() => Promise.resolve('PONG'));
    // A short timeout keeps this test fast without waiting out the real
    // (2000ms default) health-check timeout.
    const service = new HealthService(prisma, redis, 20);

    await expect(service.check()).resolves.toEqual({
      database: 'down',
      redis: 'up',
    });
  });
});
