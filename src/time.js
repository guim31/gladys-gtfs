// -----------------------------------------------------------------------------
// GTFS time arithmetic, in the time zone of the agency (Europe/Paris for
// most French networks), whatever the TZ of the container.
//
// A GTFS service day is a date (YYYYMMDD) and its stop times count seconds
// from "noon minus 12 hours" of that date, which is midnight except on the two
// DST change days. Times past 24:00:00 belong to the same service day (a night
// bus at 25:10:00 leaves at 01:10 the next calendar day).
// -----------------------------------------------------------------------------

const formatters = new Map();

function formatter(timeZone) {
  let format = formatters.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, format);
  }
  return format;
}

function parts(epochMs, timeZone) {
  const values = {};
  for (const part of formatter(timeZone).formatToParts(new Date(epochMs))) {
    values[part.type] = part.value;
  }
  return values;
}

/** Offset of `timeZone` from UTC at an instant, in milliseconds. */
export function zoneOffsetMs(epochMs, timeZone) {
  const p = parts(epochMs, timeZone);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - Math.floor(epochMs / 1000) * 1000;
}

/** The local date of an instant, as a GTFS date string (YYYYMMDD). */
export function localDate(epochMs, timeZone) {
  const p = parts(epochMs, timeZone);
  return `${p.year}${p.month}${p.day}`;
}

/** The local time of an instant, "HH:MM". */
export function localTime(epochMs, timeZone) {
  const p = parts(epochMs, timeZone);
  return `${p.hour}:${p.minute}`;
}

/** YYYYMMDD shifted by `days` (calendar arithmetic, no time zone involved). */
export function addDays(date, days) {
  const d = new Date(Date.UTC(+date.slice(0, 4), +date.slice(4, 6) - 1, +date.slice(6, 8) + days));
  return d.toISOString().slice(0, 10).replaceAll('-', '');
}

/** Day of the week of a YYYYMMDD date, 0 = Monday ... 6 = Sunday (calendar.txt order). */
export function weekday(date) {
  const d = new Date(Date.UTC(+date.slice(0, 4), +date.slice(4, 6) - 1, +date.slice(6, 8)));
  return (d.getUTCDay() + 6) % 7;
}

const dayStarts = new Map();

/** The instant GTFS times of a service day count from: noon minus 12 h, local time. */
export function serviceDayStart(date, timeZone) {
  const key = `${timeZone}|${date}`;
  let start = dayStarts.get(key);
  if (start === undefined) {
    const noonUtc = Date.UTC(+date.slice(0, 4), +date.slice(4, 6) - 1, +date.slice(6, 8), 12);
    // The offset at local noon is the offset of the whole service day's anchor.
    const noon = noonUtc - zoneOffsetMs(noonUtc, timeZone);
    start = noon - 12 * 3600 * 1000;
    if (dayStarts.size > 64) {
      dayStarts.clear();
    }
    dayStarts.set(key, start);
  }
  return start;
}

/** "25:10:00" → 90600 seconds; null when malformed. */
export function parseGtfsTime(text) {
  const match = /^\s*(\d{1,3}):(\d{2}):(\d{2})\s*$/.exec(text ?? '');
  if (!match) {
    return null;
  }
  return +match[1] * 3600 + +match[2] * 60 + +match[3];
}
