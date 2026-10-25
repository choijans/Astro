import type { Prisma } from '../../generated/prisma/client';

export interface AstroScheduleEntry {
  id: string;
  siTrafficKey: string;
  title: string;
  eventStartMyt: string;
  eventEndMyt: string;
  detailUrl: string;
}

/** A single channel record exactly as Astro returns it. */
export interface AstroChannelRecord {
  id: number;
  title: string;
  subtitle: string;
  imageUrl: string;
  detailUrl: string;
  stbNumber: string;
  category: string;
  genreKey: string[];
  languageKey: string[];
  rangeKey: string;
  ranking: number;
  currentSchedule: AstroScheduleEntry[];
  isAstroFirstExclusive?: boolean;
  isAstroGoExclusive?: boolean;
  isRadioExclusive?: boolean;
}

/** The full envelope returned by GET /api/v2/search-linear. */
export interface AstroSearchLinearResponse {
  responseCode: number;
  responseMessage: string;
  response: {
    channels: {
      data: AstroChannelRecord[];
      pagination: Record<string, unknown>;
    };
    /** Not used by this app; always ignored. */
    linearContent?: {
      data: unknown[];
      pagination: Record<string, unknown>;
    };
  };
}

/** The shape SyncService/seed need after mapping, ready for a Prisma upsert. */
export interface MappedChannel {
  id: number;
  title: string;
  subtitle: string;
  stbNumber: number;
  imageUrl: string;
  category: string;
  genres: string[];
  languages: string[];
  rangeKey: string;
  ranking: number;
  schedule: Prisma.InputJsonValue;
  scheduleUpdatedAt: Date;
}
