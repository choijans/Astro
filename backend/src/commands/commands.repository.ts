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
      data: { status: 'DONE', processedAt: new Date() },
    });
  }

  /** Marks the start of one worker attempt: PROCESSING, with attempts incremented
   * exactly once per attempt. markFailed doesn't increment again. */
  async markProcessing(id: string): Promise<Command> {
    return this.prisma.command.update({
      where: { id },
      data: { status: 'PROCESSING', attempts: { increment: 1 } },
    });
  }

  /** Mid-retry failure: back to PENDING so the command's own state reflects
   * "not yet resolved" while BullMQ's backoff schedules the next attempt. */
  async markPendingForRetry(id: string): Promise<Command> {
    return this.prisma.command.update({
      where: { id },
      data: { status: 'PENDING' },
    });
  }

  async markFailed(id: string, error: string): Promise<Command> {
    return this.prisma.command.update({
      where: { id },
      data: { status: 'FAILED', error, processedAt: new Date() },
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
