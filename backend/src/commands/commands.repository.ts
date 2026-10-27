import { Injectable } from '@nestjs/common';
import type { Command, CommandType } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateCommandData {
  id: string;
  userId: string;
  type: CommandType;
  channelId: number;
}

/** The only class that touches Prisma for commands (and the channel-existence check). */
@Injectable()
export class CommandsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<Command | null> {
    return this.prisma.command.findUnique({ where: { id } });
  }

  async create(data: CreateCommandData): Promise<Command> {
    return this.prisma.command.create({
      data: {
        id: data.id,
        userId: data.userId,
        type: data.type,
        channelId: data.channelId,
        status: 'PENDING',
        payload: { channelId: data.channelId },
      },
    });
  }

  async markDone(id: string): Promise<Command> {
    return this.prisma.command.update({
      where: { id },
      data: { status: 'DONE', processedAt: new Date(), processingStartedAt: null },
    });
  }

  /** Marks the start of one worker attempt: PROCESSING, with attempts incremented
   * exactly once per attempt. markFailed doesn't increment again. */
  async markProcessing(id: string): Promise<Command> {
    return this.prisma.command.update({
      where: { id },
      data: { status: 'PROCESSING', attempts: { increment: 1 }, processingStartedAt: new Date() },
    });
  }

  /** Mid-retry failure: back to PENDING so the command's own state reflects
   * "not yet resolved" while BullMQ's backoff schedules the next attempt. */
  async markPendingForRetry(id: string): Promise<Command> {
    return this.prisma.command.update({
      where: { id },
      data: { status: 'PENDING', processingStartedAt: null },
    });
  }

  async markFailed(id: string, error: string): Promise<Command> {
    return this.prisma.command.update({
      where: { id },
      data: { status: 'FAILED', error, processedAt: new Date(), processingStartedAt: null },
    });
  }

  /** Oldest seq first, in batches, excluding anything created within the
   * last `graceMs` — used by the recovery sweep, never touches DONE, FAILED
   * or PROCESSING rows. */
  async findPendingForSweep(
    batchSize: number,
    graceMs: number,
  ): Promise<Command[]> {
    const cutoff = new Date(Date.now() - graceMs);
    return this.prisma.command.findMany({
      where: { status: 'PENDING', createdAt: { lt: cutoff } },
      orderBy: { seq: 'asc' },
      take: batchSize,
    });
  }

  /** PROCESSING commands whose worker attempt started more than `staleMs` ago
   * — the worker that picked them up is presumed dead (crashed, or its
   * BullMQ job stalled past the point BullMQ itself would recover it). Oldest
   * first, in batches, same shape as findPendingForSweep. */
  async findStaleProcessingForSweep(
    batchSize: number,
    staleMs: number,
  ): Promise<Command[]> {
    const cutoff = new Date(Date.now() - staleMs);
    return this.prisma.command.findMany({
      where: { status: 'PROCESSING', processingStartedAt: { lt: cutoff } },
      orderBy: { seq: 'asc' },
      take: batchSize,
    });
  }

  /** Resets a stale PROCESSING command back to PENDING so the sweep can
   * re-enqueue it through the normal job-add path. */
  async resetStaleProcessingToPending(id: string): Promise<Command> {
    return this.prisma.command.update({
      where: { id },
      data: { status: 'PENDING', processingStartedAt: null },
    });
  }

  async channelExists(channelId: number): Promise<boolean> {
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: { id: true },
    });
    return channel !== null;
  }
}
