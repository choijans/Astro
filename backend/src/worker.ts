import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker/worker.module';

const logger = new Logger('Worker');

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  logger.log('Worker started, listening for commands');

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.log(`Received ${signal}, shutting down gracefully`);
    app
      .close()
      .then(() => {
        logger.log('Worker shut down');
        process.exit(0);
      })
      .catch((err) => {
        logger.error(`Error during shutdown: ${(err as Error).message}`);
        process.exit(1);
      });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

void bootstrap();
