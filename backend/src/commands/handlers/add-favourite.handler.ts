import { Injectable } from '@nestjs/common';
import type { Command } from '../../../generated/prisma/client';
import { CommandType } from '../../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ICommandHandler } from '../command-handler.interface';

@Injectable()
export class AddFavouriteHandler implements ICommandHandler {
  readonly type = CommandType.ADD_FAVORITE;

  constructor(private readonly prisma: PrismaService) {}

  /** Adding an already-favourited channel is a no-op success, not an error. */
  async handle(command: Command): Promise<void> {
    await this.prisma.favourite.upsert({
      where: { userId_channelId: { userId: command.userId, channelId: command.channelId } },
      create: { userId: command.userId, channelId: command.channelId },
      update: {},
    });
  }
}
