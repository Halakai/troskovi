// The balance check: what the app says should be on the accounts against what really is (no React, no network).
//
// Nothing about a difference is stored. Every check only knows the real total; what the app expected
// comes from the entries, so one that is added, corrected or deleted later also corrects the check.
import type { AppSettings, BalanceCheck, Recurring, Transaction } from '../types';
import { addDays, formatDayShort, formatRange, monthOf, parseISODate, toISODate } from './dates';

/** Up to this much the app and the accounts count as matching. */
export const TOLERANCE = 100;

/** What an entry does to the money on the accounts. */
export const effect = (t: Pick<Transaction, 'kind' | 'amount_cents'>) => (t.kind === 'income' ? t.amount_cents : -t.amount_cents);

const total = (txs: Transaction[]) => txs.reduce((s, t) => s + effect(t), 0);
const ms = (timestamp: string) => Date.parse(timestamp);

export interface BalanceInput {
  transactions: Transaction[];
  checks: BalanceCheck[];
  /** YYYY-MM-01: the app's balance starts from zero here (null = months aren't connected, so there is none) */
  carryFrom: string | null;
}

/** The time between two checks. */
export interface BalancePeriod {
  check: BalanceCheck;
  /** null = this is the first check, the starting point */
  prev: BalanceCheck | null;
  /** earlier checks that are counted as one with this one */
  joined: BalanceCheck[];
  /** what happened in between, newest first */
  entries: Transaction[];
  /** what the app expected on the accounts */
  expected: number;
  /** real − expected: what's still unexplained (negative = money is missing). Always 0 for the first check. */
  gap: number;
  /** first check only: money that was there before the app knew about it */
  start: number;
  /** already explained: entries found missing here, others that came in late, and written off */
  found: number;
  late: number;
  writtenOff: number;
  status: 'start' | 'matched' | 'settled' | 'written-off' | 'open';
}

function byTime(a: BalanceCheck, b: BalanceCheck): number {
  return (
    a.date.localeCompare(b.date) ||
    Number(a.whole_day) - Number(b.whole_day) ||
    ms(a.checked_at) - ms(b.checked_at) ||
    a.id.localeCompare(b.id)
  );
}

/** Did this entry happen before that check? `rank` = position of every check in time. */
function happenedBefore(t: Transaction, c: BalanceCheck, rank: Map<string, number>): boolean {
  const own = t.balance_check_id ? rank.get(t.balance_check_id) : undefined;
  if (own !== undefined) return own <= rank.get(c.id)!;
  if (t.date !== c.date) return t.date < c.date;
  // entries have no time of day: on the day of the check, what was already entered counts as before it
  return c.whole_day || ms(t.created_at) <= ms(c.checked_at);
}

/** Every period between checks, oldest first. */
export function balancePeriods({ transactions, checks, carryFrom }: BalanceInput): BalancePeriod[] {
  if (!carryFrom) return [];
  const sorted = checks.filter((c) => c.date >= carryFrom).sort(byTime);
  if (!sorted.length) return [];
  const rank = new Map(sorted.map((c, i) => [c.id, i]));
  // the newest check has none after it to be joined with
  const chain = sorted.filter((c, i) => !c.joined || i === sorted.length - 1);

  const entries: Transaction[][] = chain.map(() => []);
  for (const t of transactions) {
    if (t.date < carryFrom) continue;
    const i = chain.findIndex((c) => happenedBefore(t, c, rank));
    if (i >= 0) entries[i].push(t);
  }

  return chain.map((check, i): BalancePeriod => {
    const prev = i > 0 ? chain[i - 1] : null;
    const own = entries[i].sort((a, b) => b.date.localeCompare(a.date) || ms(b.created_at) - ms(a.created_at));
    const moved = total(own);
    const tagged = own.filter((t) => t.balance_check_id && rank.has(t.balance_check_id));
    const found = total(tagged.filter((t) => !t.write_off));
    const writtenOff = total(tagged.filter((t) => t.write_off));
    const late = total(own.filter((t) => !tagged.includes(t) && ms(t.created_at) > ms(check.checked_at)));
    const expected = prev ? prev.real_cents + check.adjust_cents + moved : moved;
    const gap = prev ? check.real_cents - expected : 0;
    const status = !prev
      ? 'start'
      : Math.abs(gap) > TOLERANCE
        ? 'open'
        : writtenOff
          ? 'written-off'
          : found || late
            ? 'settled'
            : 'matched';
    const from = prev ? rank.get(prev.id)! : -1;
    return {
      check,
      prev,
      joined: sorted.slice(from + 1, rank.get(check.id)!),
      entries: own,
      expected,
      gap,
      start: prev ? 0 : check.real_cents - expected,
      found,
      late,
      writtenOff,
      status,
    };
  });
}

