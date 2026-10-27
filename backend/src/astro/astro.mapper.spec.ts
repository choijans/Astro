import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mapAstroChannel } from './astro.mapper';
import { AstroChannelRecord, AstroSearchLinearResponse } from './astro.types';

const fixturePath = join(__dirname, '../../test/fixtures/astro-response.json');
const fixture = JSON.parse(
  readFileSync(fixturePath, 'utf-8'),
) as AstroSearchLinearResponse;
const records: AstroChannelRecord[] = fixture.response.channels.data;
const syncedAt = new Date('2026-01-01T00:00:00Z');

describe('mapAstroChannel (against the real fixture)', () => {
  it('maps every record in the fixture without throwing', () => {
    expect(() =>
      records.map((record) => mapAstroChannel(record, syncedAt)),
    ).not.toThrow();
  });

  it('casts stbNumber from a string to an integer', () => {
    const record = records[0];
    const mapped = mapAstroChannel(record, syncedAt);
    expect(typeof record.stbNumber).toBe('string');
    expect(typeof mapped.stbNumber).toBe('number');
    expect(mapped.stbNumber).toBe(parseInt(record.stbNumber, 10));
  });

  it('keeps the subtitle exactly as given, including Astro GO channels whose subtitle is not "CH n"', () => {
    const astroGoRecord = records.find((record) => record.isAstroGoExclusive);
    expect(astroGoRecord).toBeDefined();
    expect(astroGoRecord!.subtitle).not.toMatch(/^CH \d+$/);

    const mapped = mapAstroChannel(astroGoRecord!, syncedAt);
    expect(mapped.subtitle).toBe(astroGoRecord!.subtitle);
  });

  it('drops isAstroFirstExclusive, isAstroGoExclusive and isRadioExclusive', () => {
    const flaggedRecord = records.find(
      (record) =>
        record.isAstroFirstExclusive ||
        record.isAstroGoExclusive ||
        record.isRadioExclusive,
    );
    expect(flaggedRecord).toBeDefined();

    const mapped = mapAstroChannel(flaggedRecord!, syncedAt) as Record<
      string,
      unknown
    >;
    expect(mapped.isAstroFirstExclusive).toBeUndefined();
    expect(mapped.isAstroGoExclusive).toBeUndefined();
    expect(mapped.isRadioExclusive).toBeUndefined();
  });

  it('sets scheduleUpdatedAt to the supplied sync time, not an Astro-supplied field', () => {
    const mapped = mapAstroChannel(records[0], syncedAt);
    expect(mapped.scheduleUpdatedAt).toBe(syncedAt);
  });
});
