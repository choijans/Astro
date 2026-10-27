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
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';
import { WorkerModule } from '../src/worker/worker.module';
import { pollCommand } from './e2e-helpers';

const fixturePath = join(__dirname, 'fixtures/astro-response.json');
const fixture = JSON.parse(
  readFileSync(fixturePath, 'utf-8'),
) as AstroSearchLinearResponse;
const fixtureChannels = fixture.response.channels.data;

/** ASTRO_LIST_CACHE_TTL_MS is 150ms in .env.test — every test waits a little
 * over that in beforeEach so it always starts from a cold cache, regardless
 * of what the previous test fetched. */
const CACHE_TTL_PLUS_MARGIN_MS = 200;

class FakeAstroClient implements IAstroClient {
  calls = 0;
  records: AstroChannelRecord[];

  constructor(records: AstroChannelRecord[]) {
    this.records = records;
  }

  async fetchChannels(): Promise<AstroChannelRecord[]> {
    this.calls += 1;
    // A small delay gives two near-simultaneous callers a real chance to
    // both land inside the single-flight window instead of trivially
    // serializing one after the other.
    await new Promise((resolve) => setTimeout(resolve, 50));
    return this.records;
  }
}

describe('REFRESH_CHANNEL (e2e)', () => {
  let app: INestApplication<App>;
  let workerApp: TestingModule;
  let prisma: PrismaService;
  let fakeAstroClient: FakeAstroClient;
  const userA = randomUUID();
  const userB = randomUUID();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    fakeAstroClient = new FakeAstroClient(structuredClone(fixtureChannels));

    // Nothing in this suite (API or worker) is allowed to reach the real
    // Astro API: the worker's ASTRO_CLIENT is overridden with the fake below,
    // and the API process never injects ASTRO_CLIENT at all.
    workerApp = await Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(ASTRO_CLIENT)
      .useValue(fakeAstroClient)
      .compile();
    await workerApp.init();
  });

  afterAll(async () => {
    await workerApp.close();
    await app.close();
  });

  beforeEach(async () => {
    await prisma.command.deleteMany();
    fakeAstroClient.records = structuredClone(fixtureChannels);
    fakeAstroClient.calls = 0;
    await new Promise((resolve) =>
      setTimeout(resolve, CACHE_TTL_PLUS_MARGIN_MS),
    );
  });

  it('POST /commands REFRESH_CHANNEL returns 202 PENDING, the worker runs it, and GET /channels/:id shows the new schedule and a newer scheduleUpdatedAt', async () => {
    const target = fixtureChannels[0];
    const before = await request(app.getHttpServer())
      .get(`/channels/${target.id}`)
      .expect(200);

    const newTitle = `${target.title} (refreshed)`;
    fakeAstroClient.records = fakeAstroClient.records.map((r) =>
      r.id === target.id ? { ...r, title: newTitle } : r,
    );

    const res = await request(app.getHttpServer())
      .post('/commands')
      .set('X-User-Id', userA)
      .send({ id: randomUUID(), type: 'REFRESH_CHANNEL', channelId: target.id })
      .expect(202);
    expect(res.body.status).toBe('PENDING');

    const settled = await pollCommand(app, userA, res.body.id);
    expect(settled.status).toBe('DONE');

    const after = await request(app.getHttpServer())
      .get(`/channels/${target.id}`)
      .expect(200);
    expect(after.body.title).toBe(newTitle);
    expect(new Date(after.body.scheduleUpdatedAt).getTime()).toBeGreaterThan(
      new Date(before.body.scheduleUpdatedAt).getTime(),
    );
  });

  it('two users refreshing the same channel at the same time make ONE call to the fake Astro client, and both commands end DONE', async () => {
    const target = fixtureChannels[1];

    const [resA, resB] = await Promise.all([
      request(app.getHttpServer())
        .post('/commands')
        .set('X-User-Id', userA)
        .send({
          id: randomUUID(),
          type: 'REFRESH_CHANNEL',
          channelId: target.id,
        }),
      request(app.getHttpServer())
        .post('/commands')
        .set('X-User-Id', userB)
        .send({
          id: randomUUID(),
          type: 'REFRESH_CHANNEL',
          channelId: target.id,
        }),
    ]);
    expect(resA.status).toBe(202);
    expect(resB.status).toBe(202);

    const [settledA, settledB] = await Promise.all([
      pollCommand(app, userA, resA.body.id),
      pollCommand(app, userB, resB.body.id),
    ]);
    expect(settledA.status).toBe('DONE');
    expect(settledB.status).toBe('DONE');
    expect(fakeAstroClient.calls).toBe(1);
  });

  it('returns 404 for an unknown channel without ever touching Astro', async () => {
    const callsBefore = fakeAstroClient.calls;
    const res = await request(app.getHttpServer())
      .post('/commands')
      .set('X-User-Id', userA)
      .send({ id: randomUUID(), type: 'REFRESH_CHANNEL', channelId: 999999 })
      .expect(404);
    expect(res.body.message).toMatch(/999999/);
    expect(fakeAstroClient.calls).toBe(callsBefore);
  });

  it('a channel missing from the fake Astro list ends FAILED with no retries', async () => {
    const target = fixtureChannels[2];
    fakeAstroClient.records = fakeAstroClient.records.filter(
      (r) => r.id !== target.id,
    );

    const res = await request(app.getHttpServer())
      .post('/commands')
      .set('X-User-Id', userA)
      .send({ id: randomUUID(), type: 'REFRESH_CHANNEL', channelId: target.id })
      .expect(202);

    const settled = await pollCommand(app, userA, res.body.id);
    expect(settled.status).toBe('FAILED');
    expect(settled.error).toMatch(new RegExp(String(target.id)));

    const stored = await prisma.command.findUniqueOrThrow({
      where: { id: res.body.id },
    });
    expect(stored.attempts).toBe(1);
  });

  it("refreshing one channel never touches another channel's row", async () => {
    const target = fixtureChannels[3];
    const other = fixtureChannels[4];
    const otherBefore = await prisma.channel.findUniqueOrThrow({
      where: { id: other.id },
    });

    fakeAstroClient.records = fakeAstroClient.records.map((r) =>
      r.id === target.id ? { ...r, title: `${r.title} (changed)` } : r,
    );

    const res = await request(app.getHttpServer())
      .post('/commands')
      .set('X-User-Id', userA)
      .send({ id: randomUUID(), type: 'REFRESH_CHANNEL', channelId: target.id })
      .expect(202);
    await pollCommand(app, userA, res.body.id);

    const otherAfter = await prisma.channel.findUniqueOrThrow({
      where: { id: other.id },
    });
    expect(otherAfter).toEqual(otherBefore);
  });

  it('a refresh carrying an older snapshot than what is already stored ends DONE without overwriting the newer data', async () => {
    const target = fixtureChannels[5];

    // Simulate "a newer refresh already applied": scheduleUpdatedAt set into
    // the future, well past whatever "now" this test's own Astro fetch will
    // use as its fetchedAt.
    const newerTitle = `${target.title} (already newer)`;
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await prisma.channel.update({
      where: { id: target.id },
      data: { title: newerTitle, scheduleUpdatedAt: future },
    });

    // This command's own fetch would carry yet another title — if applied,
    // it would wrongly roll the channel back to older data.
    fakeAstroClient.records = fakeAstroClient.records.map((r) =>
      r.id === target.id ? { ...r, title: `${r.title} (stale)` } : r,
    );

    const res = await request(app.getHttpServer())
      .post('/commands')
      .set('X-User-Id', userA)
      .send({ id: randomUUID(), type: 'REFRESH_CHANNEL', channelId: target.id })
      .expect(202);

    const settled = await pollCommand(app, userA, res.body.id);
    expect(settled.status).toBe('DONE');

    const after = await prisma.channel.findUniqueOrThrow({
      where: { id: target.id },
    });
    expect(after.title).toBe(newerTitle);
    expect(after.scheduleUpdatedAt.getTime()).toBe(future.getTime());
  });
});
