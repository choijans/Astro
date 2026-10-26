import { Module } from '@nestjs/common';
import { CommandHandlerRegistry } from './command-handler-registry';
import { COMMAND_HANDLER } from './command-handler.interface';
import { COMMAND_PROCESSOR } from './command-processor.interface';
import { CommandsController } from './commands.controller';
import { CommandsRepository } from './commands.repository';
import { CommandsService } from './commands.service';
import { AddFavouriteHandler } from './handlers/add-favourite.handler';
import { RemoveFavouriteHandler } from './handlers/remove-favourite.handler';
import { SynchronousCommandProcessor } from './synchronous-command-processor';

@Module({
  controllers: [CommandsController],
  providers: [
    CommandsService,
    CommandsRepository,
    AddFavouriteHandler,
    RemoveFavouriteHandler,
    {
      provide: COMMAND_HANDLER,
      useFactory: (add: AddFavouriteHandler, remove: RemoveFavouriteHandler) => [add, remove],
      inject: [AddFavouriteHandler, RemoveFavouriteHandler],
    },
    CommandHandlerRegistry,
    { provide: COMMAND_PROCESSOR, useClass: SynchronousCommandProcessor },
  ],
  exports: [CommandsService],
})
export class CommandsModule {}
