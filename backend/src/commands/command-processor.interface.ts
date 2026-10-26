import type { Command } from '../../generated/prisma/client';

export const COMMAND_PROCESSOR = Symbol('COMMAND_PROCESSOR');

export interface ICommandProcessor {
  /** Runs the command to completion (or failure) and returns its final state. */
  process(command: Command): Promise<Command>;
}
