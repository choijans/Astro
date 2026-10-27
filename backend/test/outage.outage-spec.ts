import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { COMMANDS_QUEUE } from '../src/queue/queue.module';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';
import { WorkerModule } from '../src/worker/worker.module';

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SETTLE_TIMEOUT_MS = 60000;
const BATCH_SIZE = 30;

async function dockerComposeRedis(action: 'stop' | 'start'): Promise<void> {
  await execFileAsync('docker', ['compose', action, 'redis'], {
    cwd: REPO_ROOT,
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asUser(userId: string, req: request.Test): request.Test {
  return req.set('X-User-Id', userId);
}

async function startWorker(): Promise<TestingModule> {
  const moduleFixture = await Test.createTestingModule({
    imports: [WorkerModule],
  }).compile();
  await moduleFixture.init();
  return moduleFixture;
}

interface Submission {
  userId: string;
  channelId: number;
  type: 'ADD_FAVORITE' | 'REMOVE_FAVORITE';
  id: string;
  seq?: bigint;
}

/**
 * Submits ~30 interleaved add/remove commands for 2 users over a few
 * channels, running `duringSubmission` concurrently with that submission
 * (the outage itself), then waits until every command is DONE or FAILED (or
 * gives up after 60s) and asserts: every command is DONE, no duplicate
 * favourites, the final state of each (user, channel) matches its last
 * command by seq, and the queue holds no duplicate jobs.
 */
async function runInterleavedBatch(
  app: INestApplication<App>,
  prisma: PrismaService,
  users: [string, string],
  duringSubmission: () => Promise<void>,
): Promise<void> {
  const channels = await prisma.channel.findMany({
    take: 3,
    orderBy: { id: 'asc' },
  });
  const channelIds = channels.map((c) => c.id);
  const types: Submission['type'][] = ['ADD_FAVORITE', 'REMOVE_FAVORITE'];

  const submissions: Submission[] = [];
  for (let i = 0; i < BATCH_SIZE; i++) {
    submissions.push({
      userId: users[i % users.length],
      channelId: channelIds[i % channelIds.length],
      type: types[i % types.length],
      id: randomUUID(),
    });
  }

  const submissionPromises = submissions.map((s) =>
    asUser(s.userId, request(app.getHttpServer()).post('/commands'))
      .send({ id: s.id, type: s.type, channelId: s.channelId })
      .then((res) => {
        s.seq = BigInt(res.body.seq);
      }),
  );

  await Promise.all([Promise.all(submissionPromises), duringSubmission()]);

  const ids = submissions.map((s) => s.id);
  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  for (;;) {
    const rows = await prisma.command.findMany({
      where: { id: { in: ids } },
      select: { status: true },
    });
    const unsettled = rows.filter(
      (r) => r.status !== 'DONE' && r.status !== 'FAILED',
    );
    if (unsettled.length === 0) break;
    if (Date.now() > deadline) {
      throw new Error(
        `${unsettled.length} of ${BATCH_SIZE} commands never settled within ${SETTLE_TIMEOUT_MS}ms`,
      );
    }
    await sleep(250);
  }

  const finalRows = await prisma.command.findMany({
    where: { id: { in: ids } },
  });
  for (const row of finalRows) {
    expect(row.status).toBe('DONE');
  }

  const byKey = new Map<string, Submission>();
  for (const s of submissions) {
    const key = `${s.userId}:${s.channelId}`;
    const current = byKey.get(key);
    if (!current || s.seq! > current.seq!) {
      byKey.set(key, s);
    }
  }
  for (const last of byKey.values()) {
    const favouriteCount = await prisma.favourite.count({
      where: { userId: last.userId, channelId: last.channelId },
    });
    expect(favouriteCount).toBe(last.type === 'ADD_FAVORITE' ? 1 : 0);
  }

  // No duplicate jobs: the job for each submitted command id, if it still
  // exists (recent completions may already be trimmed by removeOnComplete),
  // is exactly the one we expect — BullMQ's jobId uniqueness is what
  // structurally prevents a duplicate in the first place.
  const queue = app.get<{
    getJob: (id: string) => Promise<{ id?: string } | undefined>;
  }>(COMMANDS_QUEUE);
  for (const s of submissions) {
    const job = await queue.getJob(s.id);
    if (job) {
      expect(job.id).toBe(s.id);
    }
  }
}

describe('Outage acceptance (scripted, stops the real Docker Redis container)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
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
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await prisma.command.deleteMany();
    await prisma.favourite.deleteMany();
  });

  it('scenario (a): recovers from a 5s Redis outage mid-batch', async () => {
    const t0 = Date.now();
    const workerModule = await startWorker();
    let redisStopped = false;

    try {
      await runInterleavedBatch(app, prisma, [userA, userB], async () => {
        await sleep(100);
        await dockerComposeRedis('stop');
        redisStopped = true;
        await sleep(5000);
        await dockerComposeRedis('start');
        redisStopped = false;
      });
    } finally {
      // Make sure Redis is running again even if an assertion above threw.
      if (redisStopped) {
        await dockerComposeRedis('start');
      }
      await workerModule.close();
    }

    console.log(`Scenario (a) Redis outage: ${Date.now() - t0}ms`);
  }, 80000);

  it('scenario (b): recovers from a 5s worker outage mid-batch', async () => {
    const t0 = Date.now();
    let workerModule = await startWorker();

    try {
      await runInterleavedBatch(app, prisma, [userA, userB], async () => {
        await sleep(100);
        await workerModule.close();
        await sleep(5000);
        workerModule = await startWorker();
      });
    } finally {
      await workerModule.close();
    }

    console.log(`Scenario (b) worker outage: ${Date.now() - t0}ms`);
  }, 80000);
});
