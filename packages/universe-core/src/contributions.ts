/** §3.2 — metrics derived from the contribution calendar (UTC days). */

export interface CalendarDay {
  date: string; // YYYY-MM-DD
  count: number;
}

export interface CalendarMetrics {
  c30: number;
  c90: number;
  c365: number;
  streakCurrent: number;
  streakLongest: number;
  lastActiveOn: string | null;
  /** 364 daily counts, oldest first, ending `today`. */
  calendar52w: number[];
}

const DAY_MS = 86_400_000;
const dayNumber = (iso: string): number => Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);
export const isoDay = (dayNum: number): string => new Date(dayNum * DAY_MS).toISOString().slice(0, 10);

/**
 * `today` defaults to the current UTC day. A streak is "current" if it ends today or yesterday
 * (today isn't over yet — same rule GitHub used on profiles).
 */
export function calendarMetrics(days: CalendarDay[], today: string = new Date().toISOString().slice(0, 10)): CalendarMetrics {
  const todayN = dayNumber(today);
  const counts = new Map<number, number>();
  for (const d of days) counts.set(dayNumber(d.date), (counts.get(dayNumber(d.date)) ?? 0) + d.count);
  const at = (n: number) => counts.get(n) ?? 0;

  let c30 = 0;
  let c90 = 0;
  let c365 = 0;
  for (let i = 0; i < 365; i++) {
    const c = at(todayN - i);
    if (i < 30) c30 += c;
    if (i < 90) c90 += c;
    c365 += c;
  }

  let streakCurrent = 0;
  let start = at(todayN) > 0 ? todayN : todayN - 1;
  while (at(start) > 0) {
    streakCurrent++;
    start--;
  }

  let streakLongest = 0;
  let run = 0;
  let lastActive: number | null = null;
  const sorted = [...counts.keys()].sort((a, b) => a - b);
  if (sorted.length) {
    for (let n = sorted[0]!; n <= Math.max(sorted[sorted.length - 1]!, todayN); n++) {
      if (at(n) > 0) {
        run++;
        lastActive = n;
        if (run > streakLongest) streakLongest = run;
      } else run = 0;
    }
  }

  const calendar52w: number[] = [];
  for (let i = 363; i >= 0; i--) calendar52w.push(Math.min(32767, at(todayN - i)));

  return {
    c30,
    c90,
    c365,
    streakCurrent,
    streakLongest: Math.max(streakLongest, streakCurrent),
    lastActiveOn: lastActive === null ? null : isoDay(lastActive),
    calendar52w,
  };
}

export const daysBetween = (fromIso: string, toIso: string): number => Math.floor((Date.parse(toIso) - Date.parse(fromIso)) / DAY_MS);
