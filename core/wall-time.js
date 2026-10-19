/**
 * core/wall-time.js: wall-clock helpers for any IANA time zone. The reference
 * build's London-only helpers with the zone as an argument, so a client in another zone
 * gets the same clock-change handling. Pure, no I/O.
 */

const formatters = new Map();

function partsFormatter(timeZone) {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** True when the zone name is one Intl knows. */
export function isValidTimeZone(timeZone) {
  try { partsFormatter(String(timeZone)); return true; } catch { return false; }
}

/** { date: 'YYYY-MM-DD', hour, minute, second } for an instant, read in the zone. */
export function zoneParts(at, timeZone) {
  const p = Object.fromEntries(partsFormatter(timeZone).formatToParts(new Date(at)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute), second: Number(p.second) };
}

/** Zone minus UTC, in milliseconds, at an instant. */
function zoneOffsetMs(ms, timeZone) {
  const p = zoneParts(ms, timeZone);
  const [y, m, d] = p.date.split('-').map(Number);
  const asUtc = Date.UTC(y, m - 1, d, p.hour, p.minute, p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/**
 * The UTC instant of a wall-clock time in the zone, e.g. ('2026-10-17',
 * '11:45', 'Europe/London'). Returns null when either part is unreadable.
 */
export function wallToDate(dateISO, time = '00:00', timeZone) {
  const dm = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateISO || ''));
  const tm = /^(\d{1,2}):(\d{2})/.exec(String(time || '00:00'));
  if (!dm || !tm) return null;
  const guess = Date.UTC(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]), Number(tm[1]), Number(tm[2]));
  let ms = guess - zoneOffsetMs(guess, timeZone);
  // A second pass settles instants either side of a clock change.
  ms = guess - zoneOffsetMs(ms, timeZone);
  return new Date(ms);
}

/** 'YYYY-MM-DD' shifted by whole days (calendar arithmetic, zone-free). */
export function dateAdd(dateISO, days) {
  const [y, m, d] = dateISO.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days, 12));
  return t.toISOString().slice(0, 10);
}

/** '2 hours 10 minutes', '45 minutes', '3 days'. */
export function formatDuration(ms) {
  const mins = Math.max(0, Math.round(ms / 60000));
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'}`;
  const hours = Math.floor(mins / 60);
  if (hours >= 48) return `${Math.floor(hours / 24)} days`;
  const rest = mins % 60;
  const h = `${hours} hour${hours === 1 ? '' : 's'}`;
  return rest ? `${h} ${rest} minute${rest === 1 ? '' : 's'}` : h;
}
