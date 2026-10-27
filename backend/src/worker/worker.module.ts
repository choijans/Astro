import { Module } from '@nestjs/common';
import { CommandHandlerRegistry } from '../commands/command-handler-registry';
import { COMMAND_HANDLER } from '../commands/command-handler.interface';
import { CommandsRepository } from '../commands/commands.repository';
import { AddFavouriteHandler } from '../commands/handlers/add-favourite.handler';
import { RemoveFavouriteHandler } from '../commands/handlers/remove-favourite.handler';
import { PrismaModule } from '../prisma/prisma.module';
import { QueueModule } from '../queue/queue.module';
import { CommandWorkerService } from './command-worker.service';
import { WorkerSweepScheduler } from './worker-sweep-scheduler.service';

// QueueModule gives the worker process both its recovery-sweep "pass on
// start" (via RecoverySweepService's own OnModuleInit, shared with the API)
// and the Queue connection WorkerSweepScheduler needs to re-add jobs and
// watch for reconnects.
@Module({
  imports: [PrismaModule, QueueModule],
  providers: [
    CommandsRepository,
    AddFavouriteHandler,
    RemoveFavouriteHandler,
    {
      provide: COMMAND_HANDLER,
      useFactory: (
        add: AddFavouriteHandler,
        remove: RemoveFavouriteHandler,
      ) => [add, remove],
      inject: [AddFavouriteHandler, RemoveFavouriteHandler],
    },
    CommandHandlerRegistry,
    CommandWorkerService,
    WorkerSweepScheduler,
  ],
})
export class WorkerModule {}
