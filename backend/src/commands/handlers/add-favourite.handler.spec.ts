import type { Command } from '../../../generated/prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import { AddFavouriteHandler } from './add-favourite.handler';

function createPrismaMock(): PrismaService {
  return {
    favourite: { upsert: jest.fn().mockResolvedValue({}) },
  } as unknown as PrismaService;
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

describe('AddFavouriteHandler', () => {
  it('upserts the favourite for the command\'s user and channel', async () => {
    const prisma = createPrismaMock();
    const handler = new AddFavouriteHandler(prisma);

    await handler.handle(makeCommand());

    expect(prisma.favourite.upsert).toHaveBeenCalledWith({
      where: { userId_channelId: { userId: 'user-1', channelId: 42 } },
      create: { userId: 'user-1', channelId: 42 },
      update: {},
    });
  });

  it('adding an already-favourited channel succeeds without throwing (idempotent)', async () => {
    const prisma = createPrismaMock();
    const handler = new AddFavouriteHandler(prisma);

    await expect(handler.handle(makeCommand())).resolves.toBeUndefined();
    await expect(handler.handle(makeCommand())).resolves.toBeUndefined();
    expect(prisma.favourite.upsert).toHaveBeenCalledTimes(2);
  });
});
