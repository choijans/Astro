import { usePendingFavouritesStore } from '../store/pending-favourites-store';

beforeEach(() => {
  usePendingFavouritesStore.setState({ pending: {} });
});

describe('usePendingFavouritesStore', () => {
  it('setPending records the desired action, with trustRefetchesAfter null (never trust a refetch while active)', () => {
    usePendingFavouritesStore.getState().setPending(1, 'add');

    expect(usePendingFavouritesStore.getState().pending[1]).toEqual({
      action: 'add',
      trustRefetchesAfter: null,
    });
  });

  it('reconcile does nothing while trustRefetchesAfter is still null (actively polling)', () => {
    usePendingFavouritesStore.getState().setPending(1, 'add');

    usePendingFavouritesStore.getState().reconcile(Date.now() + 1000);

    expect(usePendingFavouritesStore.getState().pending[1]).toBeDefined();
  });

  it('markTimedOut sets trustRefetchesAfter to the current moment', () => {
    const before = Date.now();
    usePendingFavouritesStore.getState().setPending(1, 'add');

    usePendingFavouritesStore.getState().markTimedOut(1);

    const entry = usePendingFavouritesStore.getState().pending[1];
    expect(entry?.trustRefetchesAfter).toBeGreaterThanOrEqual(before);
  });

  it('reconcile drops an entry once a refetch at or after trustRefetchesAfter lands', () => {
    usePendingFavouritesStore.getState().setPending(1, 'add');
    usePendingFavouritesStore.getState().markTimedOut(1);
    const { trustRefetchesAfter } = usePendingFavouritesStore.getState().pending[1]!;

    usePendingFavouritesStore.getState().reconcile(trustRefetchesAfter! - 1);
    expect(usePendingFavouritesStore.getState().pending[1]).toBeDefined();

    usePendingFavouritesStore.getState().reconcile(trustRefetchesAfter!);
    expect(usePendingFavouritesStore.getState().pending[1]).toBeUndefined();
  });

  it('clearPending removes the entry outright, regardless of trustRefetchesAfter', () => {
    usePendingFavouritesStore.getState().setPending(2, 'remove');

    usePendingFavouritesStore.getState().clearPending(2);

    expect(usePendingFavouritesStore.getState().pending[2]).toBeUndefined();
  });

  it('tracks multiple channels independently', () => {
    usePendingFavouritesStore.getState().setPending(1, 'add');
    usePendingFavouritesStore.getState().setPending(2, 'remove');

    usePendingFavouritesStore.getState().clearPending(1);

    expect(usePendingFavouritesStore.getState().pending[1]).toBeUndefined();
    expect(usePendingFavouritesStore.getState().pending[2]).toEqual({ action: 'remove', trustRefetchesAfter: null });
  });
});
