import { Inject, Module, OnModuleDestroy } from '@nestjs/common';
import type { ConnectionOptions } from 'bullmq';
import { Queue } from 'bullmq';
import { buildQueueConnectionOptions, getJobAttempts, getJobBackoffDelayMs, getQueueName } from './queue.config';

export const COMMANDS_QUEUE = Symbol('COMMANDS_QUEUE');

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
  ],
  exports: [COMMANDS_QUEUE],
})
export class QueueModule implements OnModuleDestroy {
  constructor(@Inject(COMMANDS_QUEUE) private readonly queue: Queue) {}

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}
