import { ApiError, getChannels, NetworkError } from '../lib/api';

function mockFetchOnce(status: number, body: unknown) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as jest.Mock;
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_API_URL = 'http://api.test';
});

describe('API error handling', () => {
  it('extracts a plain string message (most errors)', async () => {
    mockFetchOnce(404, { statusCode: 404, message: 'Channel 999999 not found', error: 'Not Found' });

    await expect(getChannels({})).rejects.toBeInstanceOf(ApiError);
    await expect(getChannels({})).rejects.toMatchObject({
      message: 'Channel 999999 not found',
      statusCode: 404,
    });
  });

  it('extracts an array message (ValidationPipe failures) by joining it into one string', async () => {
    mockFetchOnce(400, {
      statusCode: 400,
      message: ['sort must be one of the following values: stbNumber, title, ranking'],
      error: 'Bad Request',
    });

    await expect(getChannels({})).rejects.toMatchObject({
      message: 'sort must be one of the following values: stbNumber, title, ranking',
      statusCode: 400,
    });
  });

  it('joins a multi-element array message', async () => {
    mockFetchOnce(400, { statusCode: 400, message: ['field a is required', 'field b is required'] });

    await expect(getChannels({})).rejects.toMatchObject({
      message: 'field a is required, field b is required',
    });
  });

  it('falls back to a generic message when the error body is unreadable', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error('not json');
      },
    }) as jest.Mock;

    await expect(getChannels({})).rejects.toMatchObject({ statusCode: 500 });
  });

  it('turns a 429 into a clear, fixed message and reads Retry-After when present', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: { get: (name: string) => (name === 'Retry-After' ? '42' : null) },
      json: async () => ({ statusCode: 429, message: 'ThrottlerException: Too Many Requests' }),
    }) as jest.Mock;

    await expect(getChannels({})).rejects.toMatchObject({
      message: 'Too many requests. Please wait a moment and try again.',
      statusCode: 429,
      retryAfterSeconds: 42,
    });
  });

  it('a 429 without a Retry-After header still gets the clear message, with no retryAfterSeconds', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: { get: () => null },
      json: async () => ({ statusCode: 429, message: 'ThrottlerException: Too Many Requests' }),
    }) as jest.Mock;

    await expect(getChannels({})).rejects.toMatchObject({
      message: 'Too many requests. Please wait a moment and try again.',
      statusCode: 429,
      retryAfterSeconds: undefined,
    });
  });

  it('sends the X-User-Id header on every request', async () => {
    mockFetchOnce(200, { data: [], page: 1, limit: 24, total: 0, hasNextPage: false });

    await getChannels({ sort: 'title' });

    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(init.headers['X-User-Id']).toMatch(/^[0-9a-f-]{36}$/i);
  });
});

describe('NetworkError handling (the server gave no answer at all)', () => {
  const originalTimeout = process.env.NEXT_PUBLIC_REQUEST_TIMEOUT_MS;

  afterEach(() => {
    if (originalTimeout === undefined) {
      delete process.env.NEXT_PUBLIC_REQUEST_TIMEOUT_MS;
    } else {
      process.env.NEXT_PUBLIC_REQUEST_TIMEOUT_MS = originalTimeout;
    }
  });

  it('a rejected fetch (offline, DNS failure, connection refused) becomes a NetworkError', async () => {
    global.fetch = jest.fn().mockRejectedValue(new TypeError('Failed to fetch')) as jest.Mock;

    await expect(getChannels({})).rejects.toBeInstanceOf(NetworkError);
  });

  it('a request that outlives NEXT_PUBLIC_REQUEST_TIMEOUT_MS is aborted and becomes a NetworkError', async () => {
    process.env.NEXT_PUBLIC_REQUEST_TIMEOUT_MS = '30';
    global.fetch = jest.fn(
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted.', 'AbortError')),
          );
        }),
    ) as unknown as jest.Mock;

    await expect(getChannels({})).rejects.toBeInstanceOf(NetworkError);
  });

  it('an ApiError (the server did answer, just with an error) is never a NetworkError', async () => {
    mockFetchOnce(500, { statusCode: 500, message: 'Internal server error' });

    await expect(getChannels({})).rejects.toBeInstanceOf(ApiError);
    await expect(getChannels({})).rejects.not.toBeInstanceOf(NetworkError);
  });

  it('an invalid NEXT_PUBLIC_REQUEST_TIMEOUT_MS falls back to the default instead of crashing every request', async () => {
    process.env.NEXT_PUBLIC_REQUEST_TIMEOUT_MS = 'not-a-number';
    mockFetchOnce(200, { data: [], page: 1, limit: 24, total: 0, hasNextPage: false });

    await expect(getChannels({})).resolves.toBeDefined();
  });
});
