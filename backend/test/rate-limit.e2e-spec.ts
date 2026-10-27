import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getOptionsToken } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';

/** .env.test sets a very high RATE_LIMIT_MAX so every other e2e suite never
 * trips the limiter; this file overrides THROTTLER_OPTIONS directly (rather
 * than mutating process.env, which wouldn't apply in time — ES imports are
 * hoisted above any same-file assignment) to get a small, fast limit/window
 * of its own. */
const SMALL_LIMIT = 3;
const SMALL_TTL_MS = 1000;

describe('Rate limiting (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let channelId: number;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(getOptionsToken())
      .useValue([{ ttl: SMALL_TTL_MS, limit: SMALL_LIMIT }])
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    const channel = await prisma.channel.findFirstOrThrow({
      orderBy: { id: 'asc' },
    });
    channelId = channel.id;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await prisma.command.deleteMany();
    await prisma.favourite.deleteMany();
  });

  it('POST /commands returns 429 in the standard error shape with a Retry-After header after the limit', async () => {
    const userId = randomUUID();
    for (let i = 0; i < SMALL_LIMIT; i++) {
      await request(app.getHttpServer())
        .post('/commands')
        .set('X-User-Id', userId)
        .send({ id: randomUUID(), type: 'ADD_FAVORITE', channelId })
        .expect(202);
    }

    const res = await request(app.getHttpServer())
      .post('/commands')
      .set('X-User-Id', userId)
      .send({ id: randomUUID(), type: 'ADD_FAVORITE', channelId })
      .expect(429);

    expect(res.body).toEqual({
      statusCode: 429,
      message: 'Too many requests. Please wait a moment and try again.',
      error: 'Too Many Requests',
    });
    expect(res.headers['retry-after']).toBeDefined();
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('POST /favourites returns 429 after the limit', async () => {
    const userId = randomUUID();
    for (let i = 0; i < SMALL_LIMIT; i++) {
      await request(app.getHttpServer())
        .post('/favourites')
        .set('X-User-Id', userId)
        .send({ channelId })
        .expect(202);
    }

    await request(app.getHttpServer())
      .post('/favourites')
      .set('X-User-Id', userId)
      .send({ channelId })
      .expect(429);
  });

  it('DELETE /favourites/:channelId returns 429 after the limit', async () => {
    const userId = randomUUID();
    for (let i = 0; i < SMALL_LIMIT; i++) {
      await request(app.getHttpServer())
        .delete(`/favourites/${channelId}`)
        .set('X-User-Id', userId)
        .expect(202);
    }

    await request(app.getHttpServer())
      .delete(`/favourites/${channelId}`)
      .set('X-User-Id', userId)
      .expect(429);
  });

  it('two different users have separate counters on the same route', async () => {
    const userA = randomUUID();
    const userB = randomUUID();

    for (let i = 0; i < SMALL_LIMIT; i++) {
      await request(app.getHttpServer())
        .post('/commands')
        .set('X-User-Id', userA)
        .send({ id: randomUUID(), type: 'ADD_FAVORITE', channelId })
        .expect(202);
    }
    await request(app.getHttpServer())
      .post('/commands')
      .set('X-User-Id', userA)
      .send({ id: randomUUID(), type: 'ADD_FAVORITE', channelId })
      .expect(429);

    // userB's own counter is untouched by userA's requests.
    await request(app.getHttpServer())
      .post('/commands')
      .set('X-User-Id', userB)
      .send({ id: randomUUID(), type: 'ADD_FAVORITE', channelId })
      .expect(202);
  });

  it('the window resets once it elapses', async () => {
    const userId = randomUUID();
    for (let i = 0; i < SMALL_LIMIT; i++) {
      await request(app.getHttpServer())
        .post('/commands')
        .set('X-User-Id', userId)
        .send({ id: randomUUID(), type: 'ADD_FAVORITE', channelId })
        .expect(202);
    }
    await request(app.getHttpServer())
      .post('/commands')
      .set('X-User-Id', userId)
      .send({ id: randomUUID(), type: 'ADD_FAVORITE', channelId })
      .expect(429);

    await new Promise((resolve) => setTimeout(resolve, SMALL_TTL_MS + 250));

    await request(app.getHttpServer())
      .post('/commands')
      .set('X-User-Id', userId)
      .send({ id: randomUUID(), type: 'ADD_FAVORITE', channelId })
      .expect(202);
  }, 10000);

  it('GET /channels is never rate limited, even well above the configured limit', async () => {
    for (let i = 0; i < SMALL_LIMIT * 5; i++) {
      await request(app.getHttpServer()).get('/channels').expect(200);
    }
  });
});
