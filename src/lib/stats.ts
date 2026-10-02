// Pure report calculations (no React, no network) – easy to test.
import type { Category, CategoryKind, CategoryLimit, Profile, Recurring, SavingsAccount, Transaction } from '../types';
import { addMonths, daysInMonth, monthOf, monthsOfYear, monthStart, parseISODate, recurringDate } from './dates';

export interface ReportInput {
  transactions: Transaction[];
  categories: Category[];
  limits: CategoryLimit[];
  savingsAccounts: SavingsAccount[];
  recurring: Recurring[];
  profiles: Profile[];
  /** local YYYY-MM-DD */
  today: string;
}

export interface CategoryStat {
  category: Category;
  /** money spent (expense list) or received (income list) */
  spent: number;
  count: number;
  /** null = no limit set (always null for income) */
  limit: number | null;
}

export interface PersonStat {
  /** null = shared */
  id: string | null;
  name: string;
  color: string;
  spent: number;
  income: number;
  /** net money put into savings */
  saved: number;
  count: number;
  /** own spending + an equal part of shared spending (0 for the shared row) */
  fairShare: number;
}

export interface UpcomingItem {
  item: Recurring;
  date: string;
}

export interface AccountNet {
  account: SavingsAccount;
  /** deposits − withdrawals in the period */
  net: number;
}

export const SHARED_COLOR = '#94a3b8';

const sum = (txs: Transaction[]) => txs.reduce((s, t) => s + t.amount_cents, 0);
const ofKind = (txs: Transaction[], kind: Transaction['kind']) => txs.filter((t) => t.kind === kind);

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

/** Finds an entry's category; unknown or missing ones count as "Other" / "Other income". */
export function categoryResolver(categories: Category[]) {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const other: Record<CategoryKind, Category | undefined> = {
    expense: categories.find((c) => c.is_system && c.kind === 'expense'),
    income: categories.find((c) => c.is_system && c.kind === 'income'),
  };
  return (id: string | null, kind: CategoryKind): Category | undefined => {
    const c = id ? byId.get(id) : undefined;
    return c && c.kind === kind ? c : other[kind];
  };
}

function personStats(profiles: Profile[], txs: Transaction[]): PersonStat[] {
  const people = members(profiles, txs);
  const expenses = ofKind(txs, 'expense');
  const shared = sum(expenses.filter((t) => t.person_id === null));
  const share = people.length ? shared / people.length : 0;
  const row = (id: string | null, name: string, color: string): PersonStat => {
    const own = txs.filter((t) => t.person_id === id);
    const spent = sum(ofKind(own, 'expense'));
    return {
      id,
      name,
      color,
      spent,
      income: sum(ofKind(own, 'income')),
      saved: sum(ofKind(own, 'saving')),
      count: ofKind(own, 'expense').length,
      fairShare: id === null ? 0 : Math.round(spent + share),
    };
  };
  return [...people.map((p) => row(p.id, p.display_name, p.color)), row(null, 'Shared', SHARED_COLOR)];
}

/** Per category of one list (expense or income). Limits are added up over `months` (expense list only). */
function categoryStats(input: ReportInput, txs: Transaction[], months: string[], kind: CategoryKind): CategoryStat[] {
  const resolve = categoryResolver(input.categories);
  const map = new Map<string, CategoryStat>();
  for (const c of input.categories) {
    if (c.kind !== kind) continue;
    let limit: number | null = null;
    if (kind === 'expense') {
      for (const m of months) {
        const l = limitFor(input.limits, c.id, m);
        if (l !== null) limit = (limit ?? 0) + l;
      }
    }
    map.set(c.id, { category: c, spent: 0, count: 0, limit });
  }
  for (const t of ofKind(txs, kind)) {
    const c = resolve(t.category_id, kind);
    const s = c && map.get(c.id);
    if (!s) continue;
    s.spent += t.amount_cents;
    s.count += 1;
  }
  return [...map.values()]
    .filter((s) => s.spent > 0 || s.limit !== null)
    .sort((a, b) => b.spent - a.spent || (b.limit ?? 0) - (a.limit ?? 0));
}

/** Net savings per account in the given transactions (accounts without movement are left out). */
function accountNets(accounts: SavingsAccount[], txs: Transaction[]): AccountNet[] {
  const saving = ofKind(txs, 'saving');
  return accounts
    .map((account) => ({ account, net: sum(saving.filter((t) => t.savings_account_id === account.id)) }))
    .filter((a) => a.net !== 0)
    .sort((a, b) => b.net - a.net);
}

export interface MonthReport {
  month: string;
  transactions: Transaction[];
  spent: number;
  income: number;
  /** net money moved into savings (deposits − withdrawals) */
  saved: number;
  categories: CategoryStat[];
  incomeCategories: CategoryStat[];
  savings: AccountNet[];
  /** sum of limits / spending in categories that have a limit */
  budget: { limit: number; spent: number } | null;
  people: PersonStat[];
  upcoming: UpcomingItem[];
  upcomingExpenses: number;
  upcomingSavings: number;
  expectedIncome: number;
  /** income (received + expected) − spent − upcoming bills − savings (made + planned) */
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
  const expenses = ofKind(txs, 'expense');
  const spent = sum(expenses);
  const income = sum(ofKind(txs, 'income'));
  const saved = sum(ofKind(txs, 'saving'));
  const categories = categoryStats(input, txs, [month], 'expense');

