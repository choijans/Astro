import type { Command, Prisma } from '../../../generated/prisma/client';
import { RemoveFavouriteHandler } from './remove-favourite.handler';

function createTxMock(): Prisma.TransactionClient {
  return {
    favourite: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
  } as unknown as Prisma.TransactionClient;
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
    processingStartedAt: null,
    ...overrides,
  };
}

describe('RemoveFavouriteHandler', () => {
  it("deletes the favourite for the command's user and channel, via the given transaction", async () => {
    const tx = createTxMock();
    const handler = new RemoveFavouriteHandler();

    await handler.handle(makeCommand(), tx);

    expect(tx.favourite.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', channelId: 42 },
    });
  });

  it('removing an absent favourite succeeds without throwing (idempotent)', async () => {
    const tx = createTxMock();
    const handler = new RemoveFavouriteHandler();

    await expect(handler.handle(makeCommand(), tx)).resolves.toBeUndefined();
  });
});
