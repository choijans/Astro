import type { AstroScheduleEntry } from '../astro/astro.types';

export interface ShowSlot {
  title: string;
  start: string;
  end: string;
}

export interface NowNext {
  now: ShowSlot | null;
  next: ShowSlot | null;
}

function toSlot(entry: AstroScheduleEntry): ShowSlot {
  return { title: entry.title, start: entry.eventStartMyt, end: entry.eventEndMyt };
}

/**
 * now: the entry with start <= at < end.
 * next: the first entry starting at or after now's end, or — if there's no
 * now — the first entry starting after `at`. Both null if nothing qualifies
 * (e.g. the stored schedule is stale and entirely in the past).
 */
export function computeNowNext(schedule: unknown, at: Date): NowNext {
  const entries = Array.isArray(schedule) ? (schedule as AstroScheduleEntry[]) : [];
  const sorted = [...entries].sort(
    (a, b) => new Date(a.eventStartMyt).getTime() - new Date(b.eventStartMyt).getTime(),
  );
  const atTime = at.getTime();

  const nowEntry = sorted.find((entry) => {
    const start = new Date(entry.eventStartMyt).getTime();
    const end = new Date(entry.eventEndMyt).getTime();
    return start <= atTime && atTime < end;
  });

  const threshold = nowEntry ? new Date(nowEntry.eventEndMyt).getTime() : atTime;
  const nextEntry = sorted.find((entry) => {
    const start = new Date(entry.eventStartMyt).getTime();
    return nowEntry ? start >= threshold : start > threshold;
  });

  return {
    now: nowEntry ? toSlot(nowEntry) : null,
    next: nextEntry ? toSlot(nextEntry) : null,
  };
}
