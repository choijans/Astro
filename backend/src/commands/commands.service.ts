import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import type { Command, CommandType } from '../../generated/prisma/client';
import { COMMAND_PROCESSOR } from './command-processor.interface';
import type { ICommandProcessor } from './command-processor.interface';
import { CommandsRepository } from './commands.repository';

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

function isUniqueConstraintViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === UNIQUE_CONSTRAINT_VIOLATION
  );
}

export interface EnqueueParams {
  id: string;
  userId: string;
  type: CommandType;
  channelId: number;
}

/** The ONLY write path for commands. Favourites routes call this too, never Prisma directly. */
@Injectable()
export class CommandsService {
  constructor(
    private readonly commandsRepository: CommandsRepository,
    @Inject(COMMAND_PROCESSOR) private readonly processor: ICommandProcessor,
  ) {}

  async enqueue(params: EnqueueParams): Promise<Command> {
    const existing = await this.commandsRepository.findById(params.id);
    if (existing) {
      return this.reconcileWithExisting(existing, params);
    }

    const channelExists = await this.commandsRepository.channelExists(
      params.channelId,
    );
    if (!channelExists) {
      throw new NotFoundException(`Channel ${params.channelId} not found`);
    }

    let created: Command;
    try {
      created = await this.commandsRepository.create({
        id: params.id,
        userId: params.userId,
        type: params.type,
        channelId: params.channelId,
      });
    } catch (err) {
      if (!isUniqueConstraintViolation(err)) {
        throw err;
      }
      // Two requests with the same command id raced: the other one won the
      // insert. Treat it exactly like finding it up front — same id, same
      // user, same payload replays; anything else still conflicts.
      const winner = await this.commandsRepository.findById(params.id);
      if (!winner) {
        throw err;
      }
      return this.reconcileWithExisting(winner, params);
    }

    return this.processor.process(created);
  }

  private async reconcileWithExisting(
    existing: Command,
    params: EnqueueParams,
  ): Promise<Command> {
    if (existing.userId !== params.userId) {
      throw new ConflictException(
        'This command id was already used by a different user',
      );
    }
    if (
      existing.type !== params.type ||
      existing.channelId !== params.channelId
    ) {
      throw new ConflictException(
        'This command id was already used with a different payload',
      );
    }
    if (existing.status === 'PENDING') {
      // Still unresolved: retry the job add. Safe because the job id is the
      // command id, so BullMQ treats an already-queued/active job as a no-op
      // rather than duplicating it. A DONE or FAILED command is never
      // re-added — the job may already be gone (removeOnComplete/Fail), and
      // re-adding it there would mean running it a second time.
      return this.processor.process(existing);
    }
    return existing;
  }

  async getStatus(id: string, userId: string): Promise<Command> {
    const command = await this.commandsRepository.findById(id);
    if (!command || command.userId !== userId) {
      throw new NotFoundException(`Command ${id} not found`);
    }
    return command;
  }
}
