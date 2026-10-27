import type { Job } from 'bullmq';
import { UnrecoverableError } from 'bullmq';
import type { Command } from '../../generated/prisma/client';
import type { CommandHandlerRegistry } from '../commands/command-handler-registry';
import type { ICommandHandler } from '../commands/command-handler.interface';
import type { CommandsRepository } from '../commands/commands.repository';
import type { CommandJobData } from '../commands/queue-command-processor';
import type { PrismaService } from '../prisma/prisma.service';
import { CommandWorkerService } from './command-worker.service';

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

function makeJob(
  overrides: Partial<Job<CommandJobData>> = {},
): Job<CommandJobData> {
  return {
    id: 'job-1',
    data: { commandId: 'cmd-1' },
    attemptsMade: 1,
    opts: { attempts: 6 },
    ...overrides,
  } as Job<CommandJobData>;
}

/** A tx mock whose command.findFirst is controllable per test; $executeRaw is
 * a no-op standing in for the advisory lock acquisition. */
function makeTxMock(supersededBy: Command | null = null) {
  return {
    $executeRaw: jest.fn().mockResolvedValue(1),
    command: {
      findFirst: jest.fn().mockResolvedValue(supersededBy),
      update: jest.fn().mockResolvedValue(undefined),
    },
  };
}

function createMocks(options: { supersededBy?: Command | null } = {}) {
  const tx = makeTxMock(options.supersededBy ?? null);

  const commandsRepository = {
    findById: jest.fn(),
    markProcessing: jest.fn(),
    markPendingForRetry: jest.fn().mockResolvedValue(undefined),
    markFailed: jest.fn().mockResolvedValue(undefined),
  } as unknown as CommandsRepository;

  const handler: ICommandHandler = {
    type: 'ADD_FAVORITE',
    handle: jest.fn().mockResolvedValue(undefined),
  };

  const registry = {
    get: jest.fn().mockReturnValue(handler),
  } as unknown as CommandHandlerRegistry;

  const prisma = {
    $transaction: jest
      .fn()
      .mockImplementation((fn: (tx: unknown) => Promise<void>) => fn(tx)),
  } as unknown as PrismaService;

  return { tx, commandsRepository, handler, registry, prisma };
}

// processJob is private; accessed via a cast so these tests exercise the
// worker's processing logic directly instead of standing up a real BullMQ
// Worker (that's covered by the e2e suite against real Redis).
type WithProcessJob = { processJob(job: Job<CommandJobData>): Promise<void> };

