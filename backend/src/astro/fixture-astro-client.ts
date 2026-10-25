import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Injectable } from '@nestjs/common';
import { IAstroClient } from './astro-client.interface';
import { parseAstroEnvelope } from './astro-envelope';
import { AstroChannelRecord, AstroSearchLinearResponse } from './astro.types';

export const FIXTURE_PATH = join(process.cwd(), 'test/fixtures/astro-response.json');

/**
 * Reads the single committed Astro response fixture instead of calling the live
 * API. Used by the seed script so seeding goes through the exact same mapper and
 * upsert code as a live sync, with no separate copy of the data.
 */
@Injectable()
export class FixtureAstroClient implements IAstroClient {
  constructor(private readonly fixturePath: string = FIXTURE_PATH) {}

  async fetchChannels(): Promise<AstroChannelRecord[]> {
    const raw = readFileSync(this.fixturePath, 'utf-8');
    const body = JSON.parse(raw) as AstroSearchLinearResponse;
    return parseAstroEnvelope(body);
  }
}
