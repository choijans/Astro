import { ScheduleEntry } from './api';

export interface UpcomingSchedule {
  entries: ScheduleEntry[];
  nowIndex: number;
}

/**
 * Entries whose end time has already passed are dropped entirely. Of what's
 * left, nowIndex points at the one currently airing (start <= at < end), or
 * -1 if nothing is airing right now (a gap, or the schedule is stale).
 */
export function getUpcomingSchedule(schedule: ScheduleEntry[], at: Date): UpcomingSchedule {
  const atTime = at.getTime();

  const entries = schedule
    .filter((entry) => new Date(entry.eventEndMyt).getTime() > atTime)
    .sort((a, b) => new Date(a.eventStartMyt).getTime() - new Date(b.eventStartMyt).getTime());

  const nowIndex = entries.findIndex((entry) => new Date(entry.eventStartMyt).getTime() <= atTime);

  return { entries, nowIndex };
}
