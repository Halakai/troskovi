import { describe, expect, it } from 'vitest';
import type { AppSettings, BalanceCheck, Recurring, Transaction } from '../types';
import {
  balancePeriods,
  cancelsWith,
  checkDue,
  checksToJoin,
  correctionsByMonth,
  correctionTotal,
  digitsSwapped,
  gapHints,
  lastDue,
  openPeriods,
  periodLabel,
  periodOf,
} from './balance';

let n = 0;
const tx = (date: string, cents: number, extra: Partial<Transaction> = {}): Transaction => ({
  id: `t${++n}`,
  kind: 'expense',
  amount_cents: cents,
  category_id: 'food',
  savings_account_id: null,
  person_id: 'david',
  date,
  note: null,
  recurring_id: null,
  balance_check_id: null,
  write_off: false,
  created_by: 'david',
  created_at: `${date}T10:00:00Z`,
  updated_at: `${date}T10:00:00Z`,
  ...extra,
});
const income = (date: string, cents: number, extra: Partial<Transaction> = {}) => tx(date, cents, { kind: 'income', ...extra });
const saving = (date: string, cents: number) => tx(date, cents, { kind: 'saving', category_id: null, savings_account_id: 'pot' });

const check = (id: string, date: string, real: number, extra: Partial<BalanceCheck> = {}): BalanceCheck => ({
  id,
  date,
  whole_day: false,
  checked_at: `${date}T14:00:00Z`,
  real_cents: real,
  adjust_cents: 0,
  joined: false,
  created_by: 'david',
  created_at: `${date}T14:00:00Z`,
  ...extra,
});

const run = (transactions: Transaction[], checks: BalanceCheck[], carryFrom: string | null = '2026-10-01') =>
  balancePeriods({ transactions, checks, carryFrom });

describe('balancePeriods', () => {
  const base = [income('2026-10-01', 300000), tx('2026-10-10', 100000), saving('2026-10-20', 20000), saving('2026-10-25', -5000)];
  const start = check('c1', '2026-11-01', 250000);

  it('the first check only sets the starting balance', () => {
    const [p] = run(base, [start]);
    expect(p).toMatchObject({ prev: null, expected: 185000, start: 65000, gap: 0, status: 'start' });
  });

  it('compares with the real balance of the check before, not with the app from the beginning', () => {
    const [, p] = run([...base, tx('2026-11-03', 4000), income('2026-11-05', 10000)], [start, check('c2', '2026-11-08', 256000)]);
    expect(p).toMatchObject({ expected: 256000, gap: 0, status: 'matched' });
    expect(periodLabel(p)).toBe('1 – 8 Nov');
  });

  it('shows what is missing, week by week', () => {
    const periods = run(base, [start, check('c2', '2026-11-08', 245680), check('c3', '2026-11-15', 244480)]);
    expect(periods.map((p) => p.gap)).toEqual([0, -4320, -1200]);
    expect(openPeriods(periods).map((p) => p.check.id)).toEqual(['c2', 'c3']);
  });

  it('a couple of cents are not worth looking for', () => {
    const [, p] = run(base, [start, check('c2', '2026-11-08', 249950)]);
    expect(p).toMatchObject({ gap: -50, status: 'matched' });
  });

  it('a late entry with the right date corrects its own week and no other', () => {
    const checks = [start, check('c2', '2026-11-08', 245680), check('c3', '2026-11-15', 245680)];
    const late = tx('2026-11-04', 4320, { created_at: '2026-11-17T09:00:00Z' });
    const periods = run([...base, late], checks);
    expect(periods.map((p) => p.gap)).toEqual([0, 0, 0]);
    expect(periods[1]).toMatchObject({ status: 'settled', late: -4320, found: 0 });
    expect(periods[2].status).toBe('matched');
  });

  it('an entry found missing belongs to its check even when it was dated or typed in later', () => {
    const checks = [start, check('c2', '2026-11-08', 245680), check('c3', '2026-11-15', 245680)];
    const found = tx('2026-11-08', 3000, { created_at: '2026-11-09T09:00:00Z', balance_check_id: 'c2' });
    const off = tx('2026-11-08', 1320, { created_at: '2026-11-09T09:05:00Z', balance_check_id: 'c2', write_off: true });
    expect(run([...base, found], checks).map((p) => p.gap)).toEqual([0, -1320, 0]);
    const periods = run([...base, found, off], checks);
    expect(periods.map((p) => p.gap)).toEqual([0, 0, 0]);
    expect(periods[1]).toMatchObject({ found: -3000, writtenOff: -1320, status: 'written-off' });
  });

  it('on the day of the check, what was entered before it counts as before it', () => {
    const checks = [start, check('c2', '2026-11-08', 250000), check('c3', '2026-11-15', 248000)];
    const morning = tx('2026-11-08', 0, { amount_cents: 500, created_at: '2026-11-08T09:00:00Z' });
    const evening = tx('2026-11-08', 2000, { created_at: '2026-11-08T20:00:00Z' });
    const periods = run([...base, morning, evening], checks);
    expect(periods.map((p) => p.entries.length)).toEqual([4, 1, 1]);
    expect(periods.map((p) => p.gap)).toEqual([0, 500, 0]);
  });

  it('a check for the end of a past day includes that whole day, and can become the new starting point', () => {
    const past = check('p', '2026-10-31', 185000, { whole_day: true, checked_at: '2026-11-24T18:00:00Z' });
    const periods = run([...base, tx('2026-10-31', 1000, { created_at: '2026-10-31T23:00:00Z' })], [start, past]);
    expect(periods.map((p) => [p.check.id, p.status])).toEqual([
      ['p', 'start'],
      ['c1', 'open'],
    ]);
    expect(periods[0].entries).toHaveLength(5);
    expect(periods[1].gap).toBe(65000);
  });

  it('an account that was added or removed is not a difference', () => {
    const [, p] = run(base, [start, check('c2', '2026-11-08', 265000, { adjust_cents: 15000 })]);
    expect(p).toMatchObject({ gap: 0, status: 'matched' });
  });

  it('joined checks count as one with the next', () => {
    const checks = [start, check('c2', '2026-11-08', 300000, { joined: true }), check('c3', '2026-11-15', 250000)];
    const periods = run(base, checks);
    expect(periods.map((p) => [p.check.id, p.gap])).toEqual([
      ['c1', 0],
      ['c3', 0],
    ]);
    expect(periods[1].joined.map((c) => c.id)).toEqual(['c2']);
    expect(periodOf(periods, 'c2')?.check.id).toBe('c3');
    // the newest one has nothing to be joined with
    expect(run(base, [start, check('c2', '2026-11-08', 300000, { joined: true })]).map((p) => p.gap)).toEqual([0, 50000]);
  });

  it('a tagged entry of a joined check counts in the joined period', () => {
    const checks = [start, check('c2', '2026-11-08', 300000, { joined: true }), check('c3', '2026-11-15', 249000)];
    const t = tx('2026-11-08', 1000, { created_at: '2026-11-20T10:00:00Z', balance_check_id: 'c2' });
    expect(run([...base, t], checks)[1].gap).toBe(0);
  });

  it('needs months that are connected, and ignores checks and entries from before that', () => {
    expect(run(base, [start], null)).toEqual([]);
    const periods = run([income('2026-09-01', 999999), ...base], [check('old', '2026-09-20', 1), start]);
    expect(periods).toHaveLength(1);
    expect(periods[0].start).toBe(65000);
  });

  it('planned entries never count', () => {
    const [, p] = run([...base, tx('2026-11-30', 7000)], [start, check('c2', '2026-11-08', 250000)]);
    expect(p.gap).toBe(0);
  });
});

