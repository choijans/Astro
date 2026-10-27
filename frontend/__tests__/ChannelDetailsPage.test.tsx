import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChannelDetailsPage } from '../components/ChannelDetailsPage';
import { ApiError, ChannelDetail, CommandResponse, createCommand, getChannel, getFavourites } from '../lib/api';
import { renderWithQueryClient } from '../testing/test-utils';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
}));

jest.mock('../lib/api', () => ({
  ...jest.requireActual('../lib/api'),
  getChannel: jest.fn(),
  getFavourites: jest.fn(),
  addFavourite: jest.fn(),
  removeFavourite: jest.fn(),
  createCommand: jest.fn(),
}));

function makeChannel(overrides: Partial<ChannelDetail> = {}): ChannelDetail {
  return {
    id: 1,
    title: 'Astro30',
    subtitle: 'CH 30',
    stbNumber: 30,
    imageUrl: 'https://divign0fdw3sv.cloudfront.net/logo.png',
    category: 'News',
    genres: ['news'],
    languages: ['english'],
    rangeKey: '0_199',
    ranking: 1,
    schedule: [],
    scheduleUpdatedAt: '2026-01-01T00:00:00+08:00',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (getFavourites as jest.Mock).mockResolvedValue([]);
});

describe('ChannelDetailsPage', () => {
  it('renders category, genre and language chips', async () => {
    (getChannel as jest.Mock).mockResolvedValue(
      makeChannel({ category: 'News', genres: ['news', 'business'], languages: ['english', 'malay'] }),
    );
    renderWithQueryClient(<ChannelDetailsPage idParam="1" />);

    expect(await screen.findByText('News')).toBeInTheDocument();
    expect(screen.getByText('business')).toBeInTheDocument();
    expect(screen.getByText('english')).toBeInTheDocument();
    expect(screen.getByText('malay')).toBeInTheDocument();
  });

  it('hides schedule entries that have already ended and shows "Schedule not available" when nothing qualifies', async () => {
    (getChannel as jest.Mock).mockResolvedValue(
      makeChannel({
        schedule: [{ title: 'Past Show', eventStartMyt: '2020-01-01T08:00:00+08:00', eventEndMyt: '2020-01-01T09:00:00+08:00' }],
      }),
    );
    renderWithQueryClient(<ChannelDetailsPage idParam="1" />);

    expect(await screen.findByText('Schedule not available')).toBeInTheDocument();
    expect(screen.queryByText('Past Show')).not.toBeInTheDocument();
  });

  it('highlights the entry airing now and lists upcoming ones', async () => {
    const now = Date.now();
    const hourMs = 60 * 60 * 1000;
    (getChannel as jest.Mock).mockResolvedValue(
      makeChannel({
        schedule: [
          {
            title: 'Current Show',
            eventStartMyt: new Date(now - hourMs).toISOString(),
            eventEndMyt: new Date(now + hourMs).toISOString(),
          },
          {
            title: 'Next Show',
            eventStartMyt: new Date(now + hourMs).toISOString(),
            eventEndMyt: new Date(now + 2 * hourMs).toISOString(),
          },
        ],
      }),
    );
    renderWithQueryClient(<ChannelDetailsPage idParam="1" />);

    const current = await screen.findByText('Current Show');
    expect(current).toHaveClass('text-accent');
    const next = screen.getByText('Next Show');
    expect(next).not.toHaveClass('text-accent');
  });

  it('renders an enabled Refresh button for the channel', async () => {
    (getChannel as jest.Mock).mockResolvedValue(makeChannel({ id: 7 }));
    renderWithQueryClient(<ChannelDetailsPage idParam="7" />);

    const refreshButton = await screen.findByRole('button', { name: 'Refresh' });
    expect(refreshButton).toBeEnabled();
  });

  it('clicking Refresh and settling DONE refetches the channel and shows the new title and schedule-updated time', async () => {
    (getChannel as jest.Mock)
      .mockResolvedValueOnce(makeChannel({ id: 7, title: 'Astro30' }))
      .mockResolvedValueOnce(
        makeChannel({ id: 7, title: 'Astro30 Updated', scheduleUpdatedAt: '2026-02-01T00:00:00+08:00' }),
      );
    (createCommand as jest.Mock).mockResolvedValue({
      id: 'cmd-1',
      seq: '1',
      userId: 'user-1',
      type: 'REFRESH_CHANNEL',
      channelId: 7,
      status: 'DONE',
      error: null,
      createdAt: '2026-01-01T00:00:00Z',
      processedAt: '2026-01-01T00:00:00Z',
    } satisfies CommandResponse);
    const user = userEvent.setup();
    renderWithQueryClient(<ChannelDetailsPage idParam="7" />);

    expect(await screen.findByText('Astro30')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Refresh' }));

    expect(await screen.findByText('Astro30 Updated')).toBeInTheDocument();
    await waitFor(() => expect(getChannel).toHaveBeenCalledTimes(2));
  });

  it('renders a not-found page when the channel does not exist (404)', async () => {
    (getChannel as jest.Mock).mockRejectedValue(new ApiError('Channel not found', 404));
    renderWithQueryClient(<ChannelDetailsPage idParam="999" />);

    expect(await screen.findByText('Channel not found')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to channels' })).toBeInTheDocument();
  });

  it('renders a not-found page for a non-numeric id without calling the API', async () => {
    renderWithQueryClient(<ChannelDetailsPage idParam="abc" />);

    expect(await screen.findByText('Channel not found')).toBeInTheDocument();
    await waitFor(() => expect(getChannel).not.toHaveBeenCalled());
  });

  it('shows a generic error state with retry for a non-404 failure', async () => {
    (getChannel as jest.Mock).mockRejectedValue(new ApiError('Internal server error', 500));
    renderWithQueryClient(<ChannelDetailsPage idParam="1" />);

    expect(await screen.findByText('Internal server error')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
