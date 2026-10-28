import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { CacheService } from '../common/cache/cache.service';
import {
  getDetailCacheTtlSeconds,
  getListCacheTtlSeconds,
} from '../common/cache/cache.config';
import {
  buildChannelDetailCacheKey,
  buildChannelListCacheKey,
} from './channels-cache-key';
import { ChannelsService } from './channels.service';
import { ListChannelsQueryDto } from './dto/list-channels-query.dto';

@Controller('channels')
export class ChannelsController {
  constructor(
    private readonly channelsService: ChannelsService,
    private readonly cache: CacheService,
  ) {}

  // Channel list items carry no per-user data (no favourite flag, no user
  // id) — only `channelId`/`title`/`stbNumber`/schedule-derived fields — so
  // caching this response is safe to share across every caller.
  @Get()
  list(
    @Query() query: ListChannelsQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.cache.wrap(
      buildChannelListCacheKey(query),
      getListCacheTtlSeconds(),
      () => this.channelsService.list(query),
      res,
    );
  }

  // Must be declared before ':id' so it isn't matched as an id param.
  @Get('filters')
  getFilters() {
    return this.channelsService.getFilters();
  }

  @Get(':id')
  getById(
    @Param('id', ParseIntPipe) id: number,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.cache.wrap(
      buildChannelDetailCacheKey(id),
      getDetailCacheTtlSeconds(),
      () => this.channelsService.getById(id),
      res,
    );
  }
}
