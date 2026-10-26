import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChannelsPage } from '../components/ChannelsPage';
import { LAST_CHANNELS_URL_KEY } from '../hooks/useChannelUrlState';
import { getChannelFilters, getChannels } from '../lib/api';

const mockPush = jest.fn();
let mockSearch = '';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(mockSearch),
}));

jest.mock('../lib/api', () => ({
  ...jest.requireActual('../lib/api'),
  getChannels: jest.fn(),
  getChannelFilters: jest.fn(),
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ChannelsPage />
    </QueryClientProvider>,
  );
}

const emptyPage = { data: [], page: 1, limit: 24, total: 0, hasNextPage: false };

beforeEach(() => {
  mockSearch = '';
  mockPush.mockClear();
  sessionStorage.clear();
  (getChannelFilters as jest.Mock).mockResolvedValue({
    categories: ['Sports'],
    languages: ['malay'],
    genres: ['sports'],
  });
  (getChannels as jest.Mock).mockResolvedValue(emptyPage);
});

describe('ChannelsPage', () => {
  it('shows loading skeletons before data arrives, then the empty state', async () => {
    renderPage();

    expect(screen.getAllByTestId('channel-card-skeleton').length).toBeGreaterThan(0);
    await screen.findByText('No channels found');
  });

  it('shows the error state with a Retry button that re-fetches', async () => {
    (getChannels as jest.Mock).mockRejectedValueOnce(new Error('network down'));
    renderPage();

    await screen.findByRole('button', { name: 'Retry' });

    (getChannels as jest.Mock).mockResolvedValueOnce(emptyPage);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));

    await screen.findByText('No channels found');
  });

  it('changing sort updates the URL via router.push', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('No channels found');

    await user.selectOptions(screen.getByLabelText('Sort by'), 'title');

    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('sort=title'), expect.anything());
  });

  it('records its current URL (filters included) for BackToChannelsLink to return to', async () => {
    mockSearch = 'category=Sports&sort=title';
    renderPage();
    await screen.findByText('No channels found');

    expect(sessionStorage.getItem(LAST_CHANNELS_URL_KEY)).toBe('/?category=Sports&sort=title');
  });

  it('requests using the sort and order already in the URL on load', async () => {
    mockSearch = 'sort=ranking&order=desc';
    renderPage();

    await waitFor(() =>
      expect(getChannels).toHaveBeenCalledWith(
        expect.objectContaining({ sort: 'ranking', order: 'desc', page: 1, limit: 24 }),
      ),
    );
  });

  it('combines multiple filters from the URL into a single request', async () => {
    mockSearch = 'category=Sports&language=malay&q=news';
    renderPage();

    await waitFor(() =>
      expect(getChannels).toHaveBeenCalledWith(
        expect.objectContaining({ category: 'Sports', language: 'malay', q: 'news' }),
      ),
    );
  });

  it('removing a filter chip updates the URL via router.push', async () => {
    mockSearch = 'category=Sports';
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('No channels found');

    await user.click(screen.getByRole('button', { name: /Remove Category filter/i }));

    const [url] = mockPush.mock.calls.at(-1)!;
    expect(url).not.toContain('category=');
  });
});
