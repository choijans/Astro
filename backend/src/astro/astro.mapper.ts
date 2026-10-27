import { AstroChannelRecord, MappedChannel } from './astro.types';

/**
 * Maps one raw Astro channel record to the shape Prisma upserts.
 *
 * - stbNumber arrives as a string and is stored as an integer.
 * - subtitle is kept exactly as given: most channels are "CH <n>", but a few
 *   (e.g. Astro GO channels) are not, so no prefix is assumed.
 * - isAstroFirstExclusive / isAstroGoExclusive / isRadioExclusive are dropped; unused.
 * - scheduleUpdatedAt is the caller-supplied sync time, since Astro gives no timestamp.
 */
export function mapAstroChannel(
  record: AstroChannelRecord,
  syncedAt: Date,
): MappedChannel {
  return {
    id: record.id,
    title: record.title,
    subtitle: record.subtitle,
    stbNumber: parseInt(record.stbNumber, 10),
    imageUrl: record.imageUrl,
    category: record.category,
    genres: record.genreKey,
    languages: record.languageKey,
    rangeKey: record.rangeKey,
    ranking: record.ranking,
    schedule: record.currentSchedule as unknown as MappedChannel['schedule'],
    scheduleUpdatedAt: syncedAt,
  };
}
