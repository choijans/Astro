import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { AddFavouriteHandler } from '../src/commands/handlers/add-favourite.handler';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Favourites & Commands (e2e)', () => {
  let app: INestApplication<App>;
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

    const channel = await prisma.channel.findFirstOrThrow({ orderBy: { id: 'asc' } });
    channelId = channel.id;
  });

  afterAll(async () => {
    await app.close();
  });

  // Favourites and commands are reset between tests; channels (seeded once by
  // pretest:e2e) are never touched, so re-seeding isn't needed per test.
  beforeEach(async () => {
    await prisma.command.deleteMany();
    await prisma.favourite.deleteMany();
  });

  function asUser(userId: string, req: request.Test): request.Test {
    return req.set('X-User-Id', userId);
  }

  describe('add then list', () => {
    it('adding a favourite makes it appear in the list, with the channel-list item shape', async () => {
      const addRes = await asUser(
        userA,
        request(app.getHttpServer()).post('/favourites').send({ channelId }),
      ).expect(202);
      expect(addRes.body.status).toBe('DONE');
      expect(addRes.body.channelId).toBe(channelId);

      const listRes = await asUser(userA, request(app.getHttpServer()).get('/favourites')).expect(200);
      expect(listRes.body).toHaveLength(1);
      expect(listRes.body[0].id).toBe(channelId);
      expect(listRes.body[0]).not.toHaveProperty('schedule');
    });
  });

  it('duplicate add with the same command id gives one favourite row and one command row', async () => {
    const commandId = randomUUID();

    await asUser(
      userA,
      request(app.getHttpServer()).post('/favourites').send({ channelId }).set('X-Command-Id', commandId),
    ).expect(202);
    await asUser(
      userA,
      request(app.getHttpServer()).post('/favourites').send({ channelId }).set('X-Command-Id', commandId),
    ).expect(202);

    const favouriteCount = await prisma.favourite.count({ where: { userId: userA, channelId } });
    const commandCount = await prisma.command.count({ where: { id: commandId } });
    expect(favouriteCount).toBe(1);
    expect(commandCount).toBe(1);
  });

  it('two identical requests sent in parallel (same command id) still produce one favourite and one command', async () => {
    const commandId = randomUUID();
    const sendOnce = () =>
      asUser(
        userA,
        request(app.getHttpServer()).post('/favourites').send({ channelId }).set('X-Command-Id', commandId),
      );

    const [resA, resB] = await Promise.all([sendOnce(), sendOnce()]);

    // Whichever one lost the race gets the same command back, not an error.
    expect(resA.status).toBe(202);
    expect(resB.status).toBe(202);
    expect(resA.body.id).toBe(commandId);
    expect(resB.body.id).toBe(commandId);

    const favouriteCount = await prisma.favourite.count({ where: { userId: userA, channelId } });
    const commandCount = await prisma.command.count({ where: { id: commandId } });
    expect(favouriteCount).toBe(1);
    expect(commandCount).toBe(1);
  });

  it('invalid X-Command-Id header gives 400', async () => {
    await asUser(
      userA,
      request(app.getHttpServer()).post('/favourites').send({ channelId }).set('X-Command-Id', 'not-a-uuid'),
    ).expect(400);
  });

  it('remove when absent succeeds', async () => {
    const res = await asUser(userA, request(app.getHttpServer()).delete(`/favourites/${channelId}`)).expect(202);
    expect(res.body.status).toBe('DONE');
  });

  it('unknown channel gives 404', async () => {
    const res = await asUser(
      userA,
      request(app.getHttpServer()).post('/favourites').send({ channelId: 999999 }),
    ).expect(404);
    expect(res.body).toMatchObject({ statusCode: 404, error: 'Not Found' });
  });

  it('missing X-User-Id gives 400', async () => {
    const res = await request(app.getHttpServer()).get('/favourites').expect(400);
    expect(res.body.statusCode).toBe(400);
  });

  it('invalid X-User-Id gives 400', async () => {
    await request(app.getHttpServer()).get('/favourites').set('X-User-Id', 'not-a-uuid').expect(400);
  });

  it('a command id reused by another user gives 409', async () => {
    const commandId = randomUUID();

    await asUser(
      userA,
      request(app.getHttpServer()).post('/favourites').send({ channelId }).set('X-Command-Id', commandId),
    ).expect(202);

    const res = await asUser(
      userB,
      request(app.getHttpServer()).post('/favourites').send({ channelId }).set('X-Command-Id', commandId),
    ).expect(409);
    expect(res.body.statusCode).toBe(409);
  });

  it("user B never sees user A's favourites or commands", async () => {
    const addRes = await asUser(
      userA,
      request(app.getHttpServer()).post('/favourites').send({ channelId }),
    ).expect(202);
    const commandId = addRes.body.id;

    const listB = await asUser(userB, request(app.getHttpServer()).get('/favourites')).expect(200);
    expect(listB.body).toEqual([]);

    await asUser(userB, request(app.getHttpServer()).get(`/commands/${commandId}`)).expect(404);
  });

  it('GET /commands/:id succeeds for the owner and gives 404 for a stranger', async () => {
    const addRes = await asUser(
      userA,
      request(app.getHttpServer()).post('/favourites').send({ channelId }),
    ).expect(202);
    const commandId = addRes.body.id;

    const ownerRes = await asUser(userA, request(app.getHttpServer()).get(`/commands/${commandId}`)).expect(200);
    expect(ownerRes.body.id).toBe(commandId);

    await asUser(userB, request(app.getHttpServer()).get(`/commands/${commandId}`)).expect(404);
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
      request(app.getHttpServer()).post('/commands').send({ id: commandId, type: 'ADD_FAVORITE', channelId }),
    ).expect(202);

    expect(res.body.status).toBe('DONE');
    const favourite = await prisma.favourite.findUnique({
      where: { userId_channelId: { userId: userA, channelId } },
    });
    expect(favourite).not.toBeNull();
  });
});

describe('Commands (e2e) — handler failure', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let channelId: number;
  const userA = randomUUID();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(AddFavouriteHandler)
      .useValue({ type: 'ADD_FAVORITE', handle: jest.fn().mockRejectedValue(new Error('boom')) })
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    const channel = await prisma.channel.findFirstOrThrow({ orderBy: { id: 'asc' } });
    channelId = channel.id;
  });

  afterAll(async () => {
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

    expect(addRes.body.status).toBe('FAILED');
    expect(addRes.body.error).toBe('boom');

    const statusRes = await request(app.getHttpServer())
      .get(`/commands/${commandId}`)
      .set('X-User-Id', userA)
      .expect(200);

    expect(statusRes.body.status).toBe('FAILED');
    expect(statusRes.body.error).toBe('boom');

    // The failed handler never actually added the favourite.
    const favourite = await prisma.favourite.findUnique({
      where: { userId_channelId: { userId: userA, channelId } },
    });
    expect(favourite).toBeNull();
  });
});
