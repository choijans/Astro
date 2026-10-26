import { Injectable } from '@nestjs/common';
import type { Command } from '../../../generated/prisma/client';
import { CommandType } from '../../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ICommandHandler } from '../command-handler.interface';

@Injectable()
export class RemoveFavouriteHandler implements ICommandHandler {
  readonly type = CommandType.REMOVE_FAVORITE;

  constructor(private readonly prisma: PrismaService) {}

  /** Removing an absent favourite is a no-op success, not an error. */
  async handle(command: Command): Promise<void> {
    await this.prisma.favourite.deleteMany({
      where: { userId: command.userId, channelId: command.channelId },
    });
  }
}
