import { AstroChannelRecord } from './astro.types';

export const ASTRO_CLIENT = Symbol('ASTRO_CLIENT');

/** Thrown by an IAstroClient implementation on any failure to fetch channels. */
export class AstroApiError extends Error {}

export interface IAstroClient {
  /**
   * Fetches every channel from Astro's list endpoint, already unwrapped from the
   * response envelope. `linearContent` is never returned to callers.
   * @throws {AstroApiError} on a network error, timeout, or an unexpected responseCode.
   */
  fetchChannels(): Promise<AstroChannelRecord[]>;
}
