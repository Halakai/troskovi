// Pure report calculations (no React, no network) – easy to test.
import type { Category, CategoryLimit, Profile, Recurring, Transaction } from '../types';
import { addMonths, daysInMonth, monthOf, monthsOfYear, monthStart, parseISODate, recurringDate } from './dates';

export interface ReportInput {
  transactions: Transaction[];
  categories: Category[];
  limits: CategoryLimit[];
  recurring: Recurring[];
  profiles: Profile[];
  /** local YYYY-MM-DD */
  today: string;
}

export interface CategoryStat {
  category: Category;
  spent: number;
  count: number;
  /** null = no limit set */
  limit: number | null;
}

export interface PersonStat {
  /** null = shared */
  id: string | null;
  name: string;
  color: string;
  spent: number;
  income: number;
  count: number;
  /** own spending + an equal part of shared spending (0 for the shared row) */
  fairShare: number;
}

export interface UpcomingItem {
  item: Recurring;
  date: string;
}

export const SHARED_COLOR = '#94a3b8';

const sum = (txs: Transaction[]) => txs.reduce((s, t) => s + t.amount_cents, 0);

export function limitFor(limits: CategoryLimit[], categoryId: string, month: string): number | null {
  const start = monthStart(month);
  let best: CategoryLimit | null = null;
  for (const l of limits) {
    if (l.category_id === categoryId && l.effective_from <= start && (!best || l.effective_from > best.effective_from)) {
      best = l;
    }
  }
  return best?.amount_cents ?? null;
}

