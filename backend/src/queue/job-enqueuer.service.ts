import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { Command } from '../../generated/prisma/client';
import type { CommandJobData } from '../commands/queue-command-processor';
import { COMMANDS_QUEUE } from './queue.tokens';

/**
 * The one place that calls `queue.add()` for a command — used both for a
 * fresh command (via QueueCommandProcessor) and for re-adding a PENDING one
 * (via RecoverySweepService). The job id is always the command's own UUID, so
 * calling this again for the same command is always safe: BullMQ treats an
 * already-queued/active job as a no-op rather than duplicating it.
 */
@Injectable()
export class JobEnqueuerService {
  private readonly logger = new Logger(JobEnqueuerService.name);

  constructor(
    @Inject(COMMANDS_QUEUE) private readonly queue: Queue<CommandJobData>,
  ) {}

  /** Never throws: a queue/Redis failure is logged and swallowed — the
   * command is already persisted in Postgres (the source of truth), so
   * nothing is lost. A later resend or recovery sweep pass tries again.
   * Returns whether the add actually succeeded, for callers that count. */
  async enqueue(command: Pick<Command, 'id' | 'type'>): Promise<boolean> {
    try {
      await this.queue.add(
        command.type,
        { commandId: command.id },
        { jobId: command.id },
      );
      return true;
    } catch (err) {
      this.logger.error(
        `Failed to enqueue command ${command.id} (${command.type}): ${(err as Error).message}`,
      );
      return false;
    }
  }

  /**
   * Called before the recovery sweep re-adds a job for a command it found
   * stuck in PROCESSING. BullMQ keys a job by id, but it only rejects an
   * `add()` for an id that's still *active, waiting, delayed, prioritized or
   * waiting-children* — those are jobs a worker genuinely still owns or will
   * get to, so they're left untouched and the command's own PROCESSING state
   * is correct as-is. A *completed* or *failed* job for that id is just
   * leftover history (BullMQ's removeOnComplete/removeOnFail retain a bounded
   * number of them) — `add()` would silently no-op against it, so it has to
   * be removed first. The same applies if BullMQ reports `unknown` (the id
   * isn't resolvable to a real state). No job at all (`null`) needs no
   * cleanup. Returns whether it's now safe to reset the command to PENDING
   * and call `enqueue()`. Never throws — a queue/Redis failure here is as
   * safe to treat as "leave it alone" as a genuinely active job: the command
   * stays PROCESSING and the next sweep pass tries again, rather than risking
   * a reset+re-add racing a worker that may still own the job after all. */
  async prepareStaleJobForReenqueue(
    commandId: string,
  ): Promise<'ready' | 'still-active'> {
    try {
      const job = await this.queue.getJob(commandId);
      if (!job) {
        return 'ready';
      }

      const state = await job.getState();
      if (
        state === 'active' ||
        state === 'waiting' ||
        state === 'delayed' ||
        state === 'prioritized' ||
        state === 'waiting-children'
      ) {
        return 'still-active';
      }

      this.logger.warn(
        `Removing leftover ${state} job for stale-PROCESSING command ${commandId} before re-adding it`,
      );
      await job.remove();
      return 'ready';
    } catch (err) {
      this.logger.error(
        `Failed to check/clear the existing job for stale-PROCESSING command ${commandId}: ${(err as Error).message}`,
      );
      return 'still-active';
    }
  }
}
