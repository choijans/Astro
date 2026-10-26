import { CommandResponse, getCommand } from '../lib/api';
import { PollTimeoutError, pollUntilSettled, POLL_INTERVAL_MS, POLL_TIMEOUT_MS } from '../lib/poll-command';

jest.mock('../lib/api', () => ({
  ...jest.requireActual('../lib/api'),
  getCommand: jest.fn(),
}));

function makeCommand(overrides: Partial<CommandResponse> = {}): CommandResponse {
  return {
    id: 'cmd-1',
    seq: '1',
    userId: 'user-1',
    type: 'ADD_FAVORITE',
    channelId: 1,
    status: 'PENDING',
    error: null,
    createdAt: '2026-01-01T00:00:00Z',
    processedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('pollUntilSettled', () => {
  it('returns immediately once the command is DONE', async () => {
    (getCommand as jest.Mock).mockResolvedValue(makeCommand({ status: 'DONE' }));

    const result = await pollUntilSettled('cmd-1');

    expect(result.status).toBe('DONE');
    expect(getCommand).toHaveBeenCalledWith('cmd-1');
    expect(getCommand).toHaveBeenCalledTimes(1);
  });

  it('returns once the command is FAILED, without throwing', async () => {
    (getCommand as jest.Mock).mockResolvedValue(makeCommand({ status: 'FAILED', error: 'boom' }));

    const result = await pollUntilSettled('cmd-1');

    expect(result.status).toBe('FAILED');
    expect(result.error).toBe('boom');
  });

  it(`polls again every ~${POLL_INTERVAL_MS}ms while PENDING, then returns once it settles`, async () => {
    (getCommand as jest.Mock)
      .mockResolvedValueOnce(makeCommand({ status: 'PENDING' }))
      .mockResolvedValueOnce(makeCommand({ status: 'PENDING' }))
      .mockResolvedValueOnce(makeCommand({ status: 'DONE' }));

    const resultPromise = pollUntilSettled('cmd-1');

    await jest.advanceTimersByTimeAsync(0);
    expect(getCommand).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(getCommand).toHaveBeenCalledTimes(2);

    await jest.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(getCommand).toHaveBeenCalledTimes(3);

    await expect(resultPromise).resolves.toMatchObject({ status: 'DONE' });
  });

  it(`throws PollTimeoutError after ~${POLL_TIMEOUT_MS}ms of staying PENDING`, async () => {
    (getCommand as jest.Mock).mockResolvedValue(makeCommand({ status: 'PENDING' }));

    const resultPromise = pollUntilSettled('cmd-1');
    const assertion = expect(resultPromise).rejects.toBeInstanceOf(PollTimeoutError);

    await jest.advanceTimersByTimeAsync(POLL_TIMEOUT_MS + POLL_INTERVAL_MS * 2);

    await assertion;
  });
});
