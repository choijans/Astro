import type { Command, Prisma } from '../../../generated/prisma/client';
import { AddFavouriteHandler } from './add-favourite.handler';

function createTxMock(): Prisma.TransactionClient {
  return {
    favourite: { upsert: jest.fn().mockResolvedValue({}) },
  } as unknown as Prisma.TransactionClient;
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
    processingStartedAt: null,
    ...overrides,
  } as Command;
}

describe('AddFavouriteHandler', () => {
  it("upserts the favourite for the command's user and channel, via the given transaction", async () => {
    const tx = createTxMock();
    const handler = new AddFavouriteHandler();

    await handler.handle(makeCommand(), tx);

    expect(tx.favourite.upsert).toHaveBeenCalledWith({
      where: { userId_channelId: { userId: 'user-1', channelId: 42 } },
      create: { userId: 'user-1', channelId: 42 },
      update: {},
    });
  });

  it('adding an already-favourited channel succeeds without throwing (idempotent)', async () => {
    const tx = createTxMock();
    const handler = new AddFavouriteHandler();

    await expect(handler.handle(makeCommand(), tx)).resolves.toBeUndefined();
    await expect(handler.handle(makeCommand(), tx)).resolves.toBeUndefined();
    expect(tx.favourite.upsert).toHaveBeenCalledTimes(2);
  });
});
