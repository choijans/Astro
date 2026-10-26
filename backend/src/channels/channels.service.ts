import { Injectable, NotFoundException } from '@nestjs/common';
import { ChannelsRepository } from './channels.repository';
import { ChannelFilters, PaginatedChannels } from './channels.types';
import { ListChannelsQueryDto } from './dto/list-channels-query.dto';

@Injectable()
export class ChannelsService {
  constructor(private readonly channelsRepository: ChannelsRepository) {}

  async list(query: ListChannelsQueryDto): Promise<PaginatedChannels<unknown>> {
    const { data, total } = await this.channelsRepository.findMany(query);

    return {
      data,
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
