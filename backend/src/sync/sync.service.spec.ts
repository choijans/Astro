import { AstroApiError } from '../astro/astro-client.interface';
import type { IAstroClient } from '../astro/astro-client.interface';
import { FixtureAstroClient } from '../astro/fixture-astro-client';
import type { PrismaService } from '../prisma/prisma.service';
import { SyncService } from './sync.service';

function createPrismaMock(): PrismaService {
  return {
    channel: { upsert: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn().mockImplementation((ops: unknown[]) => ops),
  } as unknown as PrismaService;
}

describe('SyncService.upsertAll', () => {
  it('is idempotent: running twice against the same data upserts the same channels', async () => {
    const prisma = createPrismaMock();
    const service = new SyncService(new FixtureAstroClient(), prisma);

    const first = await service.upsertAll();
    const firstCalls = (prisma.channel.upsert as jest.Mock).mock.calls.map(
      (call) => call[0],
    );

    (prisma.channel.upsert as jest.Mock).mockClear();
    (prisma.$transaction as jest.Mock).mockClear();

    const second = await service.upsertAll();
    const secondCalls = (prisma.channel.upsert as jest.Mock).mock.calls.map(
      (call) => call[0],
    );

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(second.upserted).toBe(first.upserted);
    expect(secondCalls.length).toBe(firstCalls.length);
    expect(secondCalls.map((c) => c.where.id)).toEqual(
      firstCalls.map((c) => c.where.id),
    );
  });

  it('never includes createdAt in the update payload, so it can never overwrite it', async () => {
    const prisma = createPrismaMock();
    const service = new SyncService(new FixtureAstroClient(), prisma);

    await service.upsertAll();

    const calls = (prisma.channel.upsert as jest.Mock).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    for (const [args] of calls) {
      expect(args.update).not.toHaveProperty('createdAt');
    }
  });

  it('fails gracefully and never touches Prisma when the Astro client throws', async () => {
    const prisma = createPrismaMock();
    const failingClient: IAstroClient = {
      fetchChannels: jest.fn().mockRejectedValue(new Error('network down')),
    };
    const service = new SyncService(failingClient, prisma);

    const result = await service.upsertAll();

    expect(result).toEqual({ ok: false, upserted: 0, error: 'network down' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('fails gracefully on a bad responseCode from the Astro client', async () => {
    const prisma = createPrismaMock();
    const badCodeClient: IAstroClient = {
      fetchChannels: jest
        .fn()
        .mockRejectedValue(
          new AstroApiError('Astro responded with responseCode 500: fail'),
        ),
    };
    const service = new SyncService(badCodeClient, prisma);

    const result = await service.upsertAll();

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/responseCode 500/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
