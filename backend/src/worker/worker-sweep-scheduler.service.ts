import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { RedisClient } from 'bullmq';
import type { CommandJobData } from '../commands/queue-command-processor';
import { getSweepIntervalMs } from '../queue/queue.config';
import { COMMANDS_QUEUE } from '../queue/queue.tokens';
import { RecoverySweepService } from '../queue/recovery-sweep.service';

/**
 * Adds the worker-only recovery sweep triggers on top of what
 * RecoverySweepService already does for every process via its own
 * OnModuleInit ("one pass on start"): a periodic interval backstop, and a
 * pass whenever the queue's Redis connection comes back `ready` after a
 * disconnect. The first `ready` event is always the initial connect — it's
 * skipped here since the startup pass already covers it; only a `ready`
 * *after* that means "we just reconnected."
 */
@Injectable()
export class WorkerSweepScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkerSweepScheduler.name);
  private interval?: NodeJS.Timeout;
  private client?: RedisClient;
  private seenInitialReady = false;
  private readonly onReady = () => {
    if (!this.seenInitialReady) {
      this.seenInitialReady = true;
      return;
    }
    this.logger.log(
      'Redis connection ready again after a disconnect; running a recovery sweep',
    );
    void this.recoverySweep.runPass();
  };

  constructor(
    private readonly recoverySweep: RecoverySweepService,
    @Inject(COMMANDS_QUEUE) private readonly queue: Queue<CommandJobData>,
  ) {}

  async onModuleInit(): Promise<void> {
    this.interval = setInterval(() => {
      void this.recoverySweep.runPass();
    }, getSweepIntervalMs());

    this.client = await this.queue.getBackend().client;
    this.client.on('ready', this.onReady);
  }

  onModuleDestroy(): void {
    if (this.interval) {
      clearInterval(this.interval);
    }
    this.client?.off('ready', this.onReady);
  }
}
