import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import type { Command } from '../../generated/prisma/client';
import type { CommandsRepository } from './commands.repository';
import { CommandsService } from './commands.service';
import type { ICommandProcessor } from './command-processor.interface';

function uniqueConstraintError(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`id`)', {
    code: 'P2002',
    clientVersion: '7.10.1',
  });
}

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

function createMocks() {
  const repository = {
    findById: jest.fn().mockResolvedValue(null),
    channelExists: jest.fn().mockResolvedValue(true),
    create: jest.fn().mockImplementation((data) => Promise.resolve(makeCommand(data))),
    markDone: jest.fn(),
    markFailed: jest.fn(),
  } as unknown as CommandsRepository;

  const processor = {
    process: jest.fn().mockImplementation((command: Command) => Promise.resolve({ ...command, status: 'DONE' })),
  } as unknown as ICommandProcessor;

  return { repository, processor };
}

describe('CommandsService.enqueue', () => {
  it('persists a new command and hands it to the processor', async () => {
    const { repository, processor } = createMocks();
    const service = new CommandsService(repository, processor);

    const result = await service.enqueue({ id: 'cmd-1', userId: 'user-1', type: 'ADD_FAVORITE', channelId: 42 });

    expect(repository.channelExists).toHaveBeenCalledWith(42);
    expect(repository.create).toHaveBeenCalledWith({
      id: 'cmd-1',
      userId: 'user-1',
      type: 'ADD_FAVORITE',
      channelId: 42,
    });
    expect(processor.process).toHaveBeenCalled();
    expect(result.status).toBe('DONE');
  });

  it('is idempotent: the same id, user and payload returns the existing command and creates nothing', async () => {
    const { repository, processor } = createMocks();
    const existing = makeCommand({ status: 'DONE' });
    (repository.findById as jest.Mock).mockResolvedValue(existing);
    const service = new CommandsService(repository, processor);

    const result = await service.enqueue({ id: 'cmd-1', userId: 'user-1', type: 'ADD_FAVORITE', channelId: 42 });

    expect(result).toBe(existing);
    expect(repository.create).not.toHaveBeenCalled();
    expect(processor.process).not.toHaveBeenCalled();
  });

  it('rejects the same id from a different user with 409', async () => {
    const { repository, processor } = createMocks();
    (repository.findById as jest.Mock).mockResolvedValue(makeCommand({ userId: 'user-1' }));
    const service = new CommandsService(repository, processor);

    await expect(
      service.enqueue({ id: 'cmd-1', userId: 'user-2', type: 'ADD_FAVORITE', channelId: 42 }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('rejects the same id and user with a different payload with 409', async () => {
    const { repository, processor } = createMocks();
    (repository.findById as jest.Mock).mockResolvedValue(
      makeCommand({ userId: 'user-1', type: 'ADD_FAVORITE', channelId: 42 }),
    );
    const service = new CommandsService(repository, processor);

    await expect(
      service.enqueue({ id: 'cmd-1', userId: 'user-1', type: 'ADD_FAVORITE', channelId: 99 }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('a racing duplicate insert (unique constraint violation) returns the winner instead of throwing', async () => {
    const { repository, processor } = createMocks();
    const winner = makeCommand({ status: 'DONE' });
    (repository.create as jest.Mock).mockRejectedValueOnce(uniqueConstraintError());
    (repository.findById as jest.Mock)
      .mockResolvedValueOnce(null) // the initial lookup: not found yet, so we try to create
      .mockResolvedValueOnce(winner); // re-fetch after the unique constraint violation
    const service = new CommandsService(repository, processor);

    const result = await service.enqueue({ id: 'cmd-1', userId: 'user-1', type: 'ADD_FAVORITE', channelId: 42 });

    expect(result).toBe(winner);
    expect(processor.process).not.toHaveBeenCalled();
  });

  it('a racing duplicate insert from a different user still conflicts with 409', async () => {
    const { repository, processor } = createMocks();
    const winner = makeCommand({ userId: 'user-1' });
    (repository.create as jest.Mock).mockRejectedValueOnce(uniqueConstraintError());
    (repository.findById as jest.Mock).mockResolvedValueOnce(null).mockResolvedValueOnce(winner);
    const service = new CommandsService(repository, processor);

    await expect(
      service.enqueue({ id: 'cmd-1', userId: 'user-2', type: 'ADD_FAVORITE', channelId: 42 }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('a non-unique-constraint error from create() is not swallowed', async () => {
    const { repository, processor } = createMocks();
    const dbError = new Error('connection reset');
    (repository.create as jest.Mock).mockRejectedValueOnce(dbError);
    const service = new CommandsService(repository, processor);

    await expect(
      service.enqueue({ id: 'cmd-1', userId: 'user-1', type: 'ADD_FAVORITE', channelId: 42 }),
    ).rejects.toBe(dbError);
  });

  it('rejects an unknown channel with 404 and never creates a command', async () => {
    const { repository, processor } = createMocks();
    (repository.channelExists as jest.Mock).mockResolvedValue(false);
    const service = new CommandsService(repository, processor);

    await expect(
      service.enqueue({ id: 'cmd-1', userId: 'user-1', type: 'ADD_FAVORITE', channelId: 999999 }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repository.create).not.toHaveBeenCalled();
    expect(processor.process).not.toHaveBeenCalled();
  });

  it('rejects REFRESH_CHANNEL with 400 before touching the repository', async () => {
    const { repository, processor } = createMocks();
    const service = new CommandsService(repository, processor);

    await expect(
      service.enqueue({ id: 'cmd-1', userId: 'user-1', type: 'REFRESH_CHANNEL', channelId: 42 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.findById).not.toHaveBeenCalled();
    expect(repository.create).not.toHaveBeenCalled();
  });
});

describe('CommandsService.getStatus', () => {
  it('returns the command for its owner', async () => {
    const { repository, processor } = createMocks();
    const command = makeCommand();
    (repository.findById as jest.Mock).mockResolvedValue(command);
    const service = new CommandsService(repository, processor);

    await expect(service.getStatus('cmd-1', 'user-1')).resolves.toBe(command);
  });

  it('gives 404 (not 403) to anyone other than the owner', async () => {
    const { repository, processor } = createMocks();
    (repository.findById as jest.Mock).mockResolvedValue(makeCommand({ userId: 'user-1' }));
    const service = new CommandsService(repository, processor);

    await expect(service.getStatus('cmd-1', 'user-2')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('gives 404 for an unknown command id', async () => {
    const { repository, processor } = createMocks();
    const service = new CommandsService(repository, processor);

    await expect(service.getStatus('nope', 'user-1')).rejects.toBeInstanceOf(NotFoundException);
  });
});
