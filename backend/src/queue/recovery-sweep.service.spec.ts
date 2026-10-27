import type { Command } from '../../generated/prisma/client';
import type { CommandsRepository } from '../commands/commands.repository';
import type { JobEnqueuerService } from './job-enqueuer.service';
import { RecoverySweepService } from './recovery-sweep.service';

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

function createMocks(pending: Command[] = [], staleProcessing: Command[] = []) {
  const commandsRepository = {
    findPendingForSweep: jest.fn().mockResolvedValue(pending),
    findStaleProcessingForSweep: jest.fn().mockResolvedValue(staleProcessing),
    resetStaleProcessingToPending: jest.fn().mockResolvedValue(undefined),
  } as unknown as CommandsRepository;

  const jobEnqueuer = {
    enqueue: jest.fn().mockResolvedValue(true),
    prepareStaleJobForReenqueue: jest.fn().mockResolvedValue('ready'),
  } as unknown as JobEnqueuerService;

  return { commandsRepository, jobEnqueuer };
}

describe('RecoverySweepService', () => {
  it('re-enqueues every command returned by findPendingForSweep', async () => {
    const commands = [
      makeCommand({ id: 'a', seq: 1n }),
      makeCommand({ id: 'b', seq: 2n }),
    ];
    const { commandsRepository, jobEnqueuer } = createMocks(commands);
    const service = new RecoverySweepService(commandsRepository, jobEnqueuer);

    await service.runPass();

    expect(jobEnqueuer.enqueue).toHaveBeenCalledTimes(2);
    expect(jobEnqueuer.enqueue).toHaveBeenNthCalledWith(1, commands[0]);
    expect(jobEnqueuer.enqueue).toHaveBeenNthCalledWith(2, commands[1]);
  });

  it('asks the repository for PENDING-only, oldest-seq-first, batched, grace-windowed commands (the ordering/filtering itself lives in the repository)', async () => {
    const { commandsRepository, jobEnqueuer } = createMocks([]);
    const service = new RecoverySweepService(commandsRepository, jobEnqueuer);

    await service.runPass();

    expect(commandsRepository.findPendingForSweep).toHaveBeenCalledWith(
      expect.any(Number),
      expect.any(Number),
    );
  });

  it('does nothing when there are no PENDING commands to sweep', async () => {
    const { commandsRepository, jobEnqueuer } = createMocks([]);
    const service = new RecoverySweepService(commandsRepository, jobEnqueuer);

    await service.runPass();

    expect(jobEnqueuer.enqueue).not.toHaveBeenCalled();
  });

  it('swallows a repository/queue error instead of throwing, so the caller (interval, start, reconnect) is never broken by a failed pass', async () => {
    const commandsRepository = {
      findPendingForSweep: jest.fn().mockRejectedValue(new Error('db down')),
    } as unknown as CommandsRepository;
    const jobEnqueuer = { enqueue: jest.fn() } as unknown as JobEnqueuerService;
    const service = new RecoverySweepService(commandsRepository, jobEnqueuer);

    await expect(service.runPass()).resolves.toBeUndefined();
  });

  it('swallows a per-command enqueue failure and still processes the rest of the batch', async () => {
    const commands = [
      makeCommand({ id: 'a' }),
      makeCommand({ id: 'b' }),
      makeCommand({ id: 'c' }),
    ];
    const { commandsRepository } = createMocks(commands);
    const jobEnqueuer = {
      enqueue: jest
        .fn()
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true),
    } as unknown as JobEnqueuerService;
    const service = new RecoverySweepService(commandsRepository, jobEnqueuer);

    await service.runPass();

    expect(jobEnqueuer.enqueue).toHaveBeenCalledTimes(3);
  });

  it('never starts a new pass while a previous one from this service is still running', async () => {
    let resolveFirstEnqueue: () => void = () => {};
    const jobEnqueuer = {
      enqueue: jest.fn().mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            resolveFirstEnqueue = () => resolve(true);
          }),
      ),
    } as unknown as JobEnqueuerService;
    const commandsRepository = {
      findPendingForSweep: jest.fn().mockResolvedValue([makeCommand()]),
      findStaleProcessingForSweep: jest.fn().mockResolvedValue([]),
      resetStaleProcessingToPending: jest.fn().mockResolvedValue(undefined),
    } as unknown as CommandsRepository;
    const service = new RecoverySweepService(commandsRepository, jobEnqueuer);

    const firstPass = service.runPass();
    const secondPass = service.runPass(); // should return immediately without calling findPendingForSweep again

    await new Promise((resolve) => setImmediate(resolve));
    expect(commandsRepository.findPendingForSweep).toHaveBeenCalledTimes(1);

    resolveFirstEnqueue();
    await Promise.all([firstPass, secondPass]);
  });
});

