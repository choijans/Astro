import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { Command } from '../../generated/prisma/client';
import { COMMANDS_QUEUE } from '../queue/queue.module';
import { ICommandProcessor } from './command-processor.interface';

export interface CommandJobData {
  commandId: string;
}

/**
 * Replaces SynchronousCommandProcessor: instead of running the command to
 * completion, this enqueues a job and returns the command exactly as
 * persisted (status PENDING) — the worker process loads the row by id and
 * does the actual work. The job's id is the command's own UUID, so retrying
 * this call for the same command (a resend, or an idempotent replay) can
 * never create a second job.
 */
@Injectable()
export class QueueCommandProcessor implements ICommandProcessor {
  private readonly logger = new Logger(QueueCommandProcessor.name);

  constructor(@Inject(COMMANDS_QUEUE) private readonly queue: Queue<CommandJobData>) {}

  async process(command: Command): Promise<Command> {
    try {
      await this.queue.add(command.type, { commandId: command.id }, { jobId: command.id });
    } catch (err) {
      // Redis down (or similar): the command is already persisted as PENDING,
      // so nothing is lost. Task 10's recovery sweep re-enqueues it later.
      this.logger.error(
        `Failed to enqueue command ${command.id} (${command.type}): ${(err as Error).message}. Left PENDING.`,
      );
    }
    return command;
  }
}
