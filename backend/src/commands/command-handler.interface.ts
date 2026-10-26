import type { Command, CommandType } from '../../generated/prisma/client';

/** Multi-provider token: every handler registers itself under this token. */
export const COMMAND_HANDLER = Symbol('COMMAND_HANDLER');

export interface ICommandHandler {
  readonly type: CommandType;
  /** Applies the command's effect. Must be idempotent — may be called more than once. */
  handle(command: Command): Promise<void>;
}
