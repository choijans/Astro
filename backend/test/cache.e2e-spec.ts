import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { ASTRO_CLIENT } from '../src/astro/astro-client.interface';
import type { IAstroClient } from '../src/astro/astro-client.interface';
import type {
  AstroChannelRecord,
  AstroSearchLinearResponse,
} from '../src/astro/astro.types';
import { CACHE_REDIS_CLIENT } from '../src/common/cache/cache.tokens';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';
import { WorkerModule } from '../src/worker/worker.module';
import { pollCommand } from './e2e-helpers';
import type { Channel } from '../generated/prisma/client';

const fixturePath = join(__dirname, 'fixtures/astro-response.json');
const fixture = JSON.parse(
  readFileSync(fixturePath, 'utf-8'),
) as AstroSearchLinearResponse;
const fixtureChannels = fixture.response.channels.data;

class FakeAstroClient implements IAstroClient {
  constructor(public records: AstroChannelRecord[]) {}

  fetchChannels(): Promise<AstroChannelRecord[]> {
    return Promise.resolve(this.records);
  }
}

/**
 * .env.test sets CACHE_ENABLED=false so every other e2e/outage suite is
 * unaffected by caching. CacheService reads it live on every call, so it's
 * safe to flip at runtime here rather than needing a dedicated app instance
 * — but since `test:e2e` runs all files in one process (maxWorkers: 1) and
 * env vars are process-global, this must be restored afterwards so it
 * doesn't leak into files that run after this one.
 */
