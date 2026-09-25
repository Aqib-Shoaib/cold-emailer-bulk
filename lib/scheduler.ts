interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function partsAt(date: Date, timeZone: string): LocalParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return { year: value("year"), month: value("month"), day: value("day"), hour: value("hour"), minute: value("minute") };
}

export function zonedDateTimeToUtc(value: string, timeZone: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const target: LocalParts = {
    year: Number(match[1]), month: Number(match[2]), day: Number(match[3]),
    hour: Number(match[4]), minute: Number(match[5]),
  };
  if (target.month < 1 || target.month > 12 || target.day < 1 || target.day > 31 || target.hour > 23 || target.minute > 59) return null;
  let result = new Date(Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute));
  try {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const actual = partsAt(result, timeZone);
      const targetStamp = Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute);
      const actualStamp = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute);
      result = new Date(result.getTime() + targetStamp - actualStamp);
    }
    const final = partsAt(result, timeZone);
    return Object.keys(target).every((key) => target[key as keyof LocalParts] === final[key as keyof LocalParts]) ? result : null;
  } catch {
    return null;
  }
}

function localValue(parts: LocalParts) {
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}T${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

export function startOfZonedDay(date: Date, timeZone: string) {
  const local = partsAt(date, timeZone);
  return zonedDateTimeToUtc(localValue({ ...local, hour: 0, minute: 0 }), timeZone) as Date;
}

export function nextZonedDay(date: Date, timeZone: string) {
  const local = partsAt(date, timeZone);
  const next = new Date(Date.UTC(local.year, local.month - 1, local.day + 1));
  return zonedDateTimeToUtc(`${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}T00:00`, timeZone) as Date;
}

function weekday(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(date).toLowerCase();
}

function quietMinutes(value: string) {
  const match = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  return { start: Number(match[1]) * 60 + Number(match[2]), end: Number(match[3]) * 60 + Number(match[4]) };
}

export function nextAllowedSendAt(now: Date, timeZone: string, quietDays: string, quietHours: string) {
  const days = new Set(quietDays.split(",").map((day) => day.trim().slice(0, 3).toLowerCase()).filter(Boolean));
  let candidate = now;
  for (let attempt = 0; attempt < 9; attempt += 1) {
    if (days.has(weekday(candidate, timeZone))) {
      candidate = nextZonedDay(candidate, timeZone);
      continue;
    }
    const range = quietMinutes(quietHours);
    if (!range || range.start === range.end) return candidate;
    const local = partsAt(candidate, timeZone);
    const minute = local.hour * 60 + local.minute;
    const quiet = range.start < range.end
      ? minute >= range.start && minute < range.end
      : minute >= range.start || minute < range.end;
    if (!quiet) return candidate;
    const dayOffset = range.start > range.end && minute >= range.start ? 1 : 0;
    const day = new Date(Date.UTC(local.year, local.month - 1, local.day + dayOffset));
    candidate = zonedDateTimeToUtc(`${day.getUTCFullYear()}-${String(day.getUTCMonth() + 1).padStart(2, "0")}-${String(day.getUTCDate()).padStart(2, "0")}T${String(Math.floor(range.end / 60)).padStart(2, "0")}:${String(range.end % 60).padStart(2, "0")}`, timeZone) as Date;
  }
  return candidate;
}

export function estimateSendMinutes(messages: number, limits: {
  batchMin: number; batchMax: number; intervalMin: number; intervalMax: number;
  perMinute: number; perHour: number; globalDaily: number; campaignDaily: number;
}) {
  if (messages <= 1) return 0;
  const batch = Math.max(1, Math.floor((limits.batchMin + limits.batchMax) / 2));
  const interval = (limits.intervalMin + limits.intervalMax) / 2;
  return Math.ceil(Math.max(
    (Math.ceil(messages / batch) - 1) * interval,
    (Math.ceil(messages / limits.perMinute) - 1),
    (Math.ceil(messages / limits.perHour) - 1) * 60,
    (Math.ceil(messages / Math.min(limits.globalDaily, limits.campaignDaily)) - 1) * 1_440,
  ));
}
