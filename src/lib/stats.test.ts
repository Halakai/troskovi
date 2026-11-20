import { describe, expect, it } from 'vitest';
import type { Category, CategoryKind, CategoryLimit, Profile, Recurring, SavingsAccount, Transaction } from '../types';
import { carriedInto, limitFor, monthReport, savingsReport, upcomingRecurring, yearReport, type ReportInput } from './stats';

const profile = (id: string, name: string, created: string): Profile => ({
  id,
  username: name.toLowerCase(),
  display_name: name,
  is_admin: id === 'david',
  active: true,
  color: '#000',
  created_at: created,
});

const category = (id: string, kind: CategoryKind = 'expense', system = false, parent: string | null = null): Category => ({
  id,
  name: id,
  emoji: '🏷️',
  color: '#000',
  kind,
  owner_id: null,
  parent_id: parent,
  default_shared: false,
  is_system: system,
  sort_order: 1,
  created_by: null,
  created_at: '2026-01-01',
});

const account = (id: string, extra: Partial<SavingsAccount> = {}): SavingsAccount => ({
  id,
  name: id,
  emoji: '🐷',
  color: '#000',
  owner_id: null,
  goal_cents: null,
  initial_cents: 0,
  archived: false,
  sort_order: 1,
  created_by: null,
  created_at: '2026-01-01',
  ...extra,
});

let n = 0;
const tx = (date: string, cents: number, person: string | null, cat = 'food', extra: Partial<Transaction> = {}): Transaction => ({
  id: `t${++n}`,
  kind: 'expense',
  amount_cents: cents,
  category_id: cat,
  savings_account_id: null,
  person_id: person,
  date,
  note: null,
  recurring_id: null,
  created_by: person ?? 'david',
  created_at: `${date}T10:00:00Z`,
  updated_at: `${date}T10:00:00Z`,
  ...extra,
});
const income = (date: string, cents: number, person: string | null, cat: string | null = 'salary') =>
  tx(date, cents, person, cat as string, { kind: 'income', category_id: cat });
const saving = (date: string, cents: number, person: string | null, acc: string) =>
  tx(date, cents, person, '', { kind: 'saving', category_id: null, savings_account_id: acc });

const recurring = (r: Partial<Recurring>): Recurring => ({
  id: 'r1',
  kind: 'expense',
  name: 'Rent',
  amount_cents: 50000,
  category_id: 'rent',
  savings_account_id: null,
  person_id: null,
  day_of_month: 5,
  start_month: '2026-01-01',
  end_month: null,
  posted_through: null,
  active: true,
  created_by: 'david',
  created_at: '2026-01-01',
  ...r,
});

const profiles = [profile('david', 'David', '2026-01-01'), profile('ana', 'Ana', '2026-01-02')];
const categories = [
  category('food'),
  category('rent'),
  category('other', 'expense', true),
  category('salary', 'income'),
  category('bonus', 'income'),
  category('other-income', 'income', true),
];
const input = (over: Partial<ReportInput>): ReportInput => ({
  transactions: [],
  categories,
  limits: [],
  savingsAccounts: [],
  recurring: [],
  profiles,
  carryFrom: null,
  today: '2026-10-04',
  ...over,
});

describe('limitFor', () => {
  const limits: CategoryLimit[] = [
    { category_id: 'food', effective_from: '2026-01-01', amount_cents: 30000 },
    { category_id: 'food', effective_from: '2026-06-01', amount_cents: 40000 },
    { category_id: 'food', effective_from: '2026-09-01', amount_cents: null },
  ];
  it('uses the latest limit that started on or before the month', () => {
    expect(limitFor(limits, 'food', '2025-12')).toBeNull();
    expect(limitFor(limits, 'food', '2026-03')).toBe(30000);
    expect(limitFor(limits, 'food', '2026-06')).toBe(40000);
    expect(limitFor(limits, 'food', '2026-10')).toBeNull();
  });
});

describe('upcomingRecurring', () => {
  it('lists unposted items in the current and future months only', () => {
    const r = recurring({ posted_through: '2026-09-01' });
    expect(upcomingRecurring([r], '2026-09', '2026-10-01')).toEqual([]);
    expect(upcomingRecurring([r], '2026-10', '2026-10-01')).toEqual([{ item: r, date: '2026-10-05' }]);
    expect(upcomingRecurring([recurring({ posted_through: '2026-10-01' })], '2026-10', '2026-10-06')).toEqual([]);
  });
  it('clamps day 31 to the end of short months', () => {
    const r = recurring({ day_of_month: 31 });
    expect(upcomingRecurring([r], '2027-02', '2026-10-01')[0].date).toBe('2027-02-28');
  });
});

