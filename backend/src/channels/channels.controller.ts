import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { ChannelsService } from './channels.service';
import { ListChannelsQueryDto } from './dto/list-channels-query.dto';

@Controller('channels')
export class ChannelsController {
  constructor(private readonly channelsService: ChannelsService) {}

  @Get()
  list(@Query() query: ListChannelsQueryDto) {
    return this.channelsService.list(query);
  }

  // Must be declared before ':id' so it isn't matched as an id param.
  @Get('filters')
  getFilters() {
    return this.channelsService.getFilters();
  }

  @Get(':id')
  getById(@Param('id', ParseIntPipe) id: number) {
    return this.channelsService.getById(id);
  }
}
