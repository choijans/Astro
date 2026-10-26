describe('getOrCreateUserId', () => {
  beforeEach(() => {
    window.localStorage.clear();
    jest.resetModules();
  });

  it('creates a UUID on first call and persists it to localStorage', async () => {
    const { getOrCreateUserId } = await import('../lib/user-id');
    const id = getOrCreateUserId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(window.localStorage.getItem('astro-portal:user-id')).toBe(id);
  });

  it('is never regenerated: returns the same id on every later call', async () => {
    const { getOrCreateUserId } = await import('../lib/user-id');
    const first = getOrCreateUserId();
    const second = getOrCreateUserId();
    const third = getOrCreateUserId();
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it('reads back the same id that was previously persisted', async () => {
    window.localStorage.setItem('astro-portal:user-id', 'fixed-id-123');
    const { getOrCreateUserId } = await import('../lib/user-id');
    expect(getOrCreateUserId()).toBe('fixed-id-123');
  });

  it('falls back to an in-memory id when localStorage throws, and still never regenerates', async () => {
    const getItemSpy = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked (private mode)');
    });

    const { getOrCreateUserId } = await import('../lib/user-id');
    const first = getOrCreateUserId();
    const second = getOrCreateUserId();
    expect(second).toBe(first);
    expect(first).toMatch(/^[0-9a-f-]{36}$/i);

    getItemSpy.mockRestore();
  });
});
