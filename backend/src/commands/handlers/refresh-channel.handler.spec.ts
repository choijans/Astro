import { UnrecoverableError } from 'bullmq';
import type { Command, Prisma } from '../../../generated/prisma/client';
import type {
  AstroListSnapshot,
  CachedAstroClient,
} from '../../astro/cached-astro-client';
import type { AstroChannelRecord } from '../../astro/astro.types';
import { RefreshChannelHandler } from './refresh-channel.handler';

function makeRecord(
  overrides: Partial<AstroChannelRecord> = {},
): AstroChannelRecord {
  return {
    id: 42,
    title: 'Astro30',
    subtitle: 'CH 30',
    imageUrl: 'https://example.com/30.png',
    detailUrl: 'https://example.com/30',
    stbNumber: '30',
    category: 'News',
    genreKey: ['news'],
    languageKey: ['english'],
    rangeKey: '0_199',
    ranking: 1,
    currentSchedule: [
      {
        id: 'ev-1',
        siTrafficKey: 'si-1',
        title: 'Live Now',
        eventStartMyt: '2026-01-01T08:00:00+08:00',
        eventEndMyt: '2026-01-01T09:00:00+08:00',
        detailUrl: 'https://example.com/ev-1',
      },
    ],
    ...overrides,
  };
}

function makeCommand(overrides: Partial<Command> = {}): Command {
  return {
    id: 'cmd-1',
    userId: 'user-1',
    channelId: 42,
    type: 'REFRESH_CHANNEL',
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

function createTxMock(updateManyCount = 1): Prisma.TransactionClient {
  return {
    channel: {
      updateMany: jest.fn().mockResolvedValue({ count: updateManyCount }),
    },
  } as unknown as Prisma.TransactionClient;
}

function makeCachedAstroClient(snapshot: AstroListSnapshot): CachedAstroClient {
  return {
    getSnapshot: jest.fn().mockResolvedValue(snapshot),
  } as unknown as CachedAstroClient;
}

describe('RefreshChannelHandler', () => {
  it("updates only the command's channel row, using the mapper's output", async () => {
    const fetchedAt = new Date('2026-01-01T12:00:00Z');
    const record = makeRecord({ id: 42, title: 'Astro30 Updated', ranking: 7 });
    const cachedAstroClient = makeCachedAstroClient({
      records: [record],
      fetchedAt,
    });
    const handler = new RefreshChannelHandler(cachedAstroClient);
    const tx = createTxMock();

    await handler.handle(makeCommand({ channelId: 42 }), tx);

    expect(tx.channel.updateMany).toHaveBeenCalledTimes(1);
    const [call] = (tx.channel.updateMany as jest.Mock).mock.calls;
    expect(call[0].where).toEqual({
      id: 42,
      scheduleUpdatedAt: { lt: fetchedAt },
    });
    expect(call[0].data).toMatchObject({
      title: 'Astro30 Updated',
      ranking: 7,
    });
    expect(call[0].data).not.toHaveProperty('createdAt');
  });

  it('scheduleUpdatedAt equals the cache snapshot fetch time, not the current time', async () => {
    const fetchedAt = new Date('2026-01-01T12:00:00Z');
    const record = makeRecord({ id: 42 });
    const cachedAstroClient = makeCachedAstroClient({
      records: [record],
      fetchedAt,
    });
    const handler = new RefreshChannelHandler(cachedAstroClient);
    const tx = createTxMock();

    await handler.handle(makeCommand({ channelId: 42 }), tx);

    const [call] = (tx.channel.updateMany as jest.Mock).mock.calls;
    expect(call[0].data.scheduleUpdatedAt).toEqual(fetchedAt);
  });

  it('writes when the stored scheduleUpdatedAt is older than the snapshot fetch time', async () => {
    const fetchedAt = new Date('2026-01-01T12:00:00Z');
    const cachedAstroClient = makeCachedAstroClient({
      records: [makeRecord({ id: 42 })],
      fetchedAt,
    });
    const handler = new RefreshChannelHandler(cachedAstroClient);
    const tx = createTxMock(1); // simulates one row matching the `lt` condition

    await expect(
      handler.handle(makeCommand({ channelId: 42 }), tx),
    ).resolves.toBeUndefined();

    expect(tx.channel.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 42, scheduleUpdatedAt: { lt: fetchedAt } },
      }),
    );
  });

  it('treats "nothing updated because the stored data is already at least as fresh" as success, not a failure', async () => {
    const fetchedAt = new Date('2026-01-01T12:00:00Z');
    const cachedAstroClient = makeCachedAstroClient({
      records: [makeRecord({ id: 42 })],
      fetchedAt,
    });
    const handler = new RefreshChannelHandler(cachedAstroClient);
    const tx = createTxMock(0); // simulates no row matching the `lt` condition

    await expect(
      handler.handle(makeCommand({ channelId: 42 }), tx),
    ).resolves.toBeUndefined();

    expect(tx.channel.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 42, scheduleUpdatedAt: { lt: fetchedAt } },
      }),
    );
  });

  it('a channel missing from the fetched list throws UnrecoverableError and never touches the database', async () => {
    const cachedAstroClient = makeCachedAstroClient({
      records: [makeRecord({ id: 1 }), makeRecord({ id: 2 })],
      fetchedAt: new Date(),
    });
    const handler = new RefreshChannelHandler(cachedAstroClient);
    const tx = createTxMock();

    await expect(
      handler.handle(makeCommand({ channelId: 999999 }), tx),
    ).rejects.toBeInstanceOf(UnrecoverableError);
    expect(tx.channel.updateMany).not.toHaveBeenCalled();
  });

  it('a transient failure fetching the list (e.g. AstroApiError) propagates normally, not as UnrecoverableError', async () => {
    const cachedAstroClient = {
      getSnapshot: jest
        .fn()
        .mockRejectedValue(new Error('Astro request failed: timeout')),
    } as unknown as CachedAstroClient;
    const handler = new RefreshChannelHandler(cachedAstroClient);
    const tx = createTxMock();

    const result = handler.handle(makeCommand(), tx);
    await expect(result).rejects.toThrow('Astro request failed: timeout');
    await expect(result).rejects.not.toBeInstanceOf(UnrecoverableError);
    expect(tx.channel.updateMany).not.toHaveBeenCalled();
  });
});
