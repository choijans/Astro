import type { IAstroClient } from './astro-client.interface';
import type { AstroChannelRecord } from './astro.types';
import { CachedAstroClient } from './cached-astro-client';

function makeRecords(): AstroChannelRecord[] {
  return [
    {
      id: 1,
      title: 'Astro30',
      subtitle: 'CH 30',
      imageUrl: 'https://example.com/30.png',
      detailUrl: 'https://example.com/30',
      stbNumber: '30',
      category: 'News',
      genreKey: ['news'],
      languageKey: ['english'],
      rangeKey: '0_199',
      ranking: 1,
      currentSchedule: [],
    },
  ];
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (err: Error) => void;
}

function defer<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (err: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('CachedAstroClient', () => {
  it('two concurrent calls while nothing is cached yet merge into one HTTP call', async () => {
    const deferred = defer<AstroChannelRecord[]>();
    const fetchChannels = jest.fn(() => deferred.promise);
    const client: IAstroClient = { fetchChannels };
    const cached = new CachedAstroClient(client, 60_000);

    const first = cached.getSnapshot();
    const second = cached.getSnapshot();

    expect(fetchChannels).toHaveBeenCalledTimes(1);

    const records = makeRecords();
    deferred.resolve(records);
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult.records).toBe(records);
    expect(secondResult.records).toBe(records);
    expect(firstResult.fetchedAt).toEqual(secondResult.fetchedAt);
  });

  it('a call within the TTL makes no new HTTP call and returns the same snapshot', async () => {
    const records = makeRecords();
    const fetchChannels = jest.fn().mockResolvedValue(records);
    const client: IAstroClient = { fetchChannels };
    const cached = new CachedAstroClient(client, 60_000);

    const snapshot = await cached.getSnapshot();
    const again = await cached.getSnapshot();

    expect(fetchChannels).toHaveBeenCalledTimes(1);
    expect(again).toBe(snapshot);
  });

  it('a call after the TTL expires makes a new HTTP call', async () => {
    const fetchChannels = jest
      .fn()
      .mockResolvedValueOnce(makeRecords())
      .mockResolvedValueOnce(makeRecords());
    const client: IAstroClient = { fetchChannels };
    const cached = new CachedAstroClient(client, 10);

    await cached.getSnapshot();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await cached.getSnapshot();

    expect(fetchChannels).toHaveBeenCalledTimes(2);
  });

  it('a failed fetch is never cached: the next call retries instead of reusing the rejection', async () => {
    const fetchChannels = jest
      .fn()
      .mockRejectedValueOnce(new Error('Astro is down'))
      .mockResolvedValueOnce(makeRecords());
    const client: IAstroClient = { fetchChannels };
    const cached = new CachedAstroClient(client, 60_000);

    await expect(cached.getSnapshot()).rejects.toThrow('Astro is down');

    const snapshot = await cached.getSnapshot();
    expect(fetchChannels).toHaveBeenCalledTimes(2);
    expect(snapshot.records).toHaveLength(1);
  });

  it('a failure during one in-flight fetch rejects every caller merged into it, and none of them get a cached result', async () => {
    const deferred = defer<AstroChannelRecord[]>();
    const fetchChannels = jest.fn(() => deferred.promise);
    const client: IAstroClient = { fetchChannels };
    const cached = new CachedAstroClient(client, 60_000);

    const first = cached.getSnapshot();
    const second = cached.getSnapshot();
    deferred.reject(new Error('timeout'));

    await expect(first).rejects.toThrow('timeout');
    await expect(second).rejects.toThrow('timeout');
    expect(fetchChannels).toHaveBeenCalledTimes(1);
  });

  it('exposes the moment the list was actually fetched, both via getSnapshot and through fetchChannels() indirectly', async () => {
    const records = makeRecords();
    const fetchChannels = jest.fn().mockResolvedValue(records);
    const client: IAstroClient = { fetchChannels };
    const cached = new CachedAstroClient(client, 60_000);

    const before = Date.now();
    const snapshot = await cached.getSnapshot();
    const after = Date.now();

    expect(snapshot.fetchedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(snapshot.fetchedAt.getTime()).toBeLessThanOrEqual(after);

    const viaInterface = await cached.fetchChannels();
    expect(viaInterface).toBe(records);
  });
});