/** "15 – 22 Nov" */
export function periodLabel(p: Pick<BalancePeriod, 'check' | 'prev'>): string {
  return p.prev ? formatRange(p.prev.date, p.check.date) : formatDayShort(p.check.date);
}

export const openPeriods = (periods: BalancePeriod[]) => periods.filter((p) => p.status === 'open');

/** The period a check belongs to (a joined check belongs to the one it was joined with). */
export function periodOf(periods: BalancePeriod[], checkId: string | null): BalancePeriod | undefined {
  return periods.find((p) => p.check.id === checkId || p.joined.some((c) => c.id === checkId));
}

// ---------------------------------------------------------------- effect on the months

/** What the checks add to (or take from) the money left in a month. */
export interface Corrections {
  /** the starting balance found by the first check */
  start: number;
  /** accounts that were added or removed */
  accounts: number;
  /** differences that still need an explanation */
  toSettle: number;
  /** differences too small to bother with */
  small: number;
}

export const NO_CORRECTIONS: Corrections = { start: 0, accounts: 0, toSettle: 0, small: 0 };

export const correctionTotal = (c: Corrections) => c.start + c.accounts + c.toSettle + c.small;

/** Month → corrections. With these, what's left always follows the real accounts. */
export function correctionsByMonth(periods: BalancePeriod[]): Map<string, Corrections> {
  const map = new Map<string, Corrections>();
  for (const p of periods) {
    const month = monthOf(p.check.date);
    const c = { ...(map.get(month) ?? NO_CORRECTIONS) };
    c.start += p.start;
    if (p.prev) c.accounts += p.check.adjust_cents;
    if (p.status === 'open') c.toSettle += p.gap;
    else c.small += p.gap;
    map.set(month, c);
  }
  return map;
}

// ---------------------------------------------------------------- differences that cancel out

/**
 * The neighbouring open period whose difference is the opposite of this one – typically
 * a payment the bank took a day later than the app (missing one week, too much the next).
 */
export function cancelsWith(periods: BalancePeriod[], p: BalancePeriod): BalancePeriod | null {
  const i = periods.indexOf(p);
  if (i < 0 || p.status !== 'open') return null;
  for (const step of [-1, 1]) {
    let j = i + step;
    while (periods[j] && periods[j].status !== 'open' && periods[j].status !== 'start') j += step;
    const q = periods[j];
    if (q?.status === 'open' && Math.abs(p.gap + q.gap) <= TOLERANCE) return q;
  }
  return null;
}

/** The checks to join so that the two periods count as one. */
export function checksToJoin(periods: BalancePeriod[], a: BalancePeriod, b: BalancePeriod): string[] {
  const [lo, hi] = [periods.indexOf(a), periods.indexOf(b)].sort((x, y) => x - y);
  return periods.slice(lo, hi).map((p) => p.check.id);
}

// ---------------------------------------------------------------- when is it due

/** The last time the weekly check became due. */
export function lastDue(now: Date, weekday: number, time: string): Date {
  const [h, m] = time.split(':').map(Number);
  const at = (daysBack: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysBack, h, m);
  const back = (now.getDay() - weekday + 7) % 7;
  return at(back) <= now ? at(back) : at(back + 7);
}

