import { addToOutbox, getOutbox, OutboxEntry, removeFromOutbox } from '../lib/outbox';

const USER = 'user-1';

function makeEntry(overrides: Partial<OutboxEntry> = {}): OutboxEntry {
  return {
    id: 'cmd-1',
    type: 'ADD_FAVORITE',
    channelId: 1,
    createdAt: Date.now(),
    ...overrides,
  };
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('outbox persistence', () => {
  it('starts empty', () => {
    expect(getOutbox(USER)).toEqual([]);
  });

  it('adds an entry and reads it back', () => {
    const entry = makeEntry();
    addToOutbox(USER, entry);
    expect(getOutbox(USER)).toEqual([entry]);
  });

  it('removes an entry by id', () => {
    addToOutbox(USER, makeEntry({ id: 'a' }));
    addToOutbox(USER, makeEntry({ id: 'b' }));

    removeFromOutbox(USER, 'a');

    expect(getOutbox(USER).map((e) => e.id)).toEqual(['b']);
  });

  it('keeps insertion (send) order', () => {
    addToOutbox(USER, makeEntry({ id: 'a' }));
    addToOutbox(USER, makeEntry({ id: 'b' }));
    addToOutbox(USER, makeEntry({ id: 'c' }));

    expect(getOutbox(USER).map((e) => e.id)).toEqual(['a', 'b', 'c']);
  });

  it('survives a remount: a fresh read sees what an earlier one wrote', () => {
    addToOutbox(USER, makeEntry({ id: 'persisted' }));

    // Simulates a remount: nothing but localStorage carries state across this.
    const reread = getOutbox(USER);

    expect(reread.map((e) => e.id)).toEqual(['persisted']);
  });

  it('keys different users separately', () => {
    addToOutbox('user-a', makeEntry({ id: 'a' }));
    addToOutbox('user-b', makeEntry({ id: 'b' }));

    expect(getOutbox('user-a').map((e) => e.id)).toEqual(['a']);
    expect(getOutbox('user-b').map((e) => e.id)).toEqual(['b']);
  });
});

describe('the 100-entry cap', () => {
  it('drops the oldest entries once more than 100 are queued', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    for (let i = 0; i < 105; i++) {
      addToOutbox(USER, makeEntry({ id: `cmd-${i}` }));
    }

    const ids = getOutbox(USER).map((e) => e.id);
    expect(ids).toHaveLength(100);
    expect(ids[0]).toBe('cmd-5'); // the oldest 5 (cmd-0..cmd-4) were dropped
    expect(ids[ids.length - 1]).toBe('cmd-104');
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});

describe('the 24-hour expiry', () => {
  it('discards an entry older than 24 hours on read', () => {
    const now = Date.now();
    const DAY_MS = 24 * 60 * 60 * 1000;
    addToOutbox(USER, makeEntry({ id: 'stale', createdAt: now - DAY_MS - 1 }));
    addToOutbox(USER, makeEntry({ id: 'fresh', createdAt: now }));

    expect(getOutbox(USER).map((e) => e.id)).toEqual(['fresh']);
  });

  it('keeps an entry exactly at the boundary (not yet older than 24h)', () => {
    const now = Date.now();
    const DAY_MS = 24 * 60 * 60 * 1000;
    addToOutbox(USER, makeEntry({ id: 'just-under', createdAt: now - DAY_MS + 1000 }));

    expect(getOutbox(USER).map((e) => e.id)).toEqual(['just-under']);
  });
});

describe('localStorage unavailable', () => {
  // Each test uses its own user id: once a key hits a storage error it stays
  // on the memory fallback for the module's lifetime (see lib/outbox.ts), so
  // reusing an id across these tests would leak one test's fallback state
  // into the next.

  it('falls back to an in-memory queue when localStorage throws on write', () => {
    const setItemSpy = jest
      .spyOn(window.localStorage.__proto__, 'setItem')
      .mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });

    addToOutbox('user-fallback-write', makeEntry({ id: 'memory-only' }));
    expect(getOutbox('user-fallback-write').map((e) => e.id)).toEqual(['memory-only']);

    setItemSpy.mockRestore();
  });

  it('falls back to an in-memory queue when localStorage throws on read', () => {
    const getItemSpy = jest
      .spyOn(window.localStorage.__proto__, 'getItem')
      .mockImplementation(() => {
        throw new Error('SecurityError');
      });

    // Reading never throws even though the underlying store is unusable.
    expect(() => getOutbox('user-fallback-read')).not.toThrow();
    expect(getOutbox('user-fallback-read')).toEqual([]);

    getItemSpy.mockRestore();
  });

  it('a write that falls back to memory is still visible to a later read, even once localStorage works again', () => {
    const setItemSpy = jest
      .spyOn(window.localStorage.__proto__, 'setItem')
      .mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });
    addToOutbox('user-fallback-consistency', makeEntry({ id: 'still-here' }));
    setItemSpy.mockRestore(); // localStorage "recovers", but this key already committed to memory

    expect(getOutbox('user-fallback-consistency').map((e) => e.id)).toEqual(['still-here']);
  });
});
