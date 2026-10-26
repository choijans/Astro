import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ChannelsModule } from './channels/channels.module';
import { ClockModule } from './common/clock.module';
import { CommandsModule } from './commands/commands.module';
import { FavouritesModule } from './favourites/favourites.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [PrismaModule, ClockModule, ChannelsModule, CommandsModule, FavouritesModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
