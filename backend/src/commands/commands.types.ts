import type {
  Command,
  CommandStatus,
  CommandType,
} from '../../generated/prisma/client';

export interface CommandResponse {
  id: string;
  seq: string;
  userId: string;
  type: CommandType;
  channelId: number;
  status: CommandStatus;
  error: string | null;
  createdAt: Date;
  processedAt: Date | null;
}

/** seq is a BigInt in Prisma; JSON.stringify throws on BigInt, so it's always sent as a string. */
export function toCommandResponse(command: Command): CommandResponse {
  return {
    id: command.id,
    seq: command.seq.toString(),
    userId: command.userId,
    type: command.type,
    channelId: command.channelId,
    status: command.status,
    error: command.error,
    createdAt: command.createdAt,
    processedAt: command.processedAt,
  };
}
