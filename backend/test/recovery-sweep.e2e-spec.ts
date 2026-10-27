import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Queue } from 'bullmq';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';
import type { CommandJobData } from '../src/commands/queue-command-processor';
import {
  buildQueueConnectionOptions,
  getJobAttempts,
  getJobBackoffDelayMs,
  getQueueName,
} from '../src/queue/queue.config';
import { COMMANDS_QUEUE } from '../src/queue/queue.module';
import { RecoverySweepService } from '../src/queue/recovery-sweep.service';
import { WorkerModule } from '../src/worker/worker.module';
import { pollCommand } from './e2e-helpers';

describe('Recovery sweep (e2e)', () => {
  let app: INestApplication<App>;
  let workerApp: TestingModule;
  let prisma: PrismaService;
  let realQueue: Queue<CommandJobData>;
  let queueProxy: {
    add: (...args: unknown[]) => unknown;
    getJob: (id: string) => unknown;
    close: () => unknown;
  };
  let channelId: number;
  const userA = randomUUID();

  beforeAll(async () => {
    // A real Queue (same construction as QueueModule's own factory). It's
    // never used directly as the DI override value — NestJS's testing
    // container doesn't resolve dependencies correctly when a real Queue
    // instance (a complex EventEmitter subclass) is handed to
    // overrideProvider().useValue(); a plain object that delegates to it
    // works fine and is also what every other override in this test suite
    // uses. The proxy's own .add is what gets spied on to simulate "the
    // queue add fails" — the worker, started separately below, consumes
    // from this same (test) queue/Redis regardless of which object added a
    // given job.
    realQueue = new Queue<CommandJobData>(getQueueName(), {
      connection: buildQueueConnectionOptions(),
      defaultJobOptions: {
        attempts: getJobAttempts(),
        backoff: { type: 'exponential', delay: getJobBackoffDelayMs() },
      },
    });
    queueProxy = {
      add: (...args: unknown[]) =>
        (realQueue.add as (...a: unknown[]) => unknown)(...args),
      getJob: (id: string) => realQueue.getJob(id),
      close: () => realQueue.close(),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(COMMANDS_QUEUE)
      .useValue(queueProxy)
      .compile();

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
    await realQueue.close();
  });

  beforeEach(async () => {
    await prisma.command.deleteMany();
    await prisma.favourite.deleteMany();
  });

  it('a command created while the queue add fails stays PENDING; a sweep pass after the queue recovers reaches DONE; running the pass again does not duplicate the job or favourite', async () => {
    const addSpy = jest
      .spyOn(queueProxy, 'add')
      .mockRejectedValueOnce(new Error('Simulated Redis outage'));

    const res = await request(app.getHttpServer())
      .post('/favourites')
      .set('X-User-Id', userA)
      .send({ channelId })
      .expect(202);
    expect(res.body.status).toBe('PENDING');
    const commandId = res.body.id as string;

    const stored = await prisma.command.findUniqueOrThrow({
      where: { id: commandId },
    });
    expect(stored.status).toBe('PENDING');

    // "Restore the queue": later .add() calls (the sweep's re-add) behave
    // normally again.
    addSpy.mockRestore();

    // Past the sweep's 2s grace window, so this command is eligible.
    await new Promise((resolve) => setTimeout(resolve, 2100));

    const recoverySweep = app.get(RecoverySweepService);
    await recoverySweep.runPass();

    const settled = await pollCommand(app, userA, commandId);
    expect(settled.status).toBe('DONE');

    const favouriteCountAfterFirstPass = await prisma.favourite.count({
      where: { userId: userA, channelId },
    });
    expect(favouriteCountAfterFirstPass).toBe(1);

    // A second pass finds nothing PENDING (the command is now DONE), so it
    // can't duplicate the job or re-apply the favourite.
    await recoverySweep.runPass();

    const favouriteCountAfterSecondPass = await prisma.favourite.count({
      where: { userId: userA, channelId },
    });
    expect(favouriteCountAfterSecondPass).toBe(1);

    const commandCount = await prisma.command.count({
      where: { id: commandId },
    });
    expect(commandCount).toBe(1);
  }, 15000);

  it('a command left in PROCESSING with its BullMQ job record deleted from Redis is recovered by the sweep and reaches DONE', async () => {
    const commandId = randomUUID();
    // Well past the default PROCESSING_STALE_MS (45000ms) — simulates a
    // worker that picked this up and then died without ever finishing it.
    const staleProcessingStartedAt = new Date(Date.now() - 100000);

    await prisma.command.create({
      data: {
        id: commandId,
        userId: userA,
        channelId,
        type: 'ADD_FAVORITE',
        status: 'PROCESSING',
        payload: { channelId },
        processingStartedAt: staleProcessingStartedAt,
      },
    });

    // "Its job record deleted from Redis": no job for this id exists at all.
    const existingJob = await realQueue.getJob(commandId);
    expect(existingJob).toBeUndefined();

    const recoverySweep = app.get(RecoverySweepService);
    await recoverySweep.runPass();

    const settled = await pollCommand(app, userA, commandId);
    expect(settled.status).toBe('DONE');

    const favouriteCount = await prisma.favourite.count({
      where: { userId: userA, channelId },
    });
    expect(favouriteCount).toBe(1);
  }, 15000);
});
