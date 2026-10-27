import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import type { Command } from '../generated/prisma/client';

/** Polls GET /commands/:id until it settles (DONE or FAILED) or times out —
 * processing happens asynchronously on the worker, not inline in the HTTP
 * response, so every e2e test that needs the result has to wait for it. */
export async function pollCommand(
  app: INestApplication<App>,
  userId: string,
  commandId: string,
  { timeoutMs = 15000, intervalMs = 50 } = {},
): Promise<Command & { seq: string }> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await request(app.getHttpServer())
      .get(`/commands/${commandId}`)
      .set('X-User-Id', userId)
      .expect(200);
    if (res.body.status === 'DONE' || res.body.status === 'FAILED') {
      return res.body;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `Command ${commandId} did not settle within ${timeoutMs}ms (last status: ${res.body.status})`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
