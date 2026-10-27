import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type { ConnectionOptions, Job } from 'bullmq';
import { Worker } from 'bullmq';
import type { Command, CommandType } from '../../generated/prisma/client';
import { CommandHandlerRegistry } from '../commands/command-handler-registry';
import type { CommandJobData } from '../commands/queue-command-processor';
import { CommandsRepository } from '../commands/commands.repository';
import { PrismaService } from '../prisma/prisma.service';
import {
  buildWorkerConnectionOptions,
  getQueueName,
  getWorkerConcurrency,
  WORKER_LOCK_DURATION_MS,
  WORKER_MAX_STALLED_COUNT,
  WORKER_STALLED_INTERVAL_MS,
} from '../queue/queue.config';

/** ADD_FAVORITE/REMOVE_FAVORITE share one ordering key: (userId, channelId).
 * REFRESH_CHANNEL isn't built yet (still rejected with 400 at the API), so it
 * never reaches the worker. */
const ORDERED_TYPES: CommandType[] = ['ADD_FAVORITE', 'REMOVE_FAVORITE'];
const JOB_HISTORY_LIMIT = 1000;

@Injectable()
export class CommandWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CommandWorkerService.name);
  private worker?: Worker<CommandJobData>;

  constructor(
    private readonly commandsRepository: CommandsRepository,
    private readonly registry: CommandHandlerRegistry,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<CommandJobData>(
      getQueueName(),
      (job) => this.processJob(job),
      {
        connection: buildWorkerConnectionOptions() as ConnectionOptions,
        concurrency: getWorkerConcurrency(),
        removeOnComplete: { count: JOB_HISTORY_LIMIT },
        removeOnFail: { count: JOB_HISTORY_LIMIT },
        lockDuration: WORKER_LOCK_DURATION_MS,
        stalledInterval: WORKER_STALLED_INTERVAL_MS,
        maxStalledCount: WORKER_MAX_STALLED_COUNT,
      },
    );

    this.worker.on('error', (err) => {
      this.logger.error(`Worker connection error: ${err.message}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }

  private async processJob(job: Job<CommandJobData>): Promise<void> {
    const { commandId } = job.data;
    const existing = await this.commandsRepository.findById(commandId);

    if (!existing) {
      this.logger.error(
        `Command ${commandId} not found for job ${job.id}; skipping`,
      );
      return;
    }

    if (existing.status === 'DONE' || existing.status === 'FAILED') {
      this.logger.log(
        `Duplicate delivery of ${existing.status} command ${commandId} (job ${job.id}); skipping`,
      );
      return;
    }

    const command = await this.commandsRepository.markProcessing(commandId);
    // BullMQ doesn't increment job.attemptsMade until after this invocation
    // finishes (success or failure) — during the processor call itself, it's
    // still the count of attempts already completed BEFORE this one. So the
    // attempt actually running right now is attemptsMade + 1, and this is the
    // last attempt BullMQ will make exactly when attemptsMade + 1 >= opts.attempts
    // (the same condition BullMQ's own retry check uses internally).
    const attemptsMade = job.attemptsMade;
    const maxAttempts = job.opts.attempts ?? 1;
    const currentAttempt = attemptsMade + 1;
    const isFinalAttempt = currentAttempt >= maxAttempts;
    this.logger.log(
      `Processing command ${command.id} type=${command.type} userId=${command.userId} attempt=${currentAttempt}/${maxAttempts}`,
    );

    try {
      await this.applyOrdered(command);
    } catch (err) {
      const message = (err as Error).message;
      if (isFinalAttempt) {
        await this.commandsRepository.markFailed(commandId, message);
        this.logger.error(
          `Command ${command.id} type=${command.type} userId=${command.userId} failed permanently after ${currentAttempt} attempts: ${message}`,
        );
      } else {
        await this.commandsRepository.markPendingForRetry(commandId);
        this.logger.warn(
          `Command ${command.id} type=${command.type} userId=${command.userId} attempt=${currentAttempt} failed, will retry: ${message}`,
        );
      }
      throw err; // let BullMQ's own retry/failed bookkeeping run too
    }
  }

  /**
   * The ordering check (is a higher-seq command for this (user, channel)
   * already DONE?) and the handler's write must be atomic, or two jobs
   * running concurrently could both pass the check before either commits.
   * pg_advisory_xact_lock serializes same-key commands for the lock's whole
   * transaction and self-releases on commit/rollback — no separate unlock
   * call, and no lock left behind if the process crashes mid-transaction. A
   * row lock (SELECT ... FOR UPDATE on a dedicated row) was the alternative,
   * but it needs that row to already exist, which is awkward for a brand new
   * (user, channel) pair's first command; a Postgres SERIALIZABLE
   * transaction was the other alternative, but it pushes conflict handling
   * onto the caller (catching and retrying on a 40001 serialization
   * failure) for no real benefit here. The lock key uses hashtext(userId)
   * for one half and the exact (unhashed) channelId for the other, which
   * collides far less than hashing the whole "userId:channelId" string into
   * a single 32-bit key would.
   */
  private async applyOrdered(command: Command): Promise<void> {
    const handler = this.registry.get(command.type);
    if (!handler) {
      throw new Error(`No handler registered for ${command.type}`);
    }

    await this.prisma.$transaction(async (tx) => {
      if (ORDERED_TYPES.includes(command.type)) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${command.userId}::text), ${command.channelId}::int)`;

        const supersededBy = await tx.command.findFirst({
          where: {
            userId: command.userId,
            channelId: command.channelId,
            type: { in: ORDERED_TYPES },
            seq: { gt: command.seq },
            status: 'DONE',
          },
        });

        if (supersededBy) {
          this.logger.log(
            `Command ${command.id} (seq ${command.seq}) superseded by ${supersededBy.id} (seq ${supersededBy.seq}) for userId=${command.userId} channelId=${command.channelId}; skipping handler`,
          );
          await tx.command.update({
            where: { id: command.id },
            data: {
              status: 'DONE',
              processedAt: new Date(),
              processingStartedAt: null,
            },
          });
          return;
        }
      }

      await handler.handle(command, tx);
      await tx.command.update({
        where: { id: command.id },
        data: {
          status: 'DONE',
          processedAt: new Date(),
          processingStartedAt: null,
        },
      });
    });
  }
}