/** People who share expenses: active accounts plus anyone who appears in the given transactions. */
export function members(profiles: Profile[], txs: Transaction[]): Profile[] {
  const used = new Set(txs.map((t) => t.person_id));
  return profiles
    .filter((p) => p.active || used.has(p.id))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/** Recurring items that will still be added in this month (not posted yet). */
export function upcomingRecurring(recurring: Recurring[], month: string, today: string): UpcomingItem[] {
  if (month < monthOf(today)) return [];
  const start = monthStart(month);
  return recurring
    .filter(
      (r) =>
        r.active &&
        r.start_month <= start &&
        (!r.end_month || r.end_month >= start) &&
        (!r.posted_through || r.posted_through < start),
    )
    .map((item) => ({ item, date: recurringDate(month, item.day_of_month) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function categoryResolver(categories: Category[]) {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const other = categories.find((c) => c.is_system);
  return (id: string | null) => (id && byId.get(id)) || other;
}

function personStats(profiles: Profile[], txs: Transaction[]): PersonStat[] {
  const people = members(profiles, txs);
  const expenses = txs.filter((t) => t.kind === 'expense');
  const shared = sum(expenses.filter((t) => t.person_id === null));
  const share = people.length ? shared / people.length : 0;
  const rows: PersonStat[] = people.map((p) => {
    const own = txs.filter((t) => t.person_id === p.id);
    const spent = sum(own.filter((t) => t.kind === 'expense'));
    return {
      id: p.id,
      name: p.display_name,
      color: p.color,
      spent,
      income: sum(own.filter((t) => t.kind === 'income')),
      count: own.filter((t) => t.kind === 'expense').length,
      fairShare: Math.round(spent + share),
    };
  });
  const sharedTx = txs.filter((t) => t.person_id === null);
  rows.push({
    id: null,
    name: 'Shared',
    color: SHARED_COLOR,
    spent: shared,
    income: sum(sharedTx.filter((t) => t.kind === 'income')),
    count: sharedTx.filter((t) => t.kind === 'expense').length,
    fairShare: 0,
  });
  return rows;
}

function categoryStats(input: ReportInput, expenses: Transaction[], months: string[]): CategoryStat[] {
  const resolve = categoryResolver(input.categories);
  const map = new Map<string, CategoryStat>();
  for (const c of input.categories) {
    let limit: number | null = null;
    for (const m of months) {
      const l = limitFor(input.limits, c.id, m);
      if (l !== null) limit = (limit ?? 0) + l;
    }
    map.set(c.id, { category: c, spent: 0, count: 0, limit });
  }
  for (const t of expenses) {
    const c = resolve(t.category_id);
    if (!c) continue;
    const s = map.get(c.id)!;
    s.spent += t.amount_cents;
    s.count += 1;
  }
  return [...map.values()]
    .filter((s) => s.spent > 0 || s.limit !== null)
    .sort((a, b) => b.spent - a.spent || (b.limit ?? 0) - (a.limit ?? 0));
}

export interface MonthReport {
  month: string;
  transactions: Transaction[];
  spent: number;
  income: number;
  categories: CategoryStat[];
  /** sum of limits / spending in categories that have a limit */
  budget: { limit: number; spent: number } | null;
  people: PersonStat[];
  upcoming: UpcomingItem[];
  upcomingExpenses: number;
  expectedIncome: number;
  /** income (received + expected) − spent − upcoming bills */
  leftToSpend: number;
  isCurrent: boolean;
  daysElapsed: number;
  daysInMonth: number;
  /** non-recurring spending per elapsed day */
  dailyAverage: number;
  /** current month only: where spending lands at this pace */
  projected: number | null;
  biggest: Transaction | null;
  noSpendDays: number;
  busiestWeekday: { day: number; amount: number } | null;
  previousSpent: number;
  mostFrequent: CategoryStat | null;
}

export function monthReport(input: ReportInput, month: string): MonthReport {
  const txs = input.transactions.filter((t) => monthOf(t.date) === month);
  const expenses = txs.filter((t) => t.kind === 'expense');
  const spent = sum(expenses);
  const income = sum(txs.filter((t) => t.kind === 'income'));
  const categories = categoryStats(input, expenses, [month]);

  const limited = categories.filter((c) => c.limit !== null);
  const budget = limited.length
    ? { limit: limited.reduce((s, c) => s + (c.limit ?? 0), 0), spent: limited.reduce((s, c) => s + c.spent, 0) }
    : null;

  const upcoming = upcomingRecurring(input.recurring, month, input.today);
  const upcomingExpenses = upcoming.filter((u) => u.item.kind === 'expense').reduce((s, u) => s + u.item.amount_cents, 0);
  const expectedIncome = upcoming.filter((u) => u.item.kind === 'income').reduce((s, u) => s + u.item.amount_cents, 0);

  const todayMonth = monthOf(input.today);
  const isCurrent = month === todayMonth;
  const dim = daysInMonth(month);
  const daysElapsed = month < todayMonth ? dim : isCurrent ? Number(input.today.slice(8, 10)) : 0;

  const variable = expenses.filter((t) => !t.recurring_id);
  const variableSpent = sum(variable);
  const dailyAverage = daysElapsed ? Math.round(variableSpent / daysElapsed) : 0;
  const projected = isCurrent ? Math.round(spent - variableSpent + upcomingExpenses + (variableSpent / daysElapsed) * dim) : null;

  const pool = variable.length ? variable : expenses;
  const biggest = pool.reduce<Transaction | null>((b, t) => (!b || t.amount_cents > b.amount_cents ? t : b), null);

  const spendDays = new Set(variable.map((t) => Number(t.date.slice(8, 10))));
  let noSpendDays = 0;
  for (let d = 1; d <= daysElapsed; d++) if (!spendDays.has(d)) noSpendDays++;

  const byWeekday = new Array(7).fill(0);
  for (const t of variable) byWeekday[parseISODate(t.date).getDay()] += t.amount_cents;
  const maxDay = byWeekday.indexOf(Math.max(...byWeekday));
  const busiestWeekday = byWeekday[maxDay] > 0 ? { day: maxDay, amount: byWeekday[maxDay] } : null;

  const prev = addMonths(month, -1);
  const previousSpent = sum(input.transactions.filter((t) => t.kind === 'expense' && monthOf(t.date) === prev));

  const mostFrequent = categories.reduce<CategoryStat | null>((b, c) => (c.count > (b?.count ?? 0) ? c : b), null);

  return {
    month,
    transactions: txs,
    spent,
    income,
    categories,
    budget,
    people: personStats(input.profiles, txs),
    upcoming,
    upcomingExpenses,
    expectedIncome,
    leftToSpend: income + expectedIncome - spent - upcomingExpenses,
    isCurrent,
    daysElapsed,
    daysInMonth: dim,
    dailyAverage,
    projected,
    biggest,
    noSpendDays,
    busiestWeekday,
    previousSpent,
    mostFrequent,
  };
}

export interface MonthTotal {
  month: string;
  spent: number;
  income: number;
}

export interface YearReport {
  year: number;
  months: MonthTotal[];
  spent: number;
  income: number;
  saved: number;
  categories: CategoryStat[];
  people: PersonStat[];
  /** months that already started (all 12 for past years) */
  elapsedMonths: number;
  averagePerMonth: number;
  priciest: MonthTotal | null;
  cheapest: MonthTotal | null;
  biggest: Transaction | null;
  /** person id → number of months in which they personally spent the most */
  monthsWon: Map<string, number>;
}

export function yearReport(input: ReportInput, year: number): YearReport {
  const months = monthsOfYear(year);
  const todayMonth = monthOf(input.today);
  const elapsed = months.filter((m) => m <= todayMonth);
  const txs = input.transactions.filter((t) => t.date.startsWith(`${year}-`));
  const expenses = txs.filter((t) => t.kind === 'expense');

  const totals: MonthTotal[] = months.map((month) => {
    const mt = txs.filter((t) => monthOf(t.date) === month);
    return {
      month,
      spent: sum(mt.filter((t) => t.kind === 'expense')),
      income: sum(mt.filter((t) => t.kind === 'income')),
    };
  });
  const spent = sum(expenses);
  const income = sum(txs.filter((t) => t.kind === 'income'));
  const withSpending = totals.filter((m) => m.spent > 0);
  const variable = expenses.filter((t) => !t.recurring_id);

  const people = personStats(input.profiles, txs);
  const monthsWon = new Map<string, number>();
  for (const month of months) {
    const mt = expenses.filter((t) => monthOf(t.date) === month && t.person_id);
    const perPerson = new Map<string, number>();
    for (const t of mt) perPerson.set(t.person_id!, (perPerson.get(t.person_id!) ?? 0) + t.amount_cents);
    let top: [string, number] | null = null;
    for (const e of perPerson) if (!top || e[1] > top[1]) top = e;
    if (top) monthsWon.set(top[0], (monthsWon.get(top[0]) ?? 0) + 1);
  }

  return {
    year,
    months: totals,
    spent,
    income,
    saved: income - spent,
    categories: categoryStats(input, expenses, elapsed),
    people,
    elapsedMonths: elapsed.length,
    averagePerMonth: elapsed.length ? Math.round(spent / elapsed.length) : 0,
    priciest: withSpending.reduce<MonthTotal | null>((b, m) => (!b || m.spent > b.spent ? m : b), null),
    cheapest: withSpending.reduce<MonthTotal | null>((b, m) => (!b || m.spent < b.spent ? m : b), null),
    // monthly bills (rent…) would always win, so look at everyday spending first
    biggest: (variable.length ? variable : expenses).reduce<Transaction | null>(
      (b, t) => (!b || t.amount_cents > b.amount_cents ? t : b),
      null,
    ),
    monthsWon,
  };
}
