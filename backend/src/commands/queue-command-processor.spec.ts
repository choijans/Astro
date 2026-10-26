import type { Queue } from 'bullmq';
import type { Command } from '../../generated/prisma/client';
import { QueueCommandProcessor } from './queue-command-processor';

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
    ...overrides,
  } as Command;
}

describe('QueueCommandProcessor', () => {
  it('adds a job named after the command type, with jobId equal to the command id and a minimal payload', async () => {
    const queue = { add: jest.fn().mockResolvedValue({}) } as unknown as Queue;
    const processor = new QueueCommandProcessor(queue);
    const command = makeCommand();

    const result = await processor.process(command);

    expect(queue.add).toHaveBeenCalledWith('ADD_FAVORITE', { commandId: 'cmd-1' }, { jobId: 'cmd-1' });
    expect(result).toBe(command);
    expect(result.status).toBe('PENDING');
  });

  it('adding the same command id twice results in one job add call per enqueue, both using the same jobId (BullMQ dedups by jobId)', async () => {
    const queue = { add: jest.fn().mockResolvedValue({}) } as unknown as Queue;
    const processor = new QueueCommandProcessor(queue);
    const command = makeCommand();

    await processor.process(command);
    await processor.process(command);

    expect(queue.add).toHaveBeenCalledTimes(2);
    const [[, , firstOpts], [, , secondOpts]] = (queue.add as jest.Mock).mock.calls;
    expect(firstOpts.jobId).toBe(secondOpts.jobId);
  });

  it('logs and still returns the command (left PENDING) when the queue add fails, e.g. Redis down', async () => {
    const queue = { add: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) } as unknown as Queue;
    const processor = new QueueCommandProcessor(queue);
    const command = makeCommand({ status: 'PENDING' });

    await expect(processor.process(command)).resolves.toBe(command);
    expect(command.status).toBe('PENDING');
  });
});
