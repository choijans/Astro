import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RefreshButton } from '../components/RefreshButton';
import { ApiError, CommandResponse, createCommand } from '../lib/api';
import { PollTimeoutError, pollUntilSettled } from '../lib/poll-command';
import { renderWithQueryClient } from '../testing/test-utils';

jest.mock('../lib/api', () => ({
  ...jest.requireActual('../lib/api'),
  createCommand: jest.fn(),
}));

// Same reasoning as FavouriteButton.test.tsx: pollUntilSettled has its own
// dedicated timing test (lib/poll-command.test.ts); mocked here so DONE,
// FAILED and timeout can each be driven directly and instantly.
jest.mock('../lib/poll-command', () => ({
  ...jest.requireActual('../lib/poll-command'),
  pollUntilSettled: jest.fn(),
}));

function makeCommand(overrides: Partial<CommandResponse> = {}): CommandResponse {
  return {
    id: 'cmd-1',
    seq: '1',
    userId: 'user-1',
    type: 'REFRESH_CHANNEL',
    channelId: 7,
    status: 'DONE',
    error: null,
    createdAt: '2026-01-01T00:00:00Z',
    processedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('RefreshButton', () => {
  it('sends POST /commands with a UUID id and REFRESH_CHANNEL, and is disabled + aria-busy while pending', async () => {
    let resolveCreate: (command: CommandResponse) => void = () => {};
    (createCommand as jest.Mock).mockReturnValue(
      new Promise<CommandResponse>((resolve) => {
        resolveCreate = resolve;
      }),
    );
    const user = userEvent.setup();
    renderWithQueryClient(<RefreshButton channelId={7} />);

    const button = await screen.findByRole('button', { name: 'Refresh' });
    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'false');

    await user.click(button);

    expect(createCommand).toHaveBeenCalledTimes(1);
    const [params] = (createCommand as jest.Mock).mock.calls[0];
    expect(params.type).toBe('REFRESH_CHANNEL');
    expect(params.channelId).toBe(7);
    expect(params.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

    const pendingButton = screen.getByRole('button', { name: 'Refreshing…' });
    expect(pendingButton).toBeDisabled();
    expect(pendingButton).toHaveAttribute('aria-busy', 'true');

    await act(async () => {
      resolveCreate(makeCommand());
    });
  });

  it('ignores a second click while a refresh is pending', async () => {
    let resolveCreate: (command: CommandResponse) => void = () => {};
    (createCommand as jest.Mock).mockReturnValue(
      new Promise<CommandResponse>((resolve) => {
        resolveCreate = resolve;
      }),
    );
    const user = userEvent.setup();
    renderWithQueryClient(<RefreshButton channelId={7} />);

    const button = await screen.findByRole('button', { name: 'Refresh' });
    await user.click(button);
    await user.click(screen.getByRole('button'));
    await user.click(screen.getByRole('button'));

    expect(createCommand).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveCreate(makeCommand());
    });
  });

  it('on DONE, invalidates the channel detail query and every channel list query, and re-enables the button', async () => {
    (createCommand as jest.Mock).mockResolvedValue(makeCommand({ status: 'DONE' }));
    const user = userEvent.setup();
    const { queryClient } = renderWithQueryClient(<RefreshButton channelId={7} />);
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');

    await user.click(await screen.findByRole('button', { name: 'Refresh' }));

    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['channel', 7] }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['channels'] });

    expect(await screen.findByRole('button', { name: 'Refresh' })).not.toBeDisabled();
  });

  it('a PENDING response polls, then DONE invalidates the queries', async () => {
    (createCommand as jest.Mock).mockResolvedValue(makeCommand({ status: 'PENDING' }));
    (pollUntilSettled as jest.Mock).mockResolvedValue(makeCommand({ status: 'DONE' }));
    const user = userEvent.setup();
    const { queryClient } = renderWithQueryClient(<RefreshButton channelId={7} />);
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');

    await user.click(await screen.findByRole('button', { name: 'Refresh' }));

    await waitFor(() => expect(pollUntilSettled).toHaveBeenCalledWith('cmd-1'));
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['channel', 7] }),
    );
  });

  it('shows the real error message and re-enables the button when the command settles as FAILED', async () => {
    (createCommand as jest.Mock).mockResolvedValue(
      makeCommand({ status: 'FAILED', error: 'Channel does not exist' }),
    );
    const user = userEvent.setup();
    renderWithQueryClient(<RefreshButton channelId={7} />);

    await user.click(await screen.findByRole('button', { name: 'Refresh' }));

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Channel does not exist'),
    );
    expect(screen.getByRole('button', { name: 'Refresh' })).not.toBeDisabled();
  });

  it('shows the real error message and re-enables the button on an HTTP error', async () => {
    (createCommand as jest.Mock).mockRejectedValue(new ApiError('Internal server error', 500));
    const user = userEvent.setup();
    renderWithQueryClient(<RefreshButton channelId={7} />);

    await user.click(await screen.findByRole('button', { name: 'Refresh' }));

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Internal server error'),
    );
    expect(screen.getByRole('button', { name: 'Refresh' })).not.toBeDisabled();
  });

  it('shows the rate-limit message and re-enables the button on a 429', async () => {
    (createCommand as jest.Mock).mockRejectedValue(
      new ApiError('Too many requests. Please wait a moment and try again.', 429, 30),
    );
    const user = userEvent.setup();
    renderWithQueryClient(<RefreshButton channelId={7} />);

    await user.click(await screen.findByRole('button', { name: 'Refresh' }));

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'Too many requests. Please wait a moment and try again.',
      ),
    );
    expect(screen.getByRole('button', { name: 'Refresh' })).not.toBeDisabled();
  });

  it('a poll timeout shows "Still refreshing…", stops polling, and re-enables the button', async () => {
    (createCommand as jest.Mock).mockResolvedValue(makeCommand({ status: 'PENDING' }));
    (pollUntilSettled as jest.Mock).mockRejectedValue(new PollTimeoutError());
    const user = userEvent.setup();
    renderWithQueryClient(<RefreshButton channelId={7} />);

    await user.click(await screen.findByRole('button', { name: 'Refresh' }));

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Still refreshing'),
    );
    expect(screen.getByRole('button', { name: 'Refresh' })).not.toBeDisabled();
  });
});
