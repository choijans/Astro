import { Module } from '@nestjs/common';
import { CommandsModule } from '../commands/commands.module';
import { FavouritesController } from './favourites.controller';
import { FavouritesRepository } from './favourites.repository';
import { FavouritesService } from './favourites.service';

@Module({
  imports: [CommandsModule],
  controllers: [FavouritesController],
  providers: [FavouritesService, FavouritesRepository],
})
export class FavouritesModule {}
