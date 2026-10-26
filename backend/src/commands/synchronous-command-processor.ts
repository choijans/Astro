import { Injectable } from '@nestjs/common';
import type { Command } from '../../generated/prisma/client';
import { CommandHandlerRegistry } from './command-handler-registry';
import { ICommandProcessor } from './command-processor.interface';
import { CommandsRepository } from './commands.repository';

/**
 * Runs the handler immediately and marks the command DONE/FAILED. Stands in
 * for a real queue until Task 9 swaps this for one — CommandsService only
 * depends on ICommandProcessor, so that swap touches nothing else.
 */
@Injectable()
export class SynchronousCommandProcessor implements ICommandProcessor {
  constructor(
    private readonly registry: CommandHandlerRegistry,
    private readonly commandsRepository: CommandsRepository,
  ) {}

  async process(command: Command): Promise<Command> {
    const handler = this.registry.get(command.type);

    if (!handler) {
      return this.commandsRepository.markFailed(command.id, `No handler registered for ${command.type}`);
    }

    try {
      await handler.handle(command);
      return this.commandsRepository.markDone(command.id);
    } catch (err) {
      return this.commandsRepository.markFailed(command.id, (err as Error).message);
    }
  }
}