describe('corrections', () => {
  it('make every month follow the real accounts', () => {
    const entries = [income('2026-10-01', 300000), tx('2026-10-10', 100000)];
    const checks = [
      check('c1', '2026-10-25', 250000),
      check('c2', '2026-11-01', 245680),
      check('c3', '2026-11-08', 260700, { adjust_cents: 15000 }),
    ];
    const map = correctionsByMonth(run(entries, checks));
    expect(map.get('2026-10')).toEqual({ start: 50000, accounts: 0, toSettle: 0, small: 0 });
    expect(map.get('2026-11')).toEqual({ start: 0, accounts: 15000, toSettle: -4320, small: 20 });
    const sum = [...map.values()].reduce((s, c) => s + correctionTotal(c), 0);
    expect(300000 - 100000 + sum).toBe(260700); // the last real balance
  });
});

describe('differences that cancel out', () => {
  // the loan is booked on the 8th, the bank takes it on the 9th
  const entries = [income('2026-10-01', 300000), tx('2026-11-08', 50000, { recurring_id: 'loan' })];
  const checks = [check('c1', '2026-11-01', 300000), check('c2', '2026-11-08', 300000), check('c3', '2026-11-15', 250000)];

  it('are found and can be joined', () => {
    const periods = run(entries, checks);
    expect(periods.map((p) => p.gap)).toEqual([0, 50000, -50000]);
    expect(cancelsWith(periods, periods[1])).toBe(periods[2]);
    expect(cancelsWith(periods, periods[2])).toBe(periods[1]);
    const ids = checksToJoin(periods, periods[2], periods[1]);
    expect(ids).toEqual(['c2']);
    const joined = run(entries, checks.map((c) => ({ ...c, joined: ids.includes(c.id) })));
    expect(joined.map((p) => p.gap)).toEqual([0, 0]);
  });

  it('also with matching weeks in between, but not across another open one', () => {
    const far = run(entries, [...checks.slice(0, 2), check('m', '2026-11-08', 300000, { checked_at: '2026-11-08T18:00:00Z' }), checks[2]]);
    expect(cancelsWith(far, far[1])).toBe(far[3]);
    expect(checksToJoin(far, far[1], far[3])).toEqual(['c2', 'm']);
    const blocked = run(entries, [
      ...checks.slice(0, 2),
      check('m', '2026-11-08', 299000, { checked_at: '2026-11-08T18:00:00Z' }),
      check('c3', '2026-11-15', 249000),
    ]);
    expect(blocked.map((p) => p.gap)).toEqual([0, 50000, -1000, -50000]);
    expect(cancelsWith(blocked, blocked[1])).toBeNull();
  });
});

