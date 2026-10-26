import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ChannelsModule } from './channels/channels.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [PrismaModule, ChannelsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
