import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { COMMANDS_QUEUE } from '../src/queue/queue.module';
import { AddFavouriteHandler } from '../src/commands/handlers/add-favourite.handler';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';
import { WorkerModule } from '../src/worker/worker.module';
import { pollCommand } from './e2e-helpers';

function asUser(userId: string, req: request.Test): request.Test {
  return req.set('X-User-Id', userId);
}

describe('Favourites & Commands (e2e)', () => {
  let app: INestApplication<App>;
  let workerApp: TestingModule;
  let prisma: PrismaService;
  let channelId: number;

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

    const channel = await prisma.channel.findFirstOrThrow({
      orderBy: { id: 'asc' },
    });
    channelId = channel.id;

    workerApp = await Test.createTestingModule({
      imports: [WorkerModule],
    }).compile();
    await workerApp.init();
  });

  afterAll(async () => {
    await workerApp.close();
    await app.close();
  });

  // Favourites and commands are reset between tests; channels (seeded once by
  // pretest:e2e) are never touched, so re-seeding isn't needed per test.
  beforeEach(async () => {
    await prisma.command.deleteMany();
    await prisma.favourite.deleteMany();
  });

  describe('add then list', () => {
    it('adding a favourite makes it appear in the list, with the channel-list item shape', async () => {
      const addRes = await asUser(
        userA,
        request(app.getHttpServer()).post('/favourites').send({ channelId }),
      ).expect(202);
      expect(addRes.body.status).toBe('PENDING');
      expect(addRes.body.channelId).toBe(channelId);

      const settled = await pollCommand(app, userA, addRes.body.id);
      expect(settled.status).toBe('DONE');

      const listRes = await asUser(
        userA,
        request(app.getHttpServer()).get('/favourites'),
      ).expect(200);
      expect(listRes.body).toHaveLength(1);
      expect(listRes.body[0].id).toBe(channelId);
      expect(listRes.body[0]).not.toHaveProperty('schedule');
    });
  });

  it('duplicate add with the same command id gives one favourite row, one command row, and one BullMQ job', async () => {
    const commandId = randomUUID();

    await asUser(
      userA,
      request(app.getHttpServer())
        .post('/favourites')
        .send({ channelId })
        .set('X-Command-Id', commandId),
    ).expect(202);
    await asUser(
      userA,
      request(app.getHttpServer())
        .post('/favourites')
        .send({ channelId })
        .set('X-Command-Id', commandId),
    ).expect(202);

    await pollCommand(app, userA, commandId);

    const favouriteCount = await prisma.favourite.count({
      where: { userId: userA, channelId },
    });
    const commandCount = await prisma.command.count({
      where: { id: commandId },
    });
    expect(favouriteCount).toBe(1);
    expect(commandCount).toBe(1);

    const queue = app.get<Queue>(COMMANDS_QUEUE);
    const job = await queue.getJob(commandId);
    expect(job).not.toBeNull();
    expect(job?.id).toBe(commandId);
  });

  it('two identical requests sent in parallel (same command id) still produce one favourite and one command', async () => {
    const commandId = randomUUID();
    const sendOnce = () =>
      asUser(
        userA,
        request(app.getHttpServer())
          .post('/favourites')
          .send({ channelId })
          .set('X-Command-Id', commandId),
      );

    const [resA, resB] = await Promise.all([sendOnce(), sendOnce()]);

    // Whichever one lost the race gets the same command back, not an error.
    expect(resA.status).toBe(202);
    expect(resB.status).toBe(202);
    expect(resA.body.id).toBe(commandId);
    expect(resB.body.id).toBe(commandId);

    await pollCommand(app, userA, commandId);

    const favouriteCount = await prisma.favourite.count({
      where: { userId: userA, channelId },
    });
    const commandCount = await prisma.command.count({
      where: { id: commandId },
    });
    expect(favouriteCount).toBe(1);
    expect(commandCount).toBe(1);
  });

  it('invalid X-Command-Id header gives 400', async () => {
    await asUser(
      userA,
      request(app.getHttpServer())
        .post('/favourites')
        .send({ channelId })
        .set('X-Command-Id', 'not-a-uuid'),
    ).expect(400);
  });

  it('remove when absent succeeds', async () => {
    const res = await asUser(
      userA,
      request(app.getHttpServer()).delete(`/favourites/${channelId}`),
    ).expect(202);
    expect(res.body.status).toBe('PENDING');
    const settled = await pollCommand(app, userA, res.body.id);
    expect(settled.status).toBe('DONE');
  });

  it('unknown channel gives 404', async () => {
    const res = await asUser(
      userA,
      request(app.getHttpServer())
        .post('/favourites')
        .send({ channelId: 999999 }),
    ).expect(404);
    expect(res.body).toMatchObject({ statusCode: 404, error: 'Not Found' });
  });

  it('missing X-User-Id gives 400', async () => {
    const res = await request(app.getHttpServer())
      .get('/favourites')
      .expect(400);
    expect(res.body.statusCode).toBe(400);
  });

  it('invalid X-User-Id gives 400', async () => {
    await request(app.getHttpServer())
      .get('/favourites')
      .set('X-User-Id', 'not-a-uuid')
      .expect(400);
  });

  it('a command id reused by another user gives 409', async () => {
    const commandId = randomUUID();

    await asUser(
      userA,
      request(app.getHttpServer())
        .post('/favourites')
        .send({ channelId })
        .set('X-Command-Id', commandId),
    ).expect(202);

    const res = await asUser(
      userB,
      request(app.getHttpServer())
        .post('/favourites')
        .send({ channelId })
        .set('X-Command-Id', commandId),
    ).expect(409);
    expect(res.body.statusCode).toBe(409);
  });

  it("user B never sees user A's favourites or commands", async () => {
    const addRes = await asUser(
      userA,
      request(app.getHttpServer()).post('/favourites').send({ channelId }),
    ).expect(202);
    const commandId = addRes.body.id;

    const listB = await asUser(
      userB,
      request(app.getHttpServer()).get('/favourites'),
    ).expect(200);
    expect(listB.body).toEqual([]);

    await asUser(
      userB,
      request(app.getHttpServer()).get(`/commands/${commandId}`),
    ).expect(404);
  });

  it('GET /commands/:id succeeds for the owner and gives 404 for a stranger', async () => {
    const addRes = await asUser(
      userA,
      request(app.getHttpServer()).post('/favourites').send({ channelId }),
    ).expect(202);
    const commandId = addRes.body.id;

    const ownerRes = await asUser(
      userA,
      request(app.getHttpServer()).get(`/commands/${commandId}`),
    ).expect(200);
    expect(ownerRes.body.id).toBe(commandId);

    await asUser(
      userB,
      request(app.getHttpServer()).get(`/commands/${commandId}`),
    ).expect(404);
  });

  it('seq is serialized as a string', async () => {
    const res = await asUser(
      userA,
      request(app.getHttpServer()).post('/favourites').send({ channelId }),
    ).expect(202);

    expect(typeof res.body.seq).toBe('string');
    expect(() => BigInt(res.body.seq)).not.toThrow();
  });

  it('POST /commands rejects REFRESH_CHANNEL with 400 "not supported yet"', async () => {
    const res = await asUser(
      userA,
      request(app.getHttpServer())
        .post('/commands')
        .send({ id: randomUUID(), type: 'REFRESH_CHANNEL', channelId }),
    ).expect(400);
    expect(res.body.message).toMatch(/not supported yet/);
  });

  it('POST /commands accepts ADD_FAVORITE directly, same as the /favourites wrapper', async () => {
    const commandId = randomUUID();
    const res = await asUser(
      userA,
      request(app.getHttpServer())
        .post('/commands')
        .send({ id: commandId, type: 'ADD_FAVORITE', channelId }),
    ).expect(202);

    await pollCommand(app, userA, commandId);

    const favourite = await prisma.favourite.findUnique({
      where: { userId_channelId: { userId: userA, channelId } },
    });
    expect(favourite).not.toBeNull();
    expect(res.body.status).toBe('PENDING');
  });

  it('add then remove quickly for the same (user, channel), with worker concurrency above 1, ends removed', async () => {
    const addRes = await asUser(
      userA,
      request(app.getHttpServer()).post('/favourites').send({ channelId }),
    ).expect(202);
    const removeRes = await asUser(
      userA,
      request(app.getHttpServer()).delete(`/favourites/${channelId}`),
    ).expect(202);

    await Promise.all([
      pollCommand(app, userA, addRes.body.id),
      pollCommand(app, userA, removeRes.body.id),
    ]);

    const favourite = await prisma.favourite.findUnique({
      where: { userId_channelId: { userId: userA, channelId } },
    });
    expect(favourite).toBeNull();
  });

  it("~50 interleaved add/remove commands from 2 users on a few channels converge to each (user, channel)'s last command", async () => {
    const channels = await prisma.channel.findMany({
      take: 3,
      orderBy: { id: 'asc' },
    });
    const channelIds = channels.map((c) => c.id);
    const users = [userA, userB];
    const types: Array<'ADD_FAVORITE' | 'REMOVE_FAVORITE'> = [
      'ADD_FAVORITE',
      'REMOVE_FAVORITE',
    ];

    const submissions: Array<{
      userId: string;
      channelId: number;
      type: string;
      id: string;
      seqPromise: Promise<string>;
    }> = [];

    for (let i = 0; i < 50; i++) {
      const userId = users[i % users.length];
      const targetChannelId = channelIds[i % channelIds.length];
      const type = types[i % types.length];
      const id = randomUUID();

      const req = asUser(
        userId,
        request(app.getHttpServer()).post('/commands'),
      ).send({
        id,
        type,
        channelId: targetChannelId,
      });

      submissions.push({
        userId,
        channelId: targetChannelId,
        type,
        id,
        seqPromise: req.expect(202).then((res) => res.body.seq as string),
      });
    }

    const seqs = await Promise.all(submissions.map((s) => s.seqPromise));
    const withSeq = submissions.map((s, i) => ({ ...s, seq: BigInt(seqs[i]) }));

    await Promise.all(withSeq.map((s) => pollCommand(app, s.userId, s.id)));

    const byKey = new Map<string, (typeof withSeq)[number]>();
    for (const s of withSeq) {
      const key = `${s.userId}:${s.channelId}`;
      const current = byKey.get(key);
      if (!current || s.seq > current.seq) {
        byKey.set(key, s);
      }
    }

    for (const [, last] of byKey) {
      const favourite = await prisma.favourite.findUnique({
        where: {
          userId_channelId: { userId: last.userId, channelId: last.channelId },
        },
      });
      if (last.type === 'ADD_FAVORITE') {
        expect(favourite).not.toBeNull();
      } else {
        expect(favourite).toBeNull();
      }
    }
  }, 30000);
});

