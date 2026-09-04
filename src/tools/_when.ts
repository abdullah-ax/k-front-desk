/**
 * Turning what a caller said about time into a timestamp.
 *
 * A caller says "Friday morning", not an ISO 8601 string, and a model asked for
 * one will happily invent a year. So the model is asked for the loose parts it
 * actually heard and the arithmetic happens here, where it is testable and
 * where "next Friday" cannot silently land in 2019.
 *
 * Everything resolves in America/New_York, which every job in the export
 * carries and which has zero anomalies across the book.
 */
import { TZ } from "../config.js";

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** Hour a named part of the day starts, and how long the window runs. */
const PARTS: Record<string, { hour: number; minutes: number }> = {
  morning: { hour: 9, minutes: 120 },
  midday: { hour: 12, minutes: 120 },
  afternoon: { hour: 13, minutes: 180 },
  evening: { hour: 17, minutes: 120 },
  "first thing": { hour: 8, minutes: 120 },
};

export interface WhenInput {
  day?: string | null;
  timeOfDay?: string | null;
  hour24?: number | null;
}

export interface Resolved {
  startsAt: Date;
  durationMinutes: number;
  spoken: string;
}

/** Local wall-clock parts of `d` in the company's timezone. */
function localParts(d: Date): { y: number; m: number; day: number; weekday: number } {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short",
  });
  const parts = Object.fromEntries(f.formatToParts(d).map((p) => [p.type, p.value]));
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts["weekday"] ?? "Sun");
  return {
    y: Number(parts["year"]), m: Number(parts["month"]), day: Number(parts["day"]), weekday,
  };
}

/**
 * Builds a UTC instant for a local wall-clock time on a given local date.
 *
 * Two passes rather than one: guess the offset from the target date itself, so
 * a booking that crosses a daylight-saving boundary lands on the hour the
 * caller actually said rather than an hour either side of it.
 */
function atLocal(y: number, m: number, day: number, hour: number): Date {
  const guess = Date.UTC(y, m - 1, day, hour, 0, 0);
  const offset = (dt: number): number => {
    const s = new Intl.DateTimeFormat("en-US", {
      timeZone: TZ, timeZoneName: "longOffset", hour: "2-digit",
    }).formatToParts(new Date(dt)).find((p) => p.type === "timeZoneName")?.value ?? "GMT-05:00";
    const mm = /GMT([+-])(\d{2}):(\d{2})/.exec(s);
    if (!mm) return -5 * 60;
    return (mm[1] === "-" ? -1 : 1) * (Number(mm[2]) * 60 + Number(mm[3]));
  };
  const first = guess - offset(guess) * 60_000;
  return new Date(guess - offset(first) * 60_000);
}

/**
 * Resolves a loose description to an instant, always in the future.
 *
 * Defaults are deliberate: no day means tomorrow, not today, because 60.3% of
 * this company's work is booked same-day and a caller who wanted today would
 * have said so. No time means morning, which is the widest honest window.
 */
export function resolveWhen(input: WhenInput, now = new Date()): Resolved {
  const part = PARTS[(input.timeOfDay ?? "").toLowerCase().trim()] ?? PARTS["morning"]!;
  const hour = input.hour24 ?? part.hour;

  const today = localParts(now);
  const said = (input.day ?? "").toLowerCase().trim();

  let addDays = 1;
  if (said === "today" || said === "this afternoon" || said === "tonight") addDays = 0;
  else if (said === "tomorrow" || said === "") addDays = 1;
  else {
    const idx = DAYS.findIndex((d) => said.includes(d));
    if (idx >= 0) {
      addDays = (idx - today.weekday + 7) % 7;
      // "Friday" said on a Friday means the next one, not five minutes ago.
      if (addDays === 0) addDays = 7;
      if (said.includes("next") && addDays < 7) addDays += 7;
    }
  }

  const base = new Date(now.getTime() + addDays * 86_400_000);
  const p = localParts(base);
  let startsAt = atLocal(p.y, p.m, p.day, hour);
  if (startsAt.getTime() <= now.getTime()) {
    const next = localParts(new Date(startsAt.getTime() + 86_400_000));
    startsAt = atLocal(next.y, next.m, next.day, hour);
  }

  const spoken = startsAt.toLocaleString("en-US", {
    timeZone: TZ, weekday: "long", month: "long", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });
  return { startsAt, durationMinutes: part.minutes, spoken };
}
