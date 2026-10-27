import { Inject, Module, OnModuleDestroy } from '@nestjs/common';
import type { ConnectionOptions } from 'bullmq';
import { Queue } from 'bullmq';
import { CommandsRepository } from '../commands/commands.repository';
import { JobEnqueuerService } from './job-enqueuer.service';
import {
  buildQueueConnectionOptions,
  getJobAttempts,
  getJobBackoffDelayMs,
  getQueueName,
} from './queue.config';
import { COMMANDS_QUEUE } from './queue.tokens';
import { RecoverySweepService } from './recovery-sweep.service';

export { COMMANDS_QUEUE };

// CommandsRepository is declared here too (not imported from CommandsModule,
// which has its own copy, same as WorkerModule) — it's a stateless Prisma
// wrapper, so each module owning a separate instance avoids coupling the
// API-only and worker-only module graphs together.
@Module({
  providers: [
    {
      provide: COMMANDS_QUEUE,
      useFactory: () =>
        new Queue(getQueueName(), {
          connection: buildQueueConnectionOptions() as ConnectionOptions,
          defaultJobOptions: {
            attempts: getJobAttempts(),
            backoff: { type: 'exponential', delay: getJobBackoffDelayMs() },
          },
        }),
    },
    CommandsRepository,
    JobEnqueuerService,
    RecoverySweepService,
  ],
  exports: [COMMANDS_QUEUE, JobEnqueuerService, RecoverySweepService],
})
export class QueueModule implements OnModuleDestroy {
  constructor(@Inject(COMMANDS_QUEUE) private readonly queue: Queue) {}

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}
