import { AstroApiError } from './astro-client.interface';
import { AstroChannelRecord, AstroSearchLinearResponse } from './astro.types';

/**
 * Unwraps the Astro response envelope: validates responseCode and returns only
 * response.channels.data. response.linearContent is never read by this app.
 * Shared by HttpAstroClient (live) and FixtureAstroClient (seed/tests) so both
 * paths apply the exact same validation.
 */
export function parseAstroEnvelope(body: AstroSearchLinearResponse): AstroChannelRecord[] {
  if (body.responseCode !== 200) {
    throw new AstroApiError(
      `Astro responded with responseCode ${body.responseCode}: ${body.responseMessage}`,
    );
  }

  return body.response.channels.data;
}
