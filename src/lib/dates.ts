// Dates are kept as local "YYYY-MM-DD" strings and months as "YYYY-MM" keys,
// so nothing ever shifts because of time zones.

const pad = (n: number) => String(n).padStart(2, '0');

export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayISO(): string {
  return toISODate(new Date());
}

export function currentMonth(): string {
  return todayISO().slice(0, 7);
}

export function monthOf(isoDate: string): string {
  return isoDate.slice(0, 7);
}

export function yearOf(isoDateOrMonth: string): number {
  return Number(isoDateOrMonth.slice(0, 4));
}

/** "2026-10" → "2026-10-01" */
export function monthStart(month: string): string {
  return `${month}-01`;
}

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

export function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Date a recurring item falls on in a month (day 31 → last day of short months). */
export function recurringDate(month: string, dayOfMonth: number): string {
  return `${month}-${pad(Math.min(dayOfMonth, daysInMonth(month)))}`;
}

export function monthsOfYear(year: number): string[] {
  return Array.from({ length: 12 }, (_, i) => `${year}-${pad(i + 1)}`);
}

const monthFmt = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' });
const monthShortFmt = new Intl.DateTimeFormat('en-GB', { month: 'short' });
const dayFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const dayLongFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

/** "2026-10" → "October 2026" */
export function formatMonth(month: string): string {
  return monthFmt.format(parseISODate(monthStart(month)));
}

/** "2026-10" → "Oct" */
export function formatMonthShort(month: string): string {
  return monthShortFmt.format(parseISODate(monthStart(month)));
}

/** "2026-10-01" → "Thu, 1 Oct" */
export function formatDay(iso: string): string {
  return dayFmt.format(parseISODate(iso));
}

/** "2026-10-01" → "Today" / "Yesterday" / "Thursday, 1 October" */
export function formatDayHeading(iso: string): string {
  const today = todayISO();
  if (iso === today) return 'Today';
  const y = new Date();
  y.setDate(y.getDate() - 1);
  if (iso === toISODate(y)) return 'Yesterday';
  return dayLongFmt.format(parseISODate(iso));
}

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
