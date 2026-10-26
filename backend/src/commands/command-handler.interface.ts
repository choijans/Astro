import type { Command, CommandType, Prisma } from '../../generated/prisma/client';

/** Multi-provider token: every handler registers itself under this token. */
export const COMMAND_HANDLER = Symbol('COMMAND_HANDLER');

export interface ICommandHandler {
  readonly type: CommandType;
  /**
   * Applies the command's effect. Must be idempotent — may be called more
   * than once. Writes through `tx`, not an injected PrismaService: the
   * worker runs this inside a pg_advisory_xact_lock-guarded transaction, so
   * the per-(user, channel) ordering check and this write stay atomic.
   */
  handle(command: Command, tx: Prisma.TransactionClient): Promise<void>;
}
