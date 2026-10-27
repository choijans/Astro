import { Injectable, Optional } from '@nestjs/common';
import { AstroApiError, IAstroClient } from './astro-client.interface';
import { parseAstroEnvelope } from './astro-envelope';
import { AstroChannelRecord, AstroSearchLinearResponse } from './astro.types';

/** Required to get the envelope this app expects; verified against the real API. */
const QUERY_STRING =
  'channelGuide=true&platform=acm&channelOrderBy=stbNumber,asc';
const DEFAULT_TIMEOUT_MS = 10_000;

@Injectable()
export class HttpAstroClient implements IAstroClient {
  // @Optional(): Nest's DI container would otherwise try (and fail) to
  // resolve a provider for the bare `number` parameter type when this class
  // is constructed via `useClass` (as AstroModule now does) instead of `new
  // HttpAstroClient()` directly; with @Optional(), an unresolvable param is
  // just injected as undefined, and the default value applies as normal.
  constructor(
    @Optional() private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {}

  async fetchChannels(): Promise<AstroChannelRecord[]> {
    const baseUrl = process.env.ASTRO_API_URL;
    if (!baseUrl) {
      throw new AstroApiError('ASTRO_API_URL is not set');
    }
    const url = `${baseUrl}?${QUERY_STRING}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await fetch(url, { signal: controller.signal });
    } catch (err) {
      throw new AstroApiError(
        `Astro request failed: ${(err as Error).message}`,
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw new AstroApiError(`Astro responded with HTTP ${response.status}`);
    }

    const body = (await response.json()) as AstroSearchLinearResponse;

    return parseAstroEnvelope(body);
  }
}
