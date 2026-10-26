import type { Command } from '../../../generated/prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import { RemoveFavouriteHandler } from './remove-favourite.handler';

function createPrismaMock(): PrismaService {
  return {
    favourite: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
  } as unknown as PrismaService;
}

function makeCommand(overrides: Partial<Command> = {}): Command {
  return {
    id: 'cmd-1',
    userId: 'user-1',
    channelId: 42,
    type: 'REMOVE_FAVORITE',
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

describe('RemoveFavouriteHandler', () => {
  it('deletes the favourite for the command\'s user and channel', async () => {
    const prisma = createPrismaMock();
    const handler = new RemoveFavouriteHandler(prisma);

    await handler.handle(makeCommand());

    expect(prisma.favourite.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', channelId: 42 },
    });
  });

  it('removing an absent favourite succeeds without throwing (idempotent)', async () => {
    const prisma = createPrismaMock();
    const handler = new RemoveFavouriteHandler(prisma);

    await expect(handler.handle(makeCommand())).resolves.toBeUndefined();
  });
});