describe('Commands (e2e) — handler failure', () => {
  let app: INestApplication<App>;
  let workerApp: TestingModule;
  let prisma: PrismaService;
  let channelId: number;
  const userA = randomUUID();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    const channel = await prisma.channel.findFirstOrThrow({
      orderBy: { id: 'asc' },
    });
    channelId = channel.id;

    workerApp = await Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(AddFavouriteHandler)
      .useValue({
        type: 'ADD_FAVORITE',
        handle: jest.fn().mockRejectedValue(new Error('boom')),
      })
      .compile();
    await workerApp.init();
  });

  afterAll(async () => {
    await workerApp.close();
    await app.close();
  });

  beforeEach(async () => {
    await prisma.command.deleteMany();
    await prisma.favourite.deleteMany();
  });

  it('a failing handler marks the command FAILED with the error text, visible via GET /commands/:id', async () => {
    const commandId = randomUUID();

    const addRes = await request(app.getHttpServer())
      .post('/favourites')
      .set('X-User-Id', userA)
      .set('X-Command-Id', commandId)
      .send({ channelId })
      .expect(202);

    expect(addRes.body.status).toBe('PENDING');

    const settled = await pollCommand(app, userA, commandId, {
      timeoutMs: 20000,
    });
    expect(settled.status).toBe('FAILED');
    expect(settled.error).toBe('boom');

    // The failed handler never actually added the favourite.
    const favourite = await prisma.favourite.findUnique({
      where: { userId_channelId: { userId: userA, channelId } },
    });
    expect(favourite).toBeNull();
  }, 25000);
});

describe('Commands (e2e) — queue failure', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let channelId: number;
  const userA = randomUUID();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(COMMANDS_QUEUE)
      .useValue({
        add: jest
          .fn()
          .mockRejectedValue(new Error('ECONNREFUSED: Redis is down')),
        close: jest.fn().mockResolvedValue(undefined),
      })
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

  it('a failing queue add leaves the command PENDING and the API still returns 202', async () => {
    const res = await asUser(
      userA,
      request(app.getHttpServer()).post('/favourites').send({ channelId }),
    ).expect(202);

    expect(res.body.status).toBe('PENDING');

    const stored = await prisma.command.findUniqueOrThrow({
      where: { id: res.body.id },
    });
    expect(stored.status).toBe('PENDING');
  });
});
