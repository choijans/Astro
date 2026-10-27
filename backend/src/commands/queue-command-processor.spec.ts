import type { Command } from '../../generated/prisma/client';
import type { JobEnqueuerService } from '../queue/job-enqueuer.service';
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
    processingStartedAt: null,
    ...overrides,
  };
}

// The actual queue.add() behavior (jobId, payload shape, error swallowing) is
// tested against JobEnqueuerService directly — see job-enqueuer.service.spec.ts.
// This only checks that process() delegates to it and always returns the
// command as persisted, regardless of whether the enqueue succeeded.
describe('QueueCommandProcessor', () => {
  it('delegates to JobEnqueuerService and returns the command unchanged (still PENDING)', async () => {
    const jobEnqueuer = {
      enqueue: jest.fn().mockResolvedValue(true),
    } as unknown as JobEnqueuerService;
    const processor = new QueueCommandProcessor(jobEnqueuer);
    const command = makeCommand();

    const result = await processor.process(command);

    expect(jobEnqueuer.enqueue).toHaveBeenCalledWith(command);
    expect(result).toBe(command);
    expect(result.status).toBe('PENDING');
  });

  it('still returns the command (left PENDING) when the enqueue fails', async () => {
    const jobEnqueuer = {
      enqueue: jest.fn().mockResolvedValue(false),
    } as unknown as JobEnqueuerService;
    const processor = new QueueCommandProcessor(jobEnqueuer);
    const command = makeCommand({ status: 'PENDING' });

    await expect(processor.process(command)).resolves.toBe(command);
    expect(command.status).toBe('PENDING');
  });
});
