import { Injectable } from '@nestjs/common';
import { CommandType } from '../../generated/prisma/client';
import { CommandsService } from '../commands/commands.service';
import { FavouritesRepository } from './favourites.repository';

/** A thin wrapper: every write goes through CommandsService.enqueue(), never Prisma directly. */
@Injectable()
export class FavouritesService {
  constructor(
    private readonly commandsService: CommandsService,
    private readonly favouritesRepository: FavouritesRepository,
  ) {}

  list(userId: string) {
    return this.favouritesRepository.listFavourites(userId);
  }

  add(userId: string, channelId: number, commandId: string) {
    return this.commandsService.enqueue({
      id: commandId,
      userId,
      type: CommandType.ADD_FAVORITE,
      channelId,
    });
  }

  remove(userId: string, channelId: number, commandId: string) {
    return this.commandsService.enqueue({
      id: commandId,
      userId,
      type: CommandType.REMOVE_FAVORITE,
      channelId,
    });
  }
}