describe('RecoverySweepService — stale PROCESSING recovery', () => {
  it('resets a stale PROCESSING command to PENDING and re-enqueues it once its job is confirmed not still owned by BullMQ', async () => {
    const stale = makeCommand({ id: 'stale-1', status: 'PROCESSING' });
    const { commandsRepository, jobEnqueuer } = createMocks([], [stale]);

    await service(commandsRepository, jobEnqueuer).runPass();

    expect(jobEnqueuer.prepareStaleJobForReenqueue).toHaveBeenCalledWith('stale-1');
    expect(commandsRepository.resetStaleProcessingToPending).toHaveBeenCalledWith('stale-1');
    expect(jobEnqueuer.enqueue).toHaveBeenCalledWith(stale);
  });

  it('asks the repository for PROCESSING-only, staleness-windowed commands (the filtering itself lives in the repository)', async () => {
    const { commandsRepository, jobEnqueuer } = createMocks([], []);

    await service(commandsRepository, jobEnqueuer).runPass();

    expect(commandsRepository.findStaleProcessingForSweep).toHaveBeenCalledWith(
      expect.any(Number),
      expect.any(Number),
    );
  });

  it('leaves a fresh (non-stale) PROCESSING command untouched, since findStaleProcessingForSweep never returns it', async () => {
    const { commandsRepository, jobEnqueuer } = createMocks([], []);

    await service(commandsRepository, jobEnqueuer).runPass();

    expect(commandsRepository.resetStaleProcessingToPending).not.toHaveBeenCalled();
    expect(jobEnqueuer.prepareStaleJobForReenqueue).not.toHaveBeenCalled();
  });

  it('leaves a stale PROCESSING command alone (no reset, no re-add) when BullMQ still shows an active job for it', async () => {
    const stale = makeCommand({ id: 'stale-1', status: 'PROCESSING' });
    const { commandsRepository, jobEnqueuer } = createMocks([], [stale]);
    (jobEnqueuer.prepareStaleJobForReenqueue as jest.Mock).mockResolvedValue('still-active');

    await service(commandsRepository, jobEnqueuer).runPass();

    expect(commandsRepository.resetStaleProcessingToPending).not.toHaveBeenCalled();
    expect(jobEnqueuer.enqueue).not.toHaveBeenCalled();
  });

  it('removes a leftover failed job before resetting and re-adding — delegated to and verified via prepareStaleJobForReenqueue, which runPass trusts to have done the removal before returning "ready"', async () => {
    const stale = makeCommand({ id: 'stale-1', status: 'PROCESSING' });
    const { commandsRepository, jobEnqueuer } = createMocks([], [stale]);

    await service(commandsRepository, jobEnqueuer).runPass();

    // prepareStaleJobForReenqueue is called (and awaited) strictly before the
    // reset + re-add, so by the time those run any leftover finished/failed
    // job has already been removed.
    const prepareOrder = (jobEnqueuer.prepareStaleJobForReenqueue as jest.Mock).mock
      .invocationCallOrder[0];
    const resetOrder = (commandsRepository.resetStaleProcessingToPending as jest.Mock).mock
      .invocationCallOrder[0];
    expect(prepareOrder).toBeLessThan(resetOrder);
  });

  it('processes every command in the stale-PROCESSING batch, mixing recovered and left-alone outcomes', async () => {
    const stale = [
      makeCommand({ id: 'a', status: 'PROCESSING' }),
      makeCommand({ id: 'b', status: 'PROCESSING' }),
    ];
    const { commandsRepository, jobEnqueuer } = createMocks([], stale);
    (jobEnqueuer.prepareStaleJobForReenqueue as jest.Mock)
      .mockResolvedValueOnce('still-active')
      .mockResolvedValueOnce('ready');

    await service(commandsRepository, jobEnqueuer).runPass();

    expect(jobEnqueuer.prepareStaleJobForReenqueue).toHaveBeenCalledTimes(2);
    expect(commandsRepository.resetStaleProcessingToPending).toHaveBeenCalledTimes(1);
    expect(commandsRepository.resetStaleProcessingToPending).toHaveBeenCalledWith('b');
  });
});

function service(commandsRepository: CommandsRepository, jobEnqueuer: JobEnqueuerService) {
  return new RecoverySweepService(commandsRepository, jobEnqueuer);
}
