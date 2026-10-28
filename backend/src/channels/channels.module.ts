import { Module } from '@nestjs/common';
import { CacheModule } from '../common/cache/cache.module';
import { ChannelsController } from './channels.controller';
import { ChannelsRepository } from './channels.repository';
import { ChannelsService } from './channels.service';

@Module({
  imports: [CacheModule],
  controllers: [ChannelsController],
  providers: [ChannelsService, ChannelsRepository],
})
export class ChannelsModule {}
