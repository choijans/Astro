import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { COMMAND_PROCESSOR } from './command-processor.interface';
import { CommandsController } from './commands.controller';
import { CommandsRepository } from './commands.repository';
import { CommandsService } from './commands.service';
import { QueueCommandProcessor } from './queue-command-processor';

// AddFavouriteHandler/RemoveFavouriteHandler and the handler registry live in
// WorkerModule now — the API process only enqueues; it never runs a handler.
@Module({
  imports: [QueueModule],
  controllers: [CommandsController],
  providers: [CommandsService, CommandsRepository, { provide: COMMAND_PROCESSOR, useClass: QueueCommandProcessor }],
  exports: [CommandsService],
})
export class CommandsModule {}
