import { Module } from '@nestjs/common';
import { AstroModule } from '../astro/astro.module';
import { CommandHandlerRegistry } from '../commands/command-handler-registry';
import { COMMAND_HANDLER } from '../commands/command-handler.interface';
import { CommandsRepository } from '../commands/commands.repository';
import { AddFavouriteHandler } from '../commands/handlers/add-favourite.handler';
import { RefreshChannelHandler } from '../commands/handlers/refresh-channel.handler';
import { RemoveFavouriteHandler } from '../commands/handlers/remove-favourite.handler';
import { PrismaModule } from '../prisma/prisma.module';
import { QueueModule } from '../queue/queue.module';
import { CommandWorkerService } from './command-worker.service';
import { WorkerSweepScheduler } from './worker-sweep-scheduler.service';

// QueueModule gives the worker process both its recovery-sweep "pass on
// start" (via RecoverySweepService's own OnModuleInit, shared with the API)
// and the Queue connection WorkerSweepScheduler needs to re-add jobs and
// watch for reconnects. AstroModule is only needed here: the API process
// never talks to Astro.
@Module({
  imports: [PrismaModule, QueueModule, AstroModule],
  providers: [
    CommandsRepository,
    AddFavouriteHandler,
    RemoveFavouriteHandler,
    RefreshChannelHandler,
    {
      provide: COMMAND_HANDLER,
      useFactory: (
        add: AddFavouriteHandler,
        remove: RemoveFavouriteHandler,
        refresh: RefreshChannelHandler,
      ) => [add, remove, refresh],
      inject: [
        AddFavouriteHandler,
        RemoveFavouriteHandler,
        RefreshChannelHandler,
      ],
    },
    CommandHandlerRegistry,
    CommandWorkerService,
    WorkerSweepScheduler,
  ],
})
export class WorkerModule {}
