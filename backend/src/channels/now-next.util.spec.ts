import { computeNowNext } from './now-next.util';

function entry(title: string, start: string, end: string) {
  return {
    id: title,
    siTrafficKey: title,
    title,
    eventStartMyt: start,
    eventEndMyt: end,
    detailUrl: '',
  };
}

const SCHEDULE = [
  entry('Show A', '2026-01-01T08:00:00+08:00', '2026-01-01T09:00:00+08:00'),
  entry('Show B', '2026-01-01T09:00:00+08:00', '2026-01-01T10:00:00+08:00'),
  entry('Show C', '2026-01-01T10:00:00+08:00', '2026-01-01T11:00:00+08:00'),
];

describe('computeNowNext', () => {
  it('finds now and next when the clock is inside a show', () => {
    const at = new Date('2026-01-01T08:30:00+08:00');

    const { now, next } = computeNowNext(SCHEDULE, at);

    expect(now).toEqual({ title: 'Show A', start: SCHEDULE[0].eventStartMyt, end: SCHEDULE[0].eventEndMyt });
    expect(next).toEqual({ title: 'Show B', start: SCHEDULE[1].eventStartMyt, end: SCHEDULE[1].eventEndMyt });
  });

  it('finds no now but a next when the clock sits in a gap between shows', () => {
    const gappy = [
      entry('Show A', '2026-01-01T08:00:00+08:00', '2026-01-01T09:00:00+08:00'),
      entry('Show B', '2026-01-01T09:30:00+08:00', '2026-01-01T10:30:00+08:00'),
    ];
    const at = new Date('2026-01-01T09:15:00+08:00'); // after A ends, before B starts

    const { now, next } = computeNowNext(gappy, at);

    expect(now).toBeNull();
    expect(next).toEqual({ title: 'Show B', start: gappy[1].eventStartMyt, end: gappy[1].eventEndMyt });
  });

  it('returns a null next when now is the last item in the schedule', () => {
    const at = new Date('2026-01-01T10:30:00+08:00'); // inside Show C, the last entry

    const { now, next } = computeNowNext(SCHEDULE, at);

    expect(now).toEqual({ title: 'Show C', start: SCHEDULE[2].eventStartMyt, end: SCHEDULE[2].eventEndMyt });
    expect(next).toBeNull();
  });

  it('returns both null when the entire schedule is in the past', () => {
    const at = new Date('2026-01-02T00:00:00+08:00'); // a full day after everything ended

    const { now, next } = computeNowNext(SCHEDULE, at);

    expect(now).toBeNull();
    expect(next).toBeNull();
  });

  it('returns both null for an empty schedule', () => {
    const { now, next } = computeNowNext([], new Date());

    expect(now).toBeNull();
    expect(next).toBeNull();
  });

  it('returns both null when schedule is not an array (defensive)', () => {
    const { now, next } = computeNowNext(null, new Date());

    expect(now).toBeNull();
    expect(next).toBeNull();
  });
});