/** When the check that is waiting to be done became due; null = none is waiting. */
export function checkDue(checks: BalanceCheck[], settings: AppSettings, now: Date): Date | null {
  if (settings.check_weekday === null || !settings.carry_from) return null;
  const due = lastDue(now, settings.check_weekday, settings.check_time);
  const day = toISODate(due);
  const done = checks.some((c) => (c.whole_day ? c.date >= day : ms(c.checked_at) >= due.getTime()));
  const skipped = settings.check_skipped_at !== null && ms(settings.check_skipped_at) >= due.getTime();
  return done || skipped ? null : due;
}

// ---------------------------------------------------------------- what could it be?

export type Hint =
  /** entered after the check with exactly this amount – maybe it happened before */
  | { why: 'after'; tx: Transaction }
  /** dated in the future with exactly this amount – maybe it has already happened */
  | { why: 'planned'; tx: Transaction }
  /** a monthly item that isn't due yet – maybe it has already happened */
  | { why: 'monthly'; item: Recurring; date: string }
  /** there's another one just like it */
  | { why: 'duplicate'; tx: Transaction }
  /** exactly this amount – maybe it hasn't really happened */
  | { why: 'unpaid'; tx: Transaction }
  /** an expense that should be an income, or the other way round */
  | { why: 'wrong-side'; tx: Transaction }
  /** a typo: swapped digits or a misplaced decimal point would explain it */
  | { why: 'typo'; tx: Transaction; amount: number };

/** 1254 ↔ 1245: the same digits with two neighbours swapped */
export function digitsSwapped(a: number, b: number): boolean {
  const x = String(a);
  const y = String(b);
  if (x.length !== y.length || a === b) return false;
  const i = [...x].findIndex((ch, k) => ch !== y[k]);
  return x[i] === y[i + 1] && x[i + 1] === y[i] && x.slice(i + 2) === y.slice(i + 2);
}

const isTypo = (a: number, b: number) => digitsSwapped(a, b) || [10, 100].some((f) => a === b * f || b === a * f);

/** Single entries that would explain a period's whole difference, the most likely ones first. */
export function gapHints(
  p: BalancePeriod,
  all: Transaction[],
  upcoming: { item: Recurring; date: string }[],
  today: string,
): Hint[] {
  const g = p.gap;
  if (p.status !== 'open') return [];
  const hints: Hint[] = [];
  const inPeriod = new Set(p.entries.map((t) => t.id));

  const soon = addDays(p.check.date, 7);
  for (const t of all) {
    if (inPeriod.has(t.id) || t.balance_check_id || t.write_off || effect(t) !== g) continue;
    if (t.date > today) hints.push({ why: 'planned', tx: t });
    else if (t.date >= p.check.date && t.date <= soon) hints.push({ why: 'after', tx: t });
  }
  for (const u of upcoming) {
    const e = u.item.kind === 'income' ? u.item.amount_cents : -u.item.amount_cents;
    if (e === g) hints.push({ why: 'monthly', item: u.item, date: u.date });
  }

  const days = (t: Transaction) => parseISODate(t.date).getTime() / 86400000;
  const own = p.entries.filter((t) => !t.balance_check_id && !t.write_off);
  const twins = new Set<string>(); // both halves of a pair would be listed otherwise
  for (const t of own) {
    const e = effect(t);
    if (e === -g) {
      const twin = own.find(
        (u) => u.id !== t.id && u.kind === t.kind && u.amount_cents === t.amount_cents && Math.abs(days(u) - days(t)) <= 3,
      );
      if (!twin) hints.push({ why: 'unpaid', tx: t });
      else if (!twins.has(twin.id)) {
        twins.add(t.id);
        hints.push({ why: 'duplicate', tx: t });
      }
      continue;
    }
    if (t.kind !== 'saving' && 2 * e === -g) hints.push({ why: 'wrong-side', tx: t });
    // which amount would have made it right?
    const amount = t.amount_cents + (e < 0 ? -g : g);
    if (t.kind !== 'saving' && amount > 0 && isTypo(amount, t.amount_cents)) hints.push({ why: 'typo', tx: t, amount });
  }

  const order: Hint['why'][] = ['after', 'duplicate', 'planned', 'monthly', 'typo', 'wrong-side', 'unpaid'];
  return hints.sort((a, b) => order.indexOf(a.why) - order.indexOf(b.why)).slice(0, 5);
}
