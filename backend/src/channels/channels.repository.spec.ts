import type { PrismaService } from '../prisma/prisma.service';
import { ChannelsRepository } from './channels.repository';

function createPrismaMock(): PrismaService {
  return {
    channel: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    $transaction: jest
      .fn()
      .mockImplementation(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  } as unknown as PrismaService;
}

const baseParams = {
  sort: 'stbNumber' as const,
  order: 'asc' as const,
  page: 1,
  limit: 24,
};

describe('ChannelsRepository.findMany — q boundary handling', () => {
  it('matches stbNumber exactly for an in-range numeric q', async () => {
    const prisma = createPrismaMock();
    const repo = new ChannelsRepository(prisma);

    await repo.findMany({ ...baseParams, q: '100' });

    const where = (prisma.channel.findMany as jest.Mock).mock.calls[0][0].where;
    expect(where.OR).toContainEqual({ stbNumber: 100 });
  });

  it('never passes a q outside Postgres integer range to stbNumber (would 500 otherwise)', async () => {
    const prisma = createPrismaMock();
    const repo = new ChannelsRepository(prisma);

    await repo.findMany({ ...baseParams, q: '99999999999999' });

    const where = (prisma.channel.findMany as jest.Mock).mock.calls[0][0].where;
    expect(where.OR).toEqual([
      { title: { contains: '99999999999999', mode: 'insensitive' } },
    ]);
  });

  it('treats the Postgres integer boundary values themselves as numeric', async () => {
    const prisma = createPrismaMock();
    const repo = new ChannelsRepository(prisma);

    await repo.findMany({ ...baseParams, q: '2147483647' });

    const where = (prisma.channel.findMany as jest.Mock).mock.calls[0][0].where;
    expect(where.OR).toContainEqual({ stbNumber: 2147483647 });
  });
});
