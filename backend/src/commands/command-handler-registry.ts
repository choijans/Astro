import { Inject, Injectable } from '@nestjs/common';
import type { CommandType } from '../../generated/prisma/client';
import { COMMAND_HANDLER, ICommandHandler } from './command-handler.interface';

/** Looks up the handler for a command type. New types just register a new handler. */
@Injectable()
export class CommandHandlerRegistry {
  private readonly handlers = new Map<CommandType, ICommandHandler>();

  constructor(@Inject(COMMAND_HANDLER) handlers: ICommandHandler[]) {
    for (const handler of handlers) {
      this.handlers.set(handler.type, handler);
    }
  }

  get(type: CommandType): ICommandHandler | undefined {
    return this.handlers.get(type);
  }
}
