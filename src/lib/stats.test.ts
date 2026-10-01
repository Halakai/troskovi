import { describe, expect, it } from 'vitest';
import type { Category, CategoryLimit, Profile, Recurring, Transaction } from '../types';
import { limitFor, monthReport, upcomingRecurring, yearReport } from './stats';

const profile = (id: string, name: string, created: string): Profile => ({
  id,
  username: name.toLowerCase(),
  display_name: name,
  is_admin: id === 'david',
  active: true,
  color: '#000',
  created_at: created,
});

const category = (id: string, system = false): Category => ({
  id,
  name: id,
  emoji: '🏷️',
  color: '#000',
  owner_id: null,
  is_system: system,
  sort_order: 1,
  created_by: null,
  created_at: '2026-01-01',
});

let n = 0;
const tx = (date: string, cents: number, person: string | null, cat = 'food', extra: Partial<Transaction> = {}): Transaction => ({
  id: `t${++n}`,
  kind: 'expense',
  amount_cents: cents,
  category_id: cat,
  person_id: person,
  date,
  note: null,
  recurring_id: null,
  created_by: person ?? 'david',
  created_at: `${date}T10:00:00Z`,
  updated_at: `${date}T10:00:00Z`,
  ...extra,
});

const recurring = (r: Partial<Recurring>): Recurring => ({
  id: 'r1',
  kind: 'expense',
  name: 'Rent',
  amount_cents: 50000,
  category_id: 'rent',
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
const categories = [category('food'), category('rent'), category('other', true)];

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
  const transactions = [
    tx('2026-10-01', 2000, 'david'),
    tx('2026-10-02', 1000, 'ana'),
    tx('2026-10-02', 50000, null, 'rent', { recurring_id: 'r1' }),
    tx('2026-10-03', 500, 'ana', 'deleted-category'),
    tx('2026-10-03', 300000, 'david', 'food', { kind: 'income', category_id: null }),
    tx('2026-09-15', 10000, 'david'),
  ];
  const report = monthReport(
    {
      transactions,
      categories,
      limits: [{ category_id: 'food', effective_from: '2026-01-01', amount_cents: 5000 }],
      recurring: [recurring({ kind: 'income', name: 'Ana salary', amount_cents: 150000, person_id: 'ana', day_of_month: 15, posted_through: '2026-09-01' })],
      profiles,
      today: '2026-10-04',
    },
    '2026-10',
  );

  it('totals spending and income', () => {
    expect(report.spent).toBe(53500);
    expect(report.income).toBe(300000);
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

  it("counts a salary that hasn't arrived yet as expected income", () => {
    expect(report.expectedIncome).toBe(150000);
    expect(report.leftToSpend).toBe(300000 + 150000 - 53500);
  });

  it('computes fun stats from everyday (non-recurring) spending', () => {
    expect(report.daysElapsed).toBe(4);
    expect(report.dailyAverage).toBe(Math.round(3500 / 4));
    expect(report.noSpendDays).toBe(1);
    expect(report.biggest?.amount_cents).toBe(2000);
    expect(report.projected).toBe(50000 + Math.round((3500 / 4) * 31));
  });
});

describe('yearReport', () => {
  it('adds up months and counts who out-spent whom', () => {
    const report = yearReport(
      {
        transactions: [
          tx('2026-01-10', 5000, 'david'),
          tx('2026-01-11', 1000, 'ana'),
          tx('2026-02-10', 1000, 'david'),
          tx('2026-02-11', 4000, 'ana'),
          tx('2026-03-11', 9000, 'ana'),
          tx('2025-12-31', 99999, 'ana'),
        ],
        categories,
        limits: [{ category_id: 'food', effective_from: '2026-01-01', amount_cents: 10000 }],
        recurring: [],
        profiles,
        today: '2026-03-20',
      },
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
