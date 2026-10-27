import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CLOCK } from '../common/clock';
import type { Clock } from '../common/clock';
import { ChannelListItem, toChannelListItem } from './channel-list-item.mapper';
import { ChannelsRepository } from './channels.repository';
import { ChannelFilters, PaginatedChannels } from './channels.types';
import { ListChannelsQueryDto } from './dto/list-channels-query.dto';

@Injectable()
export class ChannelsService {
  constructor(
    private readonly channelsRepository: ChannelsRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async list(
    query: ListChannelsQueryDto,
  ): Promise<PaginatedChannels<ChannelListItem>> {
    const { data, total } = await this.channelsRepository.findMany(query);
    const at = this.clock.now();

    return {
      data: data.map((row) => toChannelListItem(row, at)),
      page: query.page,
      limit: query.limit,
      total,
      hasNextPage: query.page * query.limit < total,
    };
  }

  async getFilters(): Promise<ChannelFilters> {
    return this.channelsRepository.getFilters();
  }

  async getById(id: number) {
    const channel = await this.channelsRepository.findById(id);
    if (!channel) {
      throw new NotFoundException(`Channel ${id} not found`);
    }
    return channel;
  }
}
