import { HttpException } from '@nestjs/common';
import { AppThrottlerGuard } from './app-throttler.guard';

// getTracker/throwThrottlingException are protected; cast to call them
// directly rather than standing up a full guard + controller for this.
type ExposedGuard = {
  getTracker(req: Record<string, unknown>): Promise<string>;
  throwThrottlingException(context: never, detail: never): Promise<void>;
};

function createExposedGuard(): ExposedGuard {
  return Object.create(AppThrottlerGuard.prototype) as ExposedGuard;
}

describe('AppThrottlerGuard.getTracker', () => {
  const guard = createExposedGuard();

  it('tracks by X-User-Id when it is a valid UUID', async () => {
    const req = {
      headers: { 'x-user-id': '11111111-1111-4111-8111-111111111111' },
    };
    await expect(guard.getTracker(req)).resolves.toBe(
      'user:11111111-1111-4111-8111-111111111111',
    );
  });

  it('falls back to the IP when X-User-Id is missing', async () => {
    const req = { headers: {}, ip: '203.0.113.5' };
    await expect(guard.getTracker(req)).resolves.toBe('ip:203.0.113.5');
  });

  it('falls back to the IP when X-User-Id is present but not a valid UUID', async () => {
    const req = { headers: { 'x-user-id': 'not-a-uuid' }, ip: '203.0.113.5' };
    await expect(guard.getTracker(req)).resolves.toBe('ip:203.0.113.5');
  });
});

describe('AppThrottlerGuard.throwThrottlingException', () => {
  it('throws an HttpException shaped as { statusCode, message, error }, not the base ThrottlerException', async () => {
    const guard = createExposedGuard();

    let caught: unknown;
    try {
      await guard.throwThrottlingException(
        undefined as never,
        undefined as never,
      );
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(HttpException);
    expect((caught as HttpException).getStatus()).toBe(429);
    expect((caught as HttpException).getResponse()).toEqual({
      statusCode: 429,
      message: 'Too many requests. Please wait a moment and try again.',
      error: 'Too Many Requests',
    });
  });
});