describe('monthReport', () => {
  const report = monthReport(
    input({
      transactions: [
        tx('2026-10-01', 2000, 'david'),
        tx('2026-10-02', 1000, 'ana'),
        tx('2026-10-02', 50000, null, 'rent', { recurring_id: 'r1' }),
        tx('2026-10-03', 500, 'ana', 'deleted-category'),
        income('2026-10-03', 300000, 'david'),
        income('2026-10-03', 4000, 'ana', null),
        tx('2026-09-15', 10000, 'david'),
      ],
      limits: [{ category_id: 'food', effective_from: '2026-01-01', amount_cents: 5000 }],
      recurring: [
        recurring({ kind: 'income', name: 'Ana salary', amount_cents: 150000, category_id: 'salary', person_id: 'ana', day_of_month: 15, posted_through: '2026-09-01' }),
      ],
    }),
    '2026-10',
  );

  it('totals spending and income', () => {
    expect(report.spent).toBe(53500);
    expect(report.income).toBe(304000);
    expect(report.previousSpent).toBe(10000);
  });

  it('splits by person and shares common costs equally', () => {
    const david = report.people.find((p) => p.id === 'david')!;
    const ana = report.people.find((p) => p.id === 'ana')!;
    const shared = report.people.find((p) => p.id === null)!;
    expect([david.spent, ana.spent, shared.spent]).toEqual([2000, 1500, 50000]);
    expect(david.fairShare).toBe(27000);
    expect(ana.fairShare).toBe(26500);
  });

  it('groups unknown categories under Other and applies limits', () => {
    const food = report.categories.find((c) => c.category.id === 'food')!;
    expect(food).toMatchObject({ spent: 3000, limit: 5000, count: 2 });
    expect(report.categories.find((c) => c.category.id === 'other')?.spent).toBe(500);
    expect(report.budget).toEqual({ limit: 5000, spent: 3000 });
  });

  it('keeps income categories in their own list (uncategorised income → Other income)', () => {
    expect(report.categories.every((c) => c.category.kind === 'expense')).toBe(true);
    expect(report.incomeCategories.map((c) => [c.category.id, c.spent])).toEqual([
      ['salary', 300000],
      ['other-income', 4000],
    ]);
  });

  it("counts a salary that hasn't arrived yet as expected income", () => {
    expect(report.expectedIncome).toBe(150000);
    expect(report.leftToSpend).toBe(304000 + 150000 - 53500);
  });

  it('computes fun stats from everyday (non-recurring) spending', () => {
    expect(report.daysElapsed).toBe(4);
    expect(report.dailyAverage).toBe(Math.round(3500 / 4));
    expect(report.noSpendDays).toBe(1);
    expect(report.biggest?.amount_cents).toBe(2000);
    expect(report.projected).toBe(50000 + Math.round((3500 / 4) * 31));
  });
});

describe('savings in reports', () => {
  const accounts = [account('vacation', { initial_cents: 100000, goal_cents: 300000 }), account('emergency')];
  const transactions = [
    tx('2026-10-01', 2000, 'david'),
    income('2026-10-01', 200000, 'david'),
    saving('2026-10-02', 20000, 'ana', 'vacation'),
    saving('2026-10-03', 5000, 'david', 'emergency'),
    saving('2026-10-03', -3000, 'david', 'vacation'),
    saving('2026-09-10', 15000, 'ana', 'vacation'),
    saving('2025-12-10', 7000, null, 'emergency'),
  ];
  const data = input({
    transactions,
    savingsAccounts: accounts,
    recurring: [recurring({ kind: 'saving', name: 'Monthly', amount_cents: 10000, category_id: null, savings_account_id: 'emergency', day_of_month: 20, posted_through: '2026-09-01' })],
  });

  it('savings are not spending, but they reduce what is left', () => {
    const m = monthReport(data, '2026-10');
    expect(m.spent).toBe(2000);
    expect(m.saved).toBe(22000);
    expect(m.upcomingSavings).toBe(10000);
    expect(m.leftToSpend).toBe(200000 - 2000 - 22000 - 10000);
    expect(m.savings.map((s) => [s.account.id, s.net])).toEqual([
      ['vacation', 17000],
      ['emergency', 5000],
    ]);
    expect(m.people.find((p) => p.id === 'ana')?.saved).toBe(20000);
  });

  it('balances include the starting amount and every movement ever', () => {
    const r = savingsReport(data);
    const vacation = r.accounts.find((a) => a.account.id === 'vacation')!;
    expect(vacation).toMatchObject({ balance: 100000 + 20000 - 3000 + 15000, deposited: 35000, withdrawn: 3000, thisMonth: 17000, thisYear: 32000 });
    expect(r.accounts.find((a) => a.account.id === 'emergency')?.balance).toBe(12000);
    expect(r.total).toBe(132000 + 12000);
    expect(r.thisMonth).toBe(22000);
    expect(r.thisYear).toBe(37000);
    expect(r.months.find((m) => m.month === '2026-09')?.net).toBe(15000);
    expect(r.people).toEqual([
      { id: 'ana', net: 35000 },
      { id: null, net: 7000 },
      { id: 'david', net: 2000 },
    ]);
  });

  it('year report separates savings from what was left over', () => {
    const y = yearReport(data, 2026);
    expect(y.saved).toBe(37000);
    expect(y.leftOver).toBe(200000 - 2000 - 37000);
    expect(y.months.find((m) => m.month === '2026-10')?.saved).toBe(22000);
  });
});

