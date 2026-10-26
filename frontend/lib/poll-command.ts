import { CommandResponse, getCommand } from './api';

export const POLL_INTERVAL_MS = 500;
export const POLL_TIMEOUT_MS = 15000;

/** Polling gave up without a DONE/FAILED answer — distinct from a real
 * failure: the caller doesn't know the outcome, so it shouldn't roll back. */
export class PollTimeoutError extends Error {
  constructor() {
    super('Still syncing');
    this.name = 'PollTimeoutError';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Polls GET /commands/:id (~every POLL_INTERVAL_MS) until it settles (DONE
 * or FAILED), or throws PollTimeoutError after ~POLL_TIMEOUT_MS. */
export async function pollUntilSettled(commandId: string): Promise<CommandResponse> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  for (;;) {
    const command = await getCommand(commandId);
    if (command.status === 'DONE' || command.status === 'FAILED') {
      return command;
    }
    if (Date.now() > deadline) {
      throw new PollTimeoutError();
    }
    await sleep(POLL_INTERVAL_MS);
  }
}