  const limited = categories.filter((c) => c.limit !== null);
  const budget = limited.length
    ? { limit: limited.reduce((s, c) => s + (c.limit ?? 0), 0), spent: limited.reduce((s, c) => s + c.spent, 0) }
    : null;

  const upcoming = upcomingRecurring(input.recurring, month, input.today);
  const upcomingOf = (kind: Recurring['kind']) =>
    upcoming.filter((u) => u.item.kind === kind).reduce((s, u) => s + u.item.amount_cents, 0);
  const upcomingExpenses = upcomingOf('expense');
  const upcomingSavings = upcomingOf('saving');
  const expectedIncome = upcomingOf('income');

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
    saved,
    categories,
    incomeCategories: categoryStats(input, txs, [month], 'income'),
    savings: accountNets(input.savingsAccounts, txs),
    budget,
    people: personStats(input.profiles, txs),
    upcoming,
    upcomingExpenses,
    upcomingSavings,
    expectedIncome,
    leftToSpend: income + expectedIncome - spent - upcomingExpenses - saved - upcomingSavings,
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
  saved: number;
}

export interface YearReport {
  year: number;
  months: MonthTotal[];
  spent: number;
  income: number;
  /** net money moved into savings */
  saved: number;
  /** income − spent − saved: money that was neither spent nor put aside */
  leftOver: number;
  categories: CategoryStat[];
  incomeCategories: CategoryStat[];
  savings: AccountNet[];
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
  const expenses = ofKind(txs, 'expense');

  const totals: MonthTotal[] = months.map((month) => {
    const mt = txs.filter((t) => monthOf(t.date) === month);
    return { month, spent: sum(ofKind(mt, 'expense')), income: sum(ofKind(mt, 'income')), saved: sum(ofKind(mt, 'saving')) };
  });
  const spent = sum(expenses);
  const income = sum(ofKind(txs, 'income'));
  const saved = sum(ofKind(txs, 'saving'));
  const withSpending = totals.filter((m) => m.spent > 0);
  const variable = expenses.filter((t) => !t.recurring_id);

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
    saved,
    leftOver: income - spent - saved,
    categories: categoryStats(input, txs, elapsed, 'expense'),
    incomeCategories: categoryStats(input, txs, elapsed, 'income'),
    savings: accountNets(input.savingsAccounts, txs),
    people: personStats(input.profiles, txs),
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

export interface AccountStat {
  account: SavingsAccount;
  /** starting balance + every deposit − every withdrawal */
  balance: number;
  deposited: number;
  /** positive number */
  withdrawn: number;
  thisMonth: number;
  thisYear: number;
  /** all-time net contributions per person (null = shared) */
  byPerson: { id: string | null; net: number }[];
}

export interface SavingsReport {
  /** open accounts first, then archived ones */
  accounts: AccountStat[];
  total: number;
  thisMonth: number;
  thisYear: number;
  /** net savings per month of the current year */
  months: { month: string; net: number }[];
  /** all-time net contributions (null = shared) */
  people: { id: string | null; net: number }[];
}

/** Needs every savings movement ever (not just the loaded years) for correct balances. */
export function savingsReport(input: ReportInput): SavingsReport {
  const all = ofKind(input.transactions, 'saving');
  const month = monthOf(input.today);
  const year = input.today.slice(0, 4);
  const perPerson = (txs: Transaction[]) => {
    const map = new Map<string | null, number>();
    for (const t of txs) map.set(t.person_id, (map.get(t.person_id) ?? 0) + t.amount_cents);
    return [...map].map(([id, net]) => ({ id, net })).sort((a, b) => b.net - a.net);
  };

  const accounts = input.savingsAccounts
    .map((account): AccountStat => {
      const own = all.filter((t) => t.savings_account_id === account.id);
      return {
        account,
        balance: account.initial_cents + sum(own),
        deposited: sum(own.filter((t) => t.amount_cents > 0)),
        withdrawn: -sum(own.filter((t) => t.amount_cents < 0)),
        thisMonth: sum(own.filter((t) => monthOf(t.date) === month)),
        thisYear: sum(own.filter((t) => t.date.startsWith(`${year}-`))),
        byPerson: perPerson(own),
      };
    })
    .sort((a, b) => Number(a.account.archived) - Number(b.account.archived));

  return {
    accounts,
    total: accounts.reduce((s, a) => s + a.balance, 0),
    thisMonth: sum(all.filter((t) => monthOf(t.date) === month)),
    thisYear: sum(all.filter((t) => t.date.startsWith(`${year}-`))),
    months: monthsOfYear(Number(year)).map((m) => ({ month: m, net: sum(all.filter((t) => monthOf(t.date) === m)) })),
    people: perPerson(all),
  };
}