describe('yearReport', () => {
  it('adds up months and counts who out-spent whom', () => {
    const report = yearReport(
      input({
        transactions: [
          tx('2026-01-10', 5000, 'david'),
          tx('2026-01-11', 1000, 'ana'),
          tx('2026-02-10', 1000, 'david'),
          tx('2026-02-11', 4000, 'ana'),
          tx('2026-03-11', 9000, 'ana'),
          tx('2025-12-31', 99999, 'ana'),
        ],
        limits: [{ category_id: 'food', effective_from: '2026-01-01', amount_cents: 10000 }],
        today: '2026-03-20',
      }),
      2026,
    );
    expect(report.spent).toBe(20000);
    expect(report.elapsedMonths).toBe(3);
    expect(report.averagePerMonth).toBe(Math.round(20000 / 3));
    expect(report.priciest?.month).toBe('2026-03');
    expect(report.cheapest?.month).toBe('2026-02');
    expect(report.monthsWon.get('ana')).toBe(2);
    expect(report.monthsWon.get('david')).toBe(1);
    expect(report.categories.find((c) => c.category.id === 'food')?.limit).toBe(30000);
  });
});

describe('entries dated in the future', () => {
  const data = input({
    today: '2026-11-20',
    transactions: [
      tx('2026-11-05', 2000, 'david'),
      tx('2026-11-27', 23000, 'ana', 'food', { note: 'Kobasice' }),
      tx('2026-12-03', 5000, null),
      income('2026-11-30', 10000, 'ana', 'bonus'),
      saving('2026-11-25', 4000, 'david', 'vacation'),
    ],
    savingsAccounts: [account('vacation')],
  });

  it('are planned, not spent, until their day comes', () => {
    const m = monthReport(data, '2026-11');
    expect(m.spent).toBe(2000);
    expect(m.transactions.map((t) => t.date)).toEqual(['2026-11-05']);
    expect(m.upcomingExpenses).toBe(23000);
    expect(m.plannedExpenses).toBe(23000);
    expect(m.expectedIncome).toBe(10000);
    expect(m.upcomingSavings).toBe(4000);
    expect(m.upcoming.map((u) => u.date)).toEqual(['2026-11-25', '2026-11-27', '2026-11-30']);
    expect(m.upcoming[1].tx?.note).toBe('Kobasice');
    expect(m.leftToSpend).toBe(10000 - 2000 - 23000 - 4000);
    expect(m.categories.find((c) => c.category.id === 'food')?.spent).toBe(2000);
    expect(m.people.find((p) => p.id === 'ana')?.spent).toBe(0);
  });

  it('count normally once the day has come', () => {
    const m = monthReport({ ...data, today: '2026-11-27' }, '2026-11');
    expect(m.spent).toBe(25000);
    expect(m.plannedExpenses).toBe(0);
    expect(m.upcoming.map((u) => u.date)).toEqual(['2026-11-30']);
  });

  it('show up in a future month as planned, and are left out of year and savings totals', () => {
    const dec = monthReport(data, '2026-12');
    expect(dec.isFuture).toBe(true);
    expect(dec.spent).toBe(0);
    expect(dec.upcomingExpenses).toBe(5000);
    expect(yearReport(data, 2026).spent).toBe(2000);
    expect(savingsReport(data).total).toBe(0);
  });
});

