import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FavouritesPage } from '../components/FavouritesPage';
import { ApiError, ChannelListItem, getFavourites, removeFavourite } from '../lib/api';
import { renderWithQueryClient } from '../testing/test-utils';

jest.mock('../lib/api', () => ({
  ...jest.requireActual('../lib/api'),
  getFavourites: jest.fn(),
  addFavourite: jest.fn(),
  removeFavourite: jest.fn(),
}));

function makeFavourite(overrides: Partial<ChannelListItem> = {}): ChannelListItem {
  return {
    id: 1,
    title: 'Astro30',
    subtitle: 'CH 30',
    stbNumber: 30,
    imageUrl: 'https://divign0fdw3sv.cloudfront.net/logo.png',
    category: 'News',
    genres: ['news'],
    languages: ['others'],
    rangeKey: '0_199',
    ranking: 1,
    scheduleUpdatedAt: '2026-01-01T00:00:00Z',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    now: null,
    next: null,
    ...overrides,
  };
}

// The card's heart is a sibling of its link, not nested inside it (a
// <button> inside an <a> is invalid HTML), so scoping to the card means
// going up to the link's parent rather than using closest('a').
function cardFor(titleEl: HTMLElement): HTMLElement {
  return titleEl.closest('a')?.parentElement as HTMLElement;
}

// Mirrors what the real GET /favourites returns after a write resolves —
// see FavouriteButton.test.tsx for why a frozen mock value is wrong here.
let favouritesState: ChannelListItem[] = [];

beforeEach(() => {
  jest.clearAllMocks();
  favouritesState = [makeFavourite({ id: 1, title: 'Astro30' }), makeFavourite({ id: 2, title: 'Astro31' })];
  (getFavourites as jest.Mock).mockImplementation(() => Promise.resolve(favouritesState));
});

describe('FavouritesPage', () => {
  it('shows only the favourited channels', async () => {
    renderWithQueryClient(<FavouritesPage />);

    expect(await screen.findByText('Astro30')).toBeInTheDocument();
    expect(screen.getByText('Astro31')).toBeInTheDocument();
  });

  it('shows an empty state with a link back to the channel list when there are no favourites', async () => {
    favouritesState = [];
    renderWithQueryClient(<FavouritesPage />);

    expect(await screen.findByText('No favourites yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Browse channels' })).toHaveAttribute('href', '/');
  });

  it('shows an error state with a retry control', async () => {
    (getFavourites as jest.Mock).mockRejectedValue(new ApiError('Could not load your favourites.', 500));
    renderWithQueryClient(<FavouritesPage />);

    expect(await screen.findByText('Could not load your favourites.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('removes the card immediately when a favourite is removed, and keeps it removed on success', async () => {
    (removeFavourite as jest.Mock).mockImplementation(async (channelId: number) => {
      favouritesState = favouritesState.filter((channel) => channel.id !== channelId);
      return {
        id: 'cmd-1',
        seq: '1',
        userId: 'user-1',
        type: 'REMOVE_FAVORITE',
        channelId,
        status: 'DONE',
        error: null,
        createdAt: '2026-01-01T00:00:00Z',
        processedAt: '2026-01-01T00:00:00Z',
      };
    });
    const user = userEvent.setup();
    renderWithQueryClient(<FavouritesPage />);

    const card30 = cardFor(await screen.findByText('Astro30'));
    const removeButton = within(card30).getByRole('button', { name: 'Remove Astro30 from favourites' });

    await user.click(removeButton);

    await waitFor(() => expect(screen.queryByText('Astro30')).not.toBeInTheDocument());
    expect(screen.getByText('Astro31')).toBeInTheDocument();
  });

  it('restores the card when a removal fails', async () => {
    (removeFavourite as jest.Mock).mockRejectedValue(new ApiError('Internal server error', 500));
    const user = userEvent.setup();
    renderWithQueryClient(<FavouritesPage />);

    const card30 = cardFor(await screen.findByText('Astro30'));
    const removeButton = within(card30).getByRole('button', { name: 'Remove Astro30 from favourites' });

    await user.click(removeButton);

    // Rolled back: the card is back, with its heart showing "favourited" again.
    await waitFor(() =>
      expect(
        within(cardFor(screen.getByText('Astro30'))).getByRole('button', {
          name: 'Remove Astro30 from favourites',
        }),
      ).toBeInTheDocument(),
    );
  });
});
