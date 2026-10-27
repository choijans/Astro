import { Injectable } from '@nestjs/common';
import type { Command } from '../../generated/prisma/client';
import { JobEnqueuerService } from '../queue/job-enqueuer.service';
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
  constructor(private readonly jobEnqueuer: JobEnqueuerService) {}

  async process(command: Command): Promise<Command> {
    await this.jobEnqueuer.enqueue(command);
    return command;
  }
}
