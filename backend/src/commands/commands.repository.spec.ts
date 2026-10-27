import type { PrismaService } from '../prisma/prisma.service';
import { CommandsRepository } from './commands.repository';

function createPrismaMock(): PrismaService {
  return {
    command: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  } as unknown as PrismaService;
}

describe('CommandsRepository.findPendingForSweep', () => {
  it('matches PENDING status only — DONE, FAILED and PROCESSING can never be returned', async () => {
    const prisma = createPrismaMock();
    const repo = new CommandsRepository(prisma);

    await repo.findPendingForSweep(200, 2000);

    const args = (prisma.command.findMany as jest.Mock).mock.calls[0][0];
    expect(args.where.status).toBe('PENDING');
  });

  it('orders oldest seq first', async () => {
    const prisma = createPrismaMock();
    const repo = new CommandsRepository(prisma);

    await repo.findPendingForSweep(200, 2000);

    const args = (prisma.command.findMany as jest.Mock).mock.calls[0][0];
    expect(args.orderBy).toEqual({ seq: 'asc' });
  });

  it('honours the given batch size via take', async () => {
    const prisma = createPrismaMock();
    const repo = new CommandsRepository(prisma);

    await repo.findPendingForSweep(37, 2000);

    const args = (prisma.command.findMany as jest.Mock).mock.calls[0][0];
    expect(args.take).toBe(37);
  });

  it('excludes anything created within the grace window (createdAt < now - graceMs)', async () => {
    const prisma = createPrismaMock();
    const repo = new CommandsRepository(prisma);
    const before = Date.now();

    await repo.findPendingForSweep(200, 2000);

    const args = (prisma.command.findMany as jest.Mock).mock.calls[0][0];
    const cutoff = (args.where.createdAt.lt as Date).getTime();
    // Cutoff should be ~2000ms before "now" at call time, not before/after
    // some other window — allow a little slack for test execution time.
    expect(cutoff).toBeGreaterThanOrEqual(before - 2000 - 50);
    expect(cutoff).toBeLessThanOrEqual(before - 2000 + 50);
  });
});

describe('CommandsRepository.findStaleProcessingForSweep', () => {
  it('matches PROCESSING status only — PENDING, DONE and FAILED can never be returned', async () => {
    const prisma = createPrismaMock();
    const repo = new CommandsRepository(prisma);

    await repo.findStaleProcessingForSweep(200, 45000);

    const args = (prisma.command.findMany as jest.Mock).mock.calls[0][0];
    expect(args.where.status).toBe('PROCESSING');
  });

  it('orders oldest seq first and honours the given batch size via take', async () => {
    const prisma = createPrismaMock();
    const repo = new CommandsRepository(prisma);

    await repo.findStaleProcessingForSweep(37, 45000);

    const args = (prisma.command.findMany as jest.Mock).mock.calls[0][0];
    expect(args.orderBy).toEqual({ seq: 'asc' });
    expect(args.take).toBe(37);
  });

  it('excludes anything whose processingStartedAt is within staleMs (processingStartedAt < now - staleMs)', async () => {
    const prisma = createPrismaMock();
    const repo = new CommandsRepository(prisma);
    const before = Date.now();

    await repo.findStaleProcessingForSweep(200, 45000);

    const args = (prisma.command.findMany as jest.Mock).mock.calls[0][0];
    const cutoff = (args.where.processingStartedAt.lt as Date).getTime();
    expect(cutoff).toBeGreaterThanOrEqual(before - 45000 - 50);
    expect(cutoff).toBeLessThanOrEqual(before - 45000 + 50);
  });
});
