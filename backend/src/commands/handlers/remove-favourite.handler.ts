import { Injectable } from '@nestjs/common';
import type { Command, Prisma } from '../../../generated/prisma/client';
import { CommandType } from '../../../generated/prisma/client';
import { ICommandHandler } from '../command-handler.interface';

@Injectable()
export class RemoveFavouriteHandler implements ICommandHandler {
  readonly type = CommandType.REMOVE_FAVORITE;

  /** Removing an absent favourite is a no-op success, not an error. */
  async handle(command: Command, tx: Prisma.TransactionClient): Promise<void> {
    await tx.favourite.deleteMany({
      where: { userId: command.userId, channelId: command.channelId },
    });
  }
}
