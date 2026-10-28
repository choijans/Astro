import type { Redis } from 'ioredis';
import { CacheService } from './cache.service';

function makeRedis(overrides: Partial<Redis> = {}): Redis {
  return {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    ...overrides,
  } as unknown as Redis;
}

describe('CacheService', () => {
  const originalEnv = process.env.CACHE_ENABLED;

  afterEach(() => {
    process.env.CACHE_ENABLED = originalEnv;
  });

  describe('get/set/del', () => {
    it('get returns the parsed value on a hit', async () => {
      const redis = makeRedis({
        get: jest.fn().mockResolvedValue('{"id":1}'),
      });
      const cache = new CacheService(redis);

      await expect(cache.get('k')).resolves.toEqual({ id: 1 });
    });

    it('get returns null on a miss', async () => {
      const redis = makeRedis({ get: jest.fn().mockResolvedValue(null) });
      const cache = new CacheService(redis);

      await expect(cache.get('k')).resolves.toBeNull();
    });

    it('set stores the value JSON-stringified with the given TTL', async () => {
      const redis = makeRedis({ set: jest.fn().mockResolvedValue('OK') });
      const cache = new CacheService(redis);

      await cache.set('k', { id: 1 }, 30);

      expect(redis.set).toHaveBeenCalledWith('k', '{"id":1}', 'EX', 30);
    });

    it('del removes the key', async () => {
      const redis = makeRedis({ del: jest.fn().mockResolvedValue(1) });
      const cache = new CacheService(redis);

      await cache.del('k');

      expect(redis.del).toHaveBeenCalledWith('k');
    });
  });

  describe('fail-open', () => {
    it('get resolves to null (not a throw) when redis.get rejects with a generic error', async () => {
      const redis = makeRedis({
        get: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
      });
      const cache = new CacheService(redis);

      await expect(cache.get('k')).resolves.toBeNull();
    });

    it('get resolves to null (not a throw) when redis.get rejects with a command timeout', async () => {
      const redis = makeRedis({
        get: jest.fn().mockRejectedValue(new Error('Command timed out')),
      });
      const cache = new CacheService(redis);

      await expect(cache.get('k')).resolves.toBeNull();
    });

    it('set resolves (not a throw) when redis.set rejects', async () => {
      const redis = makeRedis({
        set: jest.fn().mockRejectedValue(new Error('Command timed out')),
      });
      const cache = new CacheService(redis);

      await expect(cache.set('k', { id: 1 }, 30)).resolves.toBeUndefined();
    });

    it('del resolves (not a throw) when redis.del rejects', async () => {
      const redis = makeRedis({
        del: jest.fn().mockRejectedValue(new Error('Command timed out')),
      });
      const cache = new CacheService(redis);

      await expect(cache.del('k')).resolves.toBeUndefined();
    });
  });

  describe('wrap', () => {
    function makeRes() {
      return { setHeader: jest.fn() };
    }

    it('on a hit, returns the cached value, sets X-Cache: HIT, and never calls fn', async () => {
      process.env.CACHE_ENABLED = 'true';
      const redis = makeRedis({ get: jest.fn().mockResolvedValue('{"id":1}') });
      const cache = new CacheService(redis);
      const fn = jest.fn().mockResolvedValue({ id: 2 });
      const res = makeRes();

      const result = await cache.wrap('k', 30, fn, res);

      expect(result).toEqual({ id: 1 });
      expect(fn).not.toHaveBeenCalled();
      expect(res.setHeader).toHaveBeenCalledWith('X-Cache', 'HIT');
    });

    it('on a miss, calls fn, sets X-Cache: MISS, and stores the result', async () => {
      process.env.CACHE_ENABLED = 'true';
      const redis = makeRedis({
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn().mockResolvedValue('OK'),
      });
      const cache = new CacheService(redis);
      const fn = jest.fn().mockResolvedValue({ id: 2 });
      const res = makeRes();

      const result = await cache.wrap('k', 30, fn, res);

      expect(result).toEqual({ id: 2 });
      expect(res.setHeader).toHaveBeenCalledWith('X-Cache', 'MISS');
      expect(redis.set).toHaveBeenCalledWith('k', '{"id":2}', 'EX', 30);
    });

    it('when disabled, calls fn directly and sets no header at all', async () => {
      process.env.CACHE_ENABLED = 'false';
      const redis = makeRedis();
      const cache = new CacheService(redis);
      const fn = jest.fn().mockResolvedValue({ id: 2 });
      const res = makeRes();

      const result = await cache.wrap('k', 30, fn, res);

      expect(result).toEqual({ id: 2 });
      expect(redis.get).not.toHaveBeenCalled();
      expect(res.setHeader).not.toHaveBeenCalled();
    });

    it('a business error thrown by fn propagates and is never cached', async () => {
      process.env.CACHE_ENABLED = 'true';
      const redis = makeRedis({
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn().mockResolvedValue('OK'),
      });
      const cache = new CacheService(redis);
      const fn = jest.fn().mockRejectedValue(new Error('not found'));
      const res = makeRes();

      await expect(cache.wrap('k', 30, fn, res)).rejects.toThrow('not found');
      expect(redis.set).not.toHaveBeenCalled();
    });

    it('fails open: a cache GET error still serves fn and does not throw', async () => {
      process.env.CACHE_ENABLED = 'true';
      const redis = makeRedis({
        get: jest.fn().mockRejectedValue(new Error('Command timed out')),
        set: jest.fn().mockResolvedValue('OK'),
      });
      const cache = new CacheService(redis);
      const fn = jest.fn().mockResolvedValue({ id: 2 });
      const res = makeRes();

      const result = await cache.wrap('k', 30, fn, res);

      expect(result).toEqual({ id: 2 });
      expect(res.setHeader).toHaveBeenCalledWith('X-Cache', 'MISS');
    });
  });
});
