import { ApiError, getChannels } from '../lib/api';

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

  it('sends the X-User-Id header on every request', async () => {
    mockFetchOnce(200, { data: [], page: 1, limit: 24, total: 0, hasNextPage: false });

    await getChannels({ sort: 'title' });

    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(init.headers['X-User-Id']).toMatch(/^[0-9a-f-]{36}$/i);
  });
});