describe('Redis response caching (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const originalCacheEnabled = process.env.CACHE_ENABLED;

  beforeAll(async () => {
    process.env.CACHE_ENABLED = 'true';
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
    process.env.CACHE_ENABLED = originalCacheEnabled;
  });

  describe('GET /channels (list)', () => {
    it('is a MISS, then an identical repeat request is a HIT with an equal body', async () => {
      const first = await request(app.getHttpServer())
        .get('/channels')
        .query({ q: 'cache-test-list-a' })
        .expect(200);
      expect(first.headers['x-cache']).toBe('MISS');

      const second = await request(app.getHttpServer())
        .get('/channels')
        .query({ q: 'cache-test-list-a' })
        .expect(200);
      expect(second.headers['x-cache']).toBe('HIT');
      expect(second.body).toEqual(first.body);
    });

    it('a different query is its own MISS', async () => {
      const res = await request(app.getHttpServer())
        .get('/channels')
        .query({ q: 'cache-test-list-b' })
        .expect(200);
      expect(res.headers['x-cache']).toBe('MISS');
    });

    it('the same filters in a different parameter order hit the same cache entry', async () => {
      const first = await request(app.getHttpServer())
        .get('/channels')
        .query({ q: 'cache-test-list-c', sort: 'title', order: 'desc' })
        .expect(200);
      expect(first.headers['x-cache']).toBe('MISS');

      const second = await request(app.getHttpServer())
        .get('/channels')
        .query({ order: 'desc', sort: 'title', q: 'cache-test-list-c' })
        .expect(200);
      expect(second.headers['x-cache']).toBe('HIT');
      expect(second.body).toEqual(first.body);
    });
  });

  describe('GET /channels/:id (detail)', () => {
    it('is a MISS, then an identical repeat request is a HIT with an equal body', async () => {
      const target = fixtureChannels[20];

      const first = await request(app.getHttpServer())
        .get(`/channels/${target.id}`)
        .expect(200);
      expect(first.headers['x-cache']).toBe('MISS');

      const second = await request(app.getHttpServer())
        .get(`/channels/${target.id}`)
        .expect(200);
      expect(second.headers['x-cache']).toBe('HIT');
      expect(second.body).toEqual(first.body);
    });

    it('a 404 for an unknown channel is never cached and sets no X-Cache header', async () => {
      const res = await request(app.getHttpServer())
        .get('/channels/999999999')
        .expect(404);
      expect(res.headers['x-cache']).toBeUndefined();
    });
  });

  it('CACHE_ENABLED=false gives no X-Cache header at all', async () => {
    process.env.CACHE_ENABLED = 'false';
    try {
      const target = fixtureChannels[21];
      const res = await request(app.getHttpServer())
        .get(`/channels/${target.id}`)
        .expect(200);
      expect(res.headers['x-cache']).toBeUndefined();
    } finally {
      process.env.CACHE_ENABLED = 'true';
    }
  });

  describe('fail-open when the cache backend errors', () => {
    let brokenApp: INestApplication<App>;

    beforeAll(async () => {
      const brokenRedis = {
        get: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
        set: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
        del: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
        quit: jest.fn().mockResolvedValue('OK'),
        on: jest.fn(),
      };
      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(CACHE_REDIS_CLIENT)
        .useValue(brokenRedis)
        .compile();
      brokenApp = moduleFixture.createNestApplication();
      configureApp(brokenApp);
      await brokenApp.init();
    });

    afterAll(async () => {
      await brokenApp.close();
    });

    it('GET /channels still returns 200 from the database when the cache errors on every call', async () => {
      const res = await request(brokenApp.getHttpServer())
        .get('/channels')
        .expect(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('GET /channels/:id still returns 200 from the database when the cache errors on every call', async () => {
      const target = fixtureChannels[22];
      const res = await request(brokenApp.getHttpServer())
        .get(`/channels/${target.id}`)
        .expect(200);
      expect(res.body.id).toBe(target.id);
    });
  });

  describe('detail cache invalidation on REFRESH_CHANNEL', () => {
    let workerApp: TestingModule;
    let fakeAstroClient: FakeAstroClient;
    let originalRow: Channel;
    const userId = randomUUID();
    const target = fixtureChannels[23];

    beforeAll(async () => {
      originalRow = await prisma.channel.findUniqueOrThrow({
        where: { id: target.id },
      });
      fakeAstroClient = new FakeAstroClient(structuredClone(fixtureChannels));
      workerApp = await Test.createTestingModule({ imports: [WorkerModule] })
        .overrideProvider(ASTRO_CLIENT)
        .useValue(fakeAstroClient)
        .compile();
      await workerApp.init();
    });

    afterAll(async () => {
      await workerApp.close();
      // Restores the row mutated below so later e2e files (which also read
      // from this same, suite-wide seeded fixture data) see it unchanged.
      await prisma.channel.update({
        where: { id: target.id },
        data: {
          title: originalRow.title,
          schedule: originalRow.schedule,
          scheduleUpdatedAt: originalRow.scheduleUpdatedAt,
        },
      });
    });

    it('detail HIT, then REFRESH_CHANNEL invalidates it, and the next GET is a MISS showing new data followed by a HIT', async () => {
      const before = await request(app.getHttpServer())
        .get(`/channels/${target.id}`)
        .expect(200);
      expect(before.headers['x-cache']).toBe('MISS');

      const beforeAgain = await request(app.getHttpServer())
        .get(`/channels/${target.id}`)
        .expect(200);
      expect(beforeAgain.headers['x-cache']).toBe('HIT');
      expect(beforeAgain.body).toEqual(before.body);

      const newTitle = `${target.title} (refreshed)`;
      fakeAstroClient.records = fakeAstroClient.records.map((r) =>
        r.id === target.id ? { ...r, title: newTitle } : r,
      );

      const commandRes = await request(app.getHttpServer())
        .post('/commands')
        .set('X-User-Id', userId)
        .send({
          id: randomUUID(),
          type: 'REFRESH_CHANNEL',
          channelId: target.id,
        })
        .expect(202);
      const settled = await pollCommand(app, userId, commandRes.body.id);
      expect(settled.status).toBe('DONE');

      const after = await request(app.getHttpServer())
        .get(`/channels/${target.id}`)
        .expect(200);
      expect(after.headers['x-cache']).toBe('MISS');
      expect(after.body.title).toBe(newTitle);

      const afterAgain = await request(app.getHttpServer())
        .get(`/channels/${target.id}`)
        .expect(200);
      expect(afterAgain.headers['x-cache']).toBe('HIT');
      expect(afterAgain.body).toEqual(after.body);
    });
  });
});