describe('carrying leftover money into the next month', () => {
  const data = input({
    today: '2026-11-20',
    carryFrom: '2026-10-01',
    transactions: [
      income('2026-09-01', 100000, 'david'), // before carrying starts – not carried
      income('2026-10-01', 300000, 'david'),
      tx('2026-10-10', 250000, null),
      saving('2026-10-20', -20000, 'david', 'vacation'), // taken out of savings: more money to spend
      income('2026-11-01', 200000, 'ana'),
      tx('2026-11-02', 30000, 'ana'),
      tx('2026-11-28', 10000, 'ana'), // planned
    ],
    recurring: [recurring({ amount_cents: 60000, day_of_month: 25, posted_through: '2026-10-01' })],
  });

  it('starts from zero in the first month', () => {
    expect(carriedInto(data, '2026-10')).toBeNull();
    expect(carriedInto(data, '2026-09')).toBeNull();
    expect(monthReport(data, '2026-09').carriesOver).toBe(false);
    expect(monthReport(data, '2026-10').carriesOver).toBe(true);
    expect(monthReport(data, '2026-10').leftToSpend).toBe(300000 - 250000 + 20000);
  });

  it("adds the previous month's leftover to what's left to spend", () => {
    const nov = monthReport(data, '2026-11');
    expect(nov.carriedIn).toBe(70000);
    expect(nov.income).toBe(200000); // not counted as income
    expect(nov.leftToSpend).toBe(70000 + 200000 - 30000 - 10000 - 60000);
  });

  it('keeps rolling: a future month starts with what this month is expected to end with', () => {
    expect(carriedInto(data, '2026-12')).toBe(70000 + 200000 - 30000 - 10000 - 60000);
  });

  it('carries a negative month as well', () => {
    const short = input({ carryFrom: '2026-09-01', transactions: [tx('2026-09-03', 5000, 'david')] });
    expect(monthReport(short, '2026-10').carriedIn).toBe(-5000);
  });

  it('is off without a start month', () => {
    const nov = monthReport({ ...data, carryFrom: null }, '2026-11');
    expect(nov.carriedIn).toBeNull();
    expect(nov.leftToSpend).toBe(200000 - 30000 - 10000 - 60000);
  });
});

describe('subcategories', () => {
  const cats = [
    ...categories,
    category('eat', 'expense'),
    category('mcd', 'expense', false, 'eat'),
    category('wolt', 'expense', false, 'eat'),
    category('bakery', 'expense', false, 'eat'),
    category('stocks', 'income', false, 'salary'),
  ];
  const data = input({
    categories: cats,
    transactions: [
      tx('2026-10-01', 1000, 'david', 'mcd'),
      tx('2026-10-02', 1500, 'ana', 'mcd'),
      tx('2026-10-02', 4000, 'ana', 'wolt'),
      tx('2026-10-03', 700, 'david', 'eat'),
      tx('2026-10-03', 3000, 'david', 'food'),
      income('2026-10-01', 9000, 'david', 'stocks'),
    ],
    limits: [
      { category_id: 'eat', effective_from: '2026-01-01', amount_cents: 10000 },
      { category_id: 'wolt', effective_from: '2026-01-01', amount_cents: 3000 },
      { category_id: 'bakery', effective_from: '2026-01-01', amount_cents: 2000 },
    ],
  });
  const m = monthReport(data, '2026-10');
  const eat = m.categories.find((c) => c.category.id === 'eat')!;

  it('add up into their main category', () => {
    expect(m.categories.map((c) => c.category.id)).toEqual(['eat', 'food']);
    expect(eat).toMatchObject({ spent: 7200, count: 4, limit: 10000 });
  });

  it('are listed under it with their own limits, plus a general row', () => {
    expect(eat.subs.map((s) => [s.category.id, s.spent, s.limit, Boolean(s.general)])).toEqual([
      ['wolt', 4000, 3000, false],
      ['mcd', 2500, null, false],
      ['eat', 700, null, true],
      ['bakery', 0, 2000, false],
    ]);
  });

  it("don't count twice in the overall budget", () => {
    // main limit covers its subcategories
    expect(m.budget).toEqual({ limit: 10000, spent: 7200 });
    // without a main limit, the subcategory limits count on their own
    const subOnly = monthReport({ ...data, limits: data.limits.filter((l) => l.category_id !== 'eat') }, '2026-10');
    expect(subOnly.budget).toEqual({ limit: 5000, spent: 4000 });
  });

  it('work for income too, and in the year report', () => {
    expect(m.incomeCategories[0]).toMatchObject({ spent: 9000 });
    expect(m.incomeCategories[0].category.id).toBe('salary');
    const y = yearReport({ ...data, today: '2026-11-15' }, 2026);
    const yEat = y.categories.find((c) => c.category.id === 'eat')!;
    expect(yEat.spent).toBe(7200);
    expect(yEat.limit).toBe(10000 * 11);
    expect(yEat.subs.find((s) => s.category.id === 'wolt')?.limit).toBe(3000 * 11);
  });
});
