import { Injectable } from '@nestjs/common';
import type { Command, Prisma } from '../../../generated/prisma/client';
import { CommandType } from '../../../generated/prisma/client';
import { ICommandHandler } from '../command-handler.interface';

@Injectable()
export class AddFavouriteHandler implements ICommandHandler {
  readonly type = CommandType.ADD_FAVORITE;

  /** Adding an already-favourited channel is a no-op success, not an error. */
  async handle(command: Command, tx: Prisma.TransactionClient): Promise<void> {
    await tx.favourite.upsert({
      where: { userId_channelId: { userId: command.userId, channelId: command.channelId } },
      create: { userId: command.userId, channelId: command.channelId },
      update: {},
    });
  }
}
