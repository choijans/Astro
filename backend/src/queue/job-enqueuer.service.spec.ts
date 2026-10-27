import type { Queue } from 'bullmq';
import type { Command } from '../../generated/prisma/client';
import type { CommandJobData } from '../commands/queue-command-processor';
import { JobEnqueuerService } from './job-enqueuer.service';

function makeCommand(overrides: Partial<Command> = {}): Command {
  return {
    id: 'cmd-1',
    userId: 'user-1',
    channelId: 42,
    type: 'ADD_FAVORITE',
    status: 'PENDING',
    seq: 1n,
    payload: { channelId: 42 },
    attempts: 0,
    error: null,
    createdAt: new Date(),
    processedAt: null,
    processingStartedAt: null,
    ...overrides,
  };
}

describe('JobEnqueuerService', () => {
  it('adds a job named after the command type, with jobId equal to the command id and a minimal payload', async () => {
    const queue = {
      add: jest.fn().mockResolvedValue({}),
    } as unknown as Queue<CommandJobData>;
    const service = new JobEnqueuerService(queue);

    const result = await service.enqueue(makeCommand());

    expect(queue.add).toHaveBeenCalledWith(
      'ADD_FAVORITE',
      { commandId: 'cmd-1' },
      { jobId: 'cmd-1' },
    );
    expect(result).toBe(true);
  });

  it('calling it twice for the same command uses the same jobId both times (BullMQ dedups by jobId)', async () => {
    const queue = {
      add: jest.fn().mockResolvedValue({}),
    } as unknown as Queue<CommandJobData>;
    const service = new JobEnqueuerService(queue);
    const command = makeCommand();

    await service.enqueue(command);
    await service.enqueue(command);

    expect(queue.add).toHaveBeenCalledTimes(2);
    const [[, , firstOpts], [, , secondOpts]] = (queue.add as jest.Mock).mock
      .calls;
    expect(firstOpts.jobId).toBe(secondOpts.jobId);
  });

  it('logs and swallows the error, returning false, when the queue add fails (e.g. Redis down)', async () => {
    const queue = {
      add: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    } as unknown as Queue<CommandJobData>;
    const service = new JobEnqueuerService(queue);

    await expect(service.enqueue(makeCommand())).resolves.toBe(false);
  });
});

describe('JobEnqueuerService.prepareStaleJobForReenqueue', () => {
  it('is immediately ready when no job exists for the command id', async () => {
    const queue = {
      getJob: jest.fn().mockResolvedValue(null),
    } as unknown as Queue<CommandJobData>;
    const service = new JobEnqueuerService(queue);

    await expect(service.prepareStaleJobForReenqueue('cmd-1')).resolves.toBe(
      'ready',
    );
  });

  it.each(['completed', 'failed', 'unknown'] as const)(
    'removes a leftover %s job and reports ready, since BullMQ would otherwise ignore a re-add for that jobId',
    async (state) => {
      const job = {
        getState: jest.fn().mockResolvedValue(state),
        remove: jest.fn().mockResolvedValue(undefined),
      };
      const queue = {
        getJob: jest.fn().mockResolvedValue(job),
      } as unknown as Queue<CommandJobData>;
      const service = new JobEnqueuerService(queue);

      await expect(service.prepareStaleJobForReenqueue('cmd-1')).resolves.toBe(
        'ready',
      );
      expect(job.remove).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    'active',
    'waiting',
    'delayed',
    'prioritized',
    'waiting-children',
  ] as const)(
    'leaves a %s job alone and reports still-active, without removing anything',
    async (state) => {
      const job = {
        getState: jest.fn().mockResolvedValue(state),
        remove: jest.fn(),
      };
      const queue = {
        getJob: jest.fn().mockResolvedValue(job),
      } as unknown as Queue<CommandJobData>;
      const service = new JobEnqueuerService(queue);

      await expect(service.prepareStaleJobForReenqueue('cmd-1')).resolves.toBe(
        'still-active',
      );
      expect(job.remove).not.toHaveBeenCalled();
    },
  );
});
