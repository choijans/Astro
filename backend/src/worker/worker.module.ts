import { Module } from '@nestjs/common';
import { CommandHandlerRegistry } from '../commands/command-handler-registry';
import { COMMAND_HANDLER } from '../commands/command-handler.interface';
import { CommandsRepository } from '../commands/commands.repository';
import { AddFavouriteHandler } from '../commands/handlers/add-favourite.handler';
import { RemoveFavouriteHandler } from '../commands/handlers/remove-favourite.handler';
import { PrismaModule } from '../prisma/prisma.module';
import { CommandWorkerService } from './command-worker.service';

@Module({
  imports: [PrismaModule],
  providers: [
    CommandsRepository,
    AddFavouriteHandler,
    RemoveFavouriteHandler,
    {
      provide: COMMAND_HANDLER,
      useFactory: (add: AddFavouriteHandler, remove: RemoveFavouriteHandler) => [add, remove],
      inject: [AddFavouriteHandler, RemoveFavouriteHandler],
    },
    CommandHandlerRegistry,
    CommandWorkerService,
  ],
})
export class WorkerModule {}
