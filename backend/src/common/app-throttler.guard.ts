import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { isUUID } from 'class-validator';

/**
 * Tracks by X-User-Id when it's a syntactically valid UUID, falling back to
 * the connecting IP otherwise. Trade-off, deliberately accepted for this
 * no-auth demo app: tying the limit to a client-supplied identifier means a
 * client willing to mint a fresh UUID per request — the exact same kind of
 * id the frontend already generates for every command's own idempotency key
 * — gets an effectively unlimited budget by rotating it. A real deployment
 * would key this off a server-issued identity (a session or API key the
 * client can't mint itself) instead, with IP-based limiting layered on top
 * specifically to catch that rotation case. IP-based tracking has its own
 * weakness behind a reverse proxy: every request can arrive from the
 * proxy's own address unless the proxy sets (and this app is configured to
 * trust) a forwarded-for header, which is itself spoofable by anyone who can
 * reach the proxy directly — not a concern yet, since nothing sits in front
 * of this app today.
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected getTracker(req: Record<string, any>): Promise<string> {
    const headers = req.headers as Record<string, unknown> | undefined;
    const userId = headers?.['x-user-id'];
    if (typeof userId === 'string' && isUUID(userId)) {
      return Promise.resolve(`user:${userId}`);
    }
    const ip = typeof req.ip === 'string' ? req.ip : 'unknown';
    return Promise.resolve(`ip:${ip}`);
  }

  // Fewer parameters than the base signature is a valid override in
  // TypeScript — neither is used, and this app's rendered error shape
  // doesn't depend on which route or limit triggered it.
  protected throwThrottlingException(): Promise<void> {
    // The base ThrottlerException passes a bare string to HttpException,
    // which Nest's default filter renders as { statusCode, message } only —
    // this app's error shape also requires `error`, so a plain HttpException
    // with the full object is thrown instead. The guard has already set the
    // Retry-After header (and the X-RateLimit-* headers) before calling this.
    throw new HttpException(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message: 'Too many requests. Please wait a moment and try again.',
        error: 'Too Many Requests',
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
