import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { CLOCK } from '../src/common/clock';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';
import { WorkerModule } from '../src/worker/worker.module';
import { pollCommand } from './e2e-helpers';

/**
 * Fixed inside a real schedule window from the fixture: channel 622
 * ("Astro30") has "Kampong Pisang Berbuah Dua Kali" running
 * 2026-10-25T13:00:00+08:00 - 15:00:00+08:00, followed immediately by
 * "Walking With You S4 Ep04" 15:00:00+08:00 - 15:30:00+08:00. The clock below
 * is fixed at 2026-10-25T14:00:00+08:00 — inside the first show.
 */
const FIXED_NOW = new Date('2026-10-25T14:00:00+08:00');
const CHANNEL_ID = 622;
const EXPECTED_NOW_TITLE = 'Kampong Pisang Berbuah Dua Kali';
const EXPECTED_NEXT_TITLE = 'Walking With You S4 Ep04';

describe('now/next (e2e, clock fixed inside a real schedule window)', () => {
  let app: INestApplication<App>;
  let workerApp: TestingModule;
  let prisma: PrismaService;
  const userId = randomUUID();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(CLOCK)
      .useValue({ now: () => FIXED_NOW })
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    workerApp = await Test.createTestingModule({
      imports: [WorkerModule],
    }).compile();
    await workerApp.init();
  });

  afterAll(async () => {
    await prisma.favourite.deleteMany({ where: { userId } });
    await workerApp.close();
    await app.close();
  });

  it('GET /channels includes now and next, and never the full schedule', async () => {
    const res = await request(app.getHttpServer())
      .get('/channels')
      .query({ q: 'Astro30' })
      .expect(200);

    const item = res.body.data.find((c: { id: number }) => c.id === CHANNEL_ID);
    expect(item).toBeDefined();
    expect(item).not.toHaveProperty('schedule');
    expect(item.now).toMatchObject({ title: EXPECTED_NOW_TITLE });
    expect(item.next).toMatchObject({ title: EXPECTED_NEXT_TITLE });
  });

  it('GET /favourites includes now and next, and never the full schedule', async () => {
    const addRes = await request(app.getHttpServer())
      .post('/favourites')
      .set('X-User-Id', userId)
      .send({ channelId: CHANNEL_ID })
      .expect(202);

    await pollCommand(app, userId, addRes.body.id);

    const res = await request(app.getHttpServer())
      .get('/favourites')
      .set('X-User-Id', userId)
      .expect(200);

    const item = res.body.find((c: { id: number }) => c.id === CHANNEL_ID);
    expect(item).toBeDefined();
    expect(item).not.toHaveProperty('schedule');
    expect(item.now).toMatchObject({ title: EXPECTED_NOW_TITLE });
    expect(item.next).toMatchObject({ title: EXPECTED_NEXT_TITLE });
  });
});