describe('CommandWorkerService', () => {
  it('processes a command successfully: PROCESSING, handler runs, DONE', async () => {
    const { commandsRepository, handler, registry, prisma, tx } = createMocks();
    const pending = makeCommand({ status: 'PENDING' });
    const processing = makeCommand({ status: 'PROCESSING', attempts: 1 });
    (commandsRepository.findById as jest.Mock).mockResolvedValue(pending);
    (commandsRepository.markProcessing as jest.Mock).mockResolvedValue(
      processing,
    );

    const service = new CommandWorkerService(
      commandsRepository,
      registry,
      prisma,
    );
    await (service as unknown as WithProcessJob).processJob(makeJob());

    expect(commandsRepository.markProcessing).toHaveBeenCalledWith('cmd-1');
    expect(handler.handle).toHaveBeenCalledWith(processing, tx);
    expect(tx.command.update).toHaveBeenCalledWith({
      where: { id: 'cmd-1' },
      data: {
        status: 'DONE',
        processedAt: expect.any(Date),
        processingStartedAt: null,
      },
    });
  });

  it('a handler failure with attempts left sets the command back to PENDING and rethrows', async () => {
    const { commandsRepository, handler, registry, prisma } = createMocks();
    (commandsRepository.findById as jest.Mock).mockResolvedValue(
      makeCommand({ status: 'PENDING' }),
    );
    (commandsRepository.markProcessing as jest.Mock).mockResolvedValue(
      makeCommand({ status: 'PROCESSING' }),
    );
    (handler.handle as jest.Mock).mockRejectedValue(new Error('transient'));

    const service = new CommandWorkerService(
      commandsRepository,
      registry,
      prisma,
    );

    await expect(
      (service as unknown as WithProcessJob).processJob(
        makeJob({ attemptsMade: 2, opts: { attempts: 6 } }),
      ),
    ).rejects.toThrow('transient');

    expect(commandsRepository.markPendingForRetry).toHaveBeenCalledWith(
      'cmd-1',
    );
    expect(commandsRepository.markFailed).not.toHaveBeenCalled();
  });

  it('a handler failure on the final attempt marks the command FAILED with the error text, and still rethrows', async () => {
    const { commandsRepository, handler, registry, prisma } = createMocks();
    (commandsRepository.findById as jest.Mock).mockResolvedValue(
      makeCommand({ status: 'PENDING' }),
    );
    (commandsRepository.markProcessing as jest.Mock).mockResolvedValue(
      makeCommand({ status: 'PROCESSING' }),
    );
    (handler.handle as jest.Mock).mockRejectedValue(new Error('still broken'));

    const service = new CommandWorkerService(
      commandsRepository,
      registry,
      prisma,
    );

    // BullMQ doesn't increment attemptsMade until after this call returns, so
    // attemptsMade=5 here means "the 6th attempt is the one running now" —
    // the last one opts.attempts: 6 allows.
    await expect(
      (service as unknown as WithProcessJob).processJob(
        makeJob({ attemptsMade: 5, opts: { attempts: 6 } }),
      ),
    ).rejects.toThrow('still broken');

    expect(commandsRepository.markFailed).toHaveBeenCalledWith(
      'cmd-1',
      'still broken',
    );
    expect(commandsRepository.markPendingForRetry).not.toHaveBeenCalled();
  });

  it('an UnrecoverableError from the handler marks FAILED immediately, even with attempts left, and still rethrows', async () => {
    const { commandsRepository, handler, registry, prisma } = createMocks();
    (commandsRepository.findById as jest.Mock).mockResolvedValue(
      makeCommand({ status: 'PENDING' }),
    );
    (commandsRepository.markProcessing as jest.Mock).mockResolvedValue(
      makeCommand({ status: 'PROCESSING' }),
    );
    (handler.handle as jest.Mock).mockRejectedValue(
      new UnrecoverableError('channel 999999 is no longer present'),
    );

    const service = new CommandWorkerService(
      commandsRepository,
      registry,
      prisma,
    );

    // Only the 1st of 6 allowed attempts — a plain error here would retry.
    await expect(
      (service as unknown as WithProcessJob).processJob(
        makeJob({ attemptsMade: 0, opts: { attempts: 6 } }),
      ),
    ).rejects.toThrow('channel 999999 is no longer present');

    expect(commandsRepository.markFailed).toHaveBeenCalledWith(
      'cmd-1',
      'channel 999999 is no longer present',
    );
    expect(commandsRepository.markPendingForRetry).not.toHaveBeenCalled();
  });

  it('skips a duplicate delivery of an already-DONE command without touching the handler', async () => {
    const { commandsRepository, handler, registry, prisma } = createMocks();
    (commandsRepository.findById as jest.Mock).mockResolvedValue(
      makeCommand({ status: 'DONE' }),
    );

    const service = new CommandWorkerService(
      commandsRepository,
      registry,
      prisma,
    );
    await (service as unknown as WithProcessJob).processJob(makeJob());

    expect(commandsRepository.markProcessing).not.toHaveBeenCalled();
    expect(handler.handle).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('skips a duplicate delivery of an already-FAILED command without touching the handler', async () => {
    const { commandsRepository, handler, registry, prisma } = createMocks();
    (commandsRepository.findById as jest.Mock).mockResolvedValue(
      makeCommand({ status: 'FAILED', error: 'x' }),
    );

    const service = new CommandWorkerService(
      commandsRepository,
      registry,
      prisma,
    );
    await (service as unknown as WithProcessJob).processJob(makeJob());

    expect(handler.handle).not.toHaveBeenCalled();
  });

  it('skips a command superseded by an already-applied higher-seq command, marking it DONE without running the handler', async () => {
    const supersededBy = makeCommand({ id: 'cmd-2', seq: 5n, status: 'DONE' });
    const { commandsRepository, handler, registry, prisma, tx } = createMocks({
      supersededBy,
    });
    const command = makeCommand({ id: 'cmd-1', seq: 1n, status: 'PENDING' });
    (commandsRepository.findById as jest.Mock).mockResolvedValue(command);
    (commandsRepository.markProcessing as jest.Mock).mockResolvedValue({
      ...command,
      status: 'PROCESSING',
    });

    const service = new CommandWorkerService(
      commandsRepository,
      registry,
      prisma,
    );
    await (service as unknown as WithProcessJob).processJob(makeJob());

    expect(handler.handle).not.toHaveBeenCalled();
    expect(tx.command.update).toHaveBeenCalledWith({
      where: { id: 'cmd-1' },
      data: {
        status: 'DONE',
        processedAt: expect.any(Date),
        processingStartedAt: null,
      },
    });
  });

  it('does not apply the ordering lock/supersede check for a type outside ADD_FAVORITE/REMOVE_FAVORITE', async () => {
    const { commandsRepository, handler, registry, prisma, tx } = createMocks();
    const command = makeCommand({ type: 'REFRESH_CHANNEL' as Command['type'] });
    (commandsRepository.findById as jest.Mock).mockResolvedValue(command);
    (commandsRepository.markProcessing as jest.Mock).mockResolvedValue({
      ...command,
      status: 'PROCESSING',
    });

    const service = new CommandWorkerService(
      commandsRepository,
      registry,
      prisma,
    );
    await (service as unknown as WithProcessJob).processJob(makeJob());

    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(tx.command.findFirst).not.toHaveBeenCalled();
    expect(handler.handle).toHaveBeenCalled();
  });
});
