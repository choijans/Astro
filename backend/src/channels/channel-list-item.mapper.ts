import { Prisma } from '../../generated/prisma/client';
import { CHANNEL_LIST_SELECT } from './channels.repository';
import { computeNowNext, ShowSlot } from './now-next.util';

export type ChannelListRow = Prisma.ChannelGetPayload<{ select: typeof CHANNEL_LIST_SELECT }>;

export interface ChannelListItem {
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
  scheduleUpdatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  now: ShowSlot | null;
  next: ShowSlot | null;
}

/**
 * Shared by GET /channels and GET /favourites, so both ever compute now/next
 * the same way. Strips the raw `schedule` — it's never sent to a list client.
 */
export function toChannelListItem(row: ChannelListRow, at: Date): ChannelListItem {
  const { schedule, ...rest } = row;
  const { now, next } = computeNowNext(schedule, at);
  return { ...rest, now, next };
}
