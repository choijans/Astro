import { Inject, Injectable } from '@nestjs/common';
import { CommandType } from '../../generated/prisma/client';
import { toChannelListItem } from '../channels/channel-list-item.mapper';
import { CLOCK } from '../common/clock';
import type { Clock } from '../common/clock';
import { CommandsService } from '../commands/commands.service';
import { FavouritesRepository } from './favourites.repository';

/** A thin wrapper: every write goes through CommandsService.enqueue(), never Prisma directly. */
@Injectable()
export class FavouritesService {
  constructor(
    private readonly commandsService: CommandsService,
    private readonly favouritesRepository: FavouritesRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async list(userId: string) {
    const channels = await this.favouritesRepository.listFavourites(userId);
    const at = this.clock.now();
    return channels.map((channel) => toChannelListItem(channel, at));
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
