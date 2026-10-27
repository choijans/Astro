import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CommandsRepository } from '../commands/commands.repository';
import { JobEnqueuerService } from './job-enqueuer.service';
import { getProcessingStaleMs, getSweepBatchSize, SWEEP_GRACE_MS } from './queue.config';

/**
 * Covers Redis being down (or unreachable) at the moment a command was first
 * enqueued: the command is still correctly persisted as PENDING in Postgres
 * (the source of truth), it just never got a queue job. This finds those and
 * re-adds them through the same job-add path a fresh command uses.
 *
 * Runs in both the API and worker processes: `QueueModule` is in both
 * processes' dependency graph, and this service's own `OnModuleInit` is what
 * gives each process its "one pass on start" — the worker's extra interval
 * and Redis-reconnect triggers live in WorkerSweepScheduler, which only adds
 * to what this already does, never re-triggering the initial pass itself.
 */
@Injectable()
export class RecoverySweepService implements OnModuleInit {
  private readonly logger = new Logger(RecoverySweepService.name);
  private running = false;

  constructor(
    private readonly commandsRepository: CommandsRepository,
    private readonly jobEnqueuer: JobEnqueuerService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.runPass();
  }

  /**
   * Finds commands still PENDING, oldest seq first, in batches, skipping
   * anything created within the last ~2s (SWEEP_GRACE_MS) so a request still
   * in the middle of its own first enqueue attempt isn't raced. Also finds
   * commands stuck in PROCESSING whose attempt started more than
   * PROCESSING_STALE_MS ago (see JobEnqueuerService.prepareStaleJobForReenqueue
   * for how a leftover finished/failed job is handled vs. one BullMQ still
   * considers active). Never throws — a queue/Redis error (or any other
   * failure) is logged and the next pass (interval, restart, or reconnect)
   * tries again. A pass never starts while the previous one from this same
   * process is still running.
   */
  async runPass(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      const reEnqueued = await this.sweepPending();
      const recovered = await this.sweepStaleProcessing();

      if (reEnqueued > 0) {
        this.logger.log(`Recovery sweep re-enqueued ${reEnqueued} command(s)`);
      }
      if (recovered > 0) {
        this.logger.log(`Recovery sweep recovered ${recovered} stale PROCESSING command(s)`);
      }
    } catch (err) {
      this.logger.error(
        `Recovery sweep pass failed: ${(err as Error).message}`,
      );
    } finally {
      this.running = false;
    }
  }

  private async sweepPending(): Promise<number> {
    const commands = await this.commandsRepository.findPendingForSweep(
      getSweepBatchSize(),
      SWEEP_GRACE_MS,
    );

    let reEnqueued = 0;
    for (const command of commands) {
      const ok = await this.jobEnqueuer.enqueue(command);
      if (ok) {
        reEnqueued += 1;
      }
    }
    return reEnqueued;
  }

  /**
   * A command stuck in PROCESSING is only ever recovered through this path —
   * never by simply calling enqueue() for it, since that would leave the
   * command row saying PROCESSING while a fresh job runs, racing the
   * DONE/FAILED-skip check in CommandWorkerService against whatever the
   * original (presumed-dead) attempt might still do. Resetting to PENDING
   * first, and only once the job itself is confirmed not still owned by a
   * worker, keeps this on the same safe path as a plain PENDING recovery.
   */
  private async sweepStaleProcessing(): Promise<number> {
    const commands = await this.commandsRepository.findStaleProcessingForSweep(
      getSweepBatchSize(),
      getProcessingStaleMs(),
    );

    let recovered = 0;
    for (const command of commands) {
      const readiness = await this.jobEnqueuer.prepareStaleJobForReenqueue(command.id);
      if (readiness === 'still-active') {
        this.logger.log(
          `Command ${command.id} has been PROCESSING longer than the stale threshold, but BullMQ still shows an active job for it; leaving it alone`,
        );
        continue;
      }

      await this.commandsRepository.resetStaleProcessingToPending(command.id);
      const ok = await this.jobEnqueuer.enqueue(command);
      if (ok) {
        recovered += 1;
      }
    }
    return recovered;
  }
}