describe('when the check is due', () => {
  const settings: AppSettings = { carry_from: '2026-10-01', check_weekday: 0, check_time: '14:00', check_skipped_at: null };
  const local = (y: number, m: number, d: number, h: number, min = 0) => new Date(y, m - 1, d, h, min);

  it('goes back to the last Sunday 14:00', () => {
    expect(lastDue(local(2026, 11, 22, 14), 0, '14:00')).toEqual(local(2026, 11, 22, 14));
    expect(lastDue(local(2026, 11, 22, 13, 59), 0, '14:00')).toEqual(local(2026, 11, 15, 14));
    expect(lastDue(local(2026, 11, 24, 9), 0, '14:00')).toEqual(local(2026, 11, 22, 14));
    expect(lastDue(local(2026, 11, 28, 23), 0, '14:00')).toEqual(local(2026, 11, 22, 14));
    expect(lastDue(local(2026, 11, 24, 9), 5, '20:30')).toEqual(local(2026, 11, 20, 20, 30));
  });

  it('stays due until it is done or skipped', () => {
    const now = local(2026, 11, 24, 9);
    const due = local(2026, 11, 22, 14);
    const at = (d: Date, extra: Partial<BalanceCheck> = {}) => check('c', '2026-11-22', 0, { checked_at: d.toISOString(), ...extra });
    expect(checkDue([], settings, now)).toEqual(due);
    expect(checkDue([at(local(2026, 11, 22, 11))], settings, now)).toEqual(due); // done before it was due
    expect(checkDue([at(local(2026, 11, 22, 14, 5))], settings, now)).toBeNull();
    expect(checkDue([], { ...settings, check_skipped_at: local(2026, 11, 23, 8).toISOString() }, now)).toBeNull();
    expect(checkDue([], { ...settings, check_skipped_at: local(2026, 11, 16, 8).toISOString() }, now)).toEqual(due);
  });

  it('a check typed in for that Sunday counts, one for an earlier day does not', () => {
    const now = local(2026, 11, 24, 9);
    expect(checkDue([check('c', '2026-11-22', 0, { whole_day: true })], settings, now)).toBeNull();
    expect(checkDue([check('c', '2026-10-31', 0, { whole_day: true, checked_at: now.toISOString() })], settings, now)).not.toBeNull();
  });

  it('is never due when switched off or when months are not connected', () => {
    const now = local(2026, 11, 24, 9);
    expect(checkDue([], { ...settings, check_weekday: null }, now)).toBeNull();
    expect(checkDue([], { ...settings, carry_from: null }, now)).toBeNull();
  });
});

describe('what could it be?', () => {
  const start = check('c1', '2026-11-01', 100000);
  const hintsFor = (entries: Transaction[], real: number, upcoming: { item: Recurring; date: string }[] = []) => {
    const all = [income('2026-10-01', 100000), ...entries];
    const periods = run(all, [start, check('c2', '2026-11-08', real)]);
    return gapHints(periods[1], all, upcoming, '2026-11-10');
  };
  const whys = (...args: Parameters<typeof hintsFor>) => hintsFor(...args).map((h) => h.why);

  it('nothing when it matches', () => expect(hintsFor([tx('2026-11-03', 500)], 99500)).toEqual([]));
  it('entered after the check', () => expect(whys([tx('2026-11-09', 4320)], 95680)).toEqual(['after']));
  it('planned but already paid', () => expect(whys([tx('2026-11-27', 4320)], 95680)).toEqual(['planned']));
  it('a monthly item that was early', () => {
    const item = { kind: 'income', amount_cents: 150000 } as Recurring;
    expect(whys([], 250000, [{ item, date: '2026-11-15' }])).toEqual(['monthly']);
  });
  it('entered twice (listed once)', () => {
    expect(whys([tx('2026-11-03', 2500), tx('2026-11-04', 2500, { created_by: 'tena' })], 97500)).toEqual(['duplicate']);
  });
  it('not paid yet', () => expect(whys([tx('2026-11-05', 50000, { recurring_id: 'loan' })], 100000)).toEqual(['unpaid']));
  it('income entered as an expense', () => expect(whys([tx('2026-11-03', 2000)], 102000)).toEqual(['wrong-side']));
  it('typos', () => {
    expect(hintsFor([tx('2026-11-03', 1200)], 97900)).toMatchObject([{ why: 'typo', amount: 2100 }]);
    expect(hintsFor([tx('2026-11-03', 1250)], 87500)).toMatchObject([{ why: 'typo', amount: 12500 }]);
    expect(hintsFor([income('2026-11-03', 185000)], 258000)).toMatchObject([{ why: 'typo', amount: 158000 }]);
  });
  it('swapped digits', () => {
    expect(digitsSwapped(1254, 1245)).toBe(true);
    expect(digitsSwapped(1254, 4251)).toBe(false);
    expect(digitsSwapped(1254, 1254)).toBe(false);
    expect(digitsSwapped(1234, 2143)).toBe(false);
  });
});
