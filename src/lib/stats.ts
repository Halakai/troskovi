// Pure report calculations (no React, no network) – easy to test.
import type { BalanceCheck, Category, CategoryKind, CategoryLimit, Kind, Profile, Recurring, SavingsAccount, Transaction } from '../types';
import { balancePeriods, correctionsByMonth, correctionTotal, NO_CORRECTIONS, type Corrections } from './balance';
import { addMonths, daysInMonth, monthOf, monthsOfYear, monthStart, parseISODate, recurringDate } from './dates';

export interface ReportInput {
  transactions: Transaction[];
  categories: Category[];
  limits: CategoryLimit[];
  savingsAccounts: SavingsAccount[];
  recurring: Recurring[];
  profiles: Profile[];
  /** what was really on the accounts – what's left follows these */
  checks: BalanceCheck[];
  /** YYYY-MM-01: leftover money carries into the next month from this month on (null = off) */
  carryFrom: string | null;
  /** local YYYY-MM-DD */
  today: string;
}

export interface CategoryStat {
  category: Category;
  /** money spent (expense list) or received (income list); a main category includes its subcategories */
  spent: number;
  count: number;
  /** null = no limit set (always null for income) */
  limit: number | null;
  /**
   * Main categories that have subcategories: the subcategories with spending or a limit, plus a
   * `general` row for entries that were put on the main category itself. Empty otherwise.
   */
  subs: CategoryStat[];
  /** the "general" row inside `subs` (its `category` is the main category) */
  general?: boolean;
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

export interface DueRecurring {
  item: Recurring;
  date: string;
}

/** Something that will still happen this month: a monthly item that isn't due yet, or an entry dated in the future. */
export interface UpcomingItem {
  date: string;
  kind: Kind;
  /** as stored: negative for a planned savings withdrawal */
  amount_cents: number;
  person_id: string | null;
  recurring?: Recurring;
  tx?: Transaction;
}

export interface AccountNet {
  account: SavingsAccount;
  /** deposits − withdrawals in the period */
  net: number;
}

export const SHARED_COLOR = '#94a3b8';

const sum = (txs: { amount_cents: number }[]) => txs.reduce((s, t) => s + t.amount_cents, 0);
const ofKind = <T extends { kind: Kind }>(txs: T[], kind: Kind) => txs.filter((t) => t.kind === kind);

/** An entry dated after today hasn't happened yet: until its day it only counts as planned. */
export const isPlanned = (t: Pick<Transaction, 'date'>, today: string) => t.date > today;

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
export function upcomingRecurring(recurring: Recurring[], month: string, today: string): DueRecurring[] {
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

const bySpent = (a: CategoryStat, b: CategoryStat) => b.spent - a.spent || (b.limit ?? 0) - (a.limit ?? 0);

/**
 * Per main category of one list (expense or income), each with its subcategories.
 * Limits are added up over `months` (expense list only).
 */
function categoryStats(input: ReportInput, txs: Transaction[], months: string[], kind: CategoryKind): CategoryStat[] {
  const resolve = categoryResolver(input.categories);
  const list = input.categories.filter((c) => c.kind === kind);
  const ids = new Set(list.map((c) => c.id));
  const isMain = (c: Category) => !c.parent_id || !ids.has(c.parent_id);

  const limitOf = (id: string): number | null => {
    if (kind !== 'expense') return null;
    let limit: number | null = null;
    for (const m of months) {
      const l = limitFor(input.limits, id, m);
      if (l !== null) limit = (limit ?? 0) + l;
    }
    return limit;
  };

  // what was booked directly on each category (main or sub)
  const direct = new Map<string, { spent: number; count: number }>();
  for (const t of ofKind(txs, kind)) {
    const c = resolve(t.category_id, kind);
    if (!c) continue;
    const d = direct.get(c.id) ?? { spent: 0, count: 0 };
    d.spent += t.amount_cents;
    d.count += 1;
    direct.set(c.id, d);
  }
  const own = (c: Category, extra: Partial<CategoryStat> = {}): CategoryStat => ({
    category: c,
    spent: direct.get(c.id)?.spent ?? 0,
    count: direct.get(c.id)?.count ?? 0,
    limit: limitOf(c.id),
    subs: [],
    ...extra,
  });

  const result: CategoryStat[] = [];
  for (const main of list.filter(isMain)) {
    const children = list.filter((c) => c.parent_id === main.id).map((c) => own(c));
    const self = own(main);
    const stat: CategoryStat = {
      ...self,
      spent: self.spent + sum(children.map((c) => ({ amount_cents: c.spent }))),
      count: self.count + children.reduce((n, c) => n + c.count, 0),
    };
    if (children.length) {
      stat.subs = children.filter((c) => c.spent > 0 || c.limit !== null);
      if (self.spent > 0) stat.subs.push({ ...self, limit: null, general: true });
      stat.subs.sort(bySpent);
    }
    if (stat.spent > 0 || stat.limit !== null || stat.subs.some((c) => c.limit !== null)) result.push(stat);
  }
  return result.sort(bySpent);
}

/** Net savings per account in the given transactions (accounts without movement are left out). */
function accountNets(accounts: SavingsAccount[], txs: Transaction[]): AccountNet[] {
  const saving = ofKind(txs, 'saving');
  return accounts
    .map((account) => ({ account, net: sum(saving.filter((t) => t.savings_account_id === account.id)) }))
    .filter((a) => a.net !== 0)
    .sort((a, b) => b.net - a.net);
}

/**
 * Everything that moves money in one month (`monthTxs` = all its entries): what already happened,
 * and what is still coming (monthly items not posted yet + entries dated in the future).
 * Money still to go out (expenses, savings) only counts from its day on; money still expected
 * to come in is counted already.
 */
function monthFlow(input: ReportInput, month: string, monthTxs: Transaction[]) {
  const done = monthTxs.filter((t) => !isPlanned(t, input.today));
  const upcoming: UpcomingItem[] = [
    ...upcomingRecurring(input.recurring, month, input.today).map(({ item, date }) => ({
      date,
      kind: item.kind,
      amount_cents: item.amount_cents,
      person_id: item.person_id,
      recurring: item,
    })),
    ...monthTxs
      .filter((t) => isPlanned(t, input.today))
      .map((t) => ({ date: t.date, kind: t.kind, amount_cents: t.amount_cents, person_id: t.person_id, tx: t })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  // a monthly item whose day has come counts even if the app hasn't posted it yet
  const dueNow = upcoming.filter((u) => u.date <= input.today);

  const spent = sum(ofKind(done, 'expense'));
  const income = sum(ofKind(done, 'income'));
  const saved = sum(ofKind(done, 'saving'));
  const expectedIncome = sum(ofKind(upcoming, 'income'));
  return {
    done,
    upcoming,
    spent,
    income,
    saved,
    upcomingExpenses: sum(ofKind(upcoming, 'expense')),
    upcomingSavings: sum(ofKind(upcoming, 'saving')),
    expectedIncome,
    /** income (received + expected) − spent − savings made − what's still to pay but already due */
    net: income + expectedIncome - spent - saved - sum(ofKind(dueNow, 'expense')) - sum(ofKind(dueNow, 'saving')),
  };
}

/** Per month: what the balance checks add to (or take from) what's left. */
const checkCorrections = (input: ReportInput) => correctionsByMonth(balancePeriods(input));

/**
 * Money carried into `month` from the months before: what was left at the end of the previous
 * month, which itself includes what that month got from the one before, and so on – back to
 * `carryFrom`, which starts from zero. null when carrying is off or `month` is the first month.
 */
export function carriedInto(input: ReportInput, month: string, corrections = checkCorrections(input)): number | null {
  if (!input.carryFrom) return null;
  const first = monthOf(input.carryFrom);
  if (month <= first) return null;
  const byMonth = new Map<string, Transaction[]>();
  for (const t of input.transactions) {
    const m = monthOf(t.date);
    if (m < first || m >= month) continue;
    const list = byMonth.get(m);
    if (list) list.push(t);
    else byMonth.set(m, [t]);
  }
  let carry = 0;
  for (let m = first; m < month; m = addMonths(m, 1)) {
    carry += monthFlow(input, m, byMonth.get(m) ?? []).net + correctionTotal(corrections.get(m) ?? NO_CORRECTIONS);
  }
  return carry;
}

export interface MonthReport {
  month: string;
  /** entries that already happened (dated today or earlier) */
  transactions: Transaction[];
  spent: number;
  income: number;
  /** net money moved into savings (deposits − withdrawals) */
  saved: number;
  categories: CategoryStat[];
  incomeCategories: CategoryStat[];
  savings: AccountNet[];
  /** sum of limits / spending in categories that have a limit (a main category's limit covers its subcategories) */
  budget: { limit: number; spent: number } | null;
  people: PersonStat[];
  /** monthly items not posted yet + entries dated in the future, by date */
  upcoming: UpcomingItem[];
  /** still to pay / put into savings: not taken from leftToSpend until their day */
  upcomingExpenses: number;
  upcomingSavings: number;
  /** still to come in: already counted in leftToSpend */
  expectedIncome: number;
  /** future-dated expenses only (no monthly items) */
  plannedExpenses: number;
  /** left over from the month before (null = carrying is off or this is the first month) */
  carriedIn: number | null;
  /** what's left at the end of this month goes into the next one */
  carriesOver: boolean;
  /** from this month's balance checks */
  corrections: Corrections;
  /** carried in + income (received + expected) − spent − savings made (still to pay waits for its day) + corrections */
  leftToSpend: number;
  /** current month only: what should be on the accounts right now (null when carrying is off) */
  onAccounts: number | null;
  isCurrent: boolean;
  isFuture: boolean;
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
  const flow = monthFlow(input, month, input.transactions.filter((t) => monthOf(t.date) === month));
  const txs = flow.done;
  const expenses = ofKind(txs, 'expense');
  const { spent, income, saved, upcoming, upcomingExpenses, upcomingSavings, expectedIncome } = flow;
  const categories = categoryStats(input, txs, [month], 'expense');

  // a limit on a main category already covers its subcategories; sub-limits only count on their own
  const limited: CategoryStat[] = [];
  for (const c of categories) {
    if (c.limit !== null) limited.push(c);
    else limited.push(...c.subs.filter((s) => s.limit !== null));
  }
  const budget = limited.length
    ? { limit: limited.reduce((s, c) => s + (c.limit ?? 0), 0), spent: limited.reduce((s, c) => s + c.spent, 0) }
    : null;

  const todayMonth = monthOf(input.today);
  const isCurrent = month === todayMonth;
  const dim = daysInMonth(month);
  const daysElapsed = month < todayMonth ? dim : isCurrent ? Number(input.today.slice(8, 10)) : 0;

  const variable = expenses.filter((t) => !t.recurring_id);
  // a write-off is money that went on something, but nobody knows on what or when
  const known = variable.filter((t) => !t.write_off);
  const variableSpent = sum(variable);
  const dailyAverage = daysElapsed ? Math.round(variableSpent / daysElapsed) : 0;
  const projected = isCurrent ? Math.round(spent - variableSpent + upcomingExpenses + (variableSpent / daysElapsed) * dim) : null;

  const pool = known.length ? known : expenses;
  const biggest = pool.reduce<Transaction | null>((b, t) => (!b || t.amount_cents > b.amount_cents ? t : b), null);

  const spendDays = new Set(known.map((t) => Number(t.date.slice(8, 10))));
  let noSpendDays = 0;
  for (let d = 1; d <= daysElapsed; d++) if (!spendDays.has(d)) noSpendDays++;

  const byWeekday = new Array(7).fill(0);
  for (const t of known) byWeekday[parseISODate(t.date).getDay()] += t.amount_cents;
  const maxDay = byWeekday.indexOf(Math.max(...byWeekday));
  const busiestWeekday = byWeekday[maxDay] > 0 ? { day: maxDay, amount: byWeekday[maxDay] } : null;

  const prev = addMonths(month, -1);
  const previousSpent = sum(
    input.transactions.filter((t) => t.kind === 'expense' && monthOf(t.date) === prev && !isPlanned(t, input.today)),
  );

  const mostFrequent = categories.reduce<CategoryStat | null>((b, c) => (c.count > (b?.count ?? 0) ? c : b), null);
  const perMonth = checkCorrections(input);
  const corrections = perMonth.get(month) ?? NO_CORRECTIONS;
  const carriedIn = carriedInto(input, month, perMonth);
  const leftToSpend = (carriedIn ?? 0) + flow.net + correctionTotal(corrections);

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
    plannedExpenses: sum(upcoming.filter((u) => u.tx && u.kind === 'expense')),
    carriedIn,
    carriesOver: input.carryFrom !== null && month >= monthOf(input.carryFrom),
    corrections,
    leftToSpend,
    onAccounts: isCurrent && input.carryFrom !== null ? leftToSpend - expectedIncome : null,
    isCurrent,
    isFuture: month > todayMonth,
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

/** The month in three numbers: start + cameIn − wentOut = leftToSpend. */
export function moneySummary(r: MonthReport): { start: number; cameIn: number; wentOut: number } {
  const c = r.corrections;
  const start = (r.carriedIn ?? 0) + c.start + c.accounts;
  const cameIn = r.income + r.expectedIncome + Math.max(0, -r.saved) + Math.max(0, c.toSettle) + Math.max(0, c.small);
  // spent, put into savings, and money that's missing from the accounts
  return { start, cameIn, wentOut: start + cameIn - r.leftToSpend };
}

/** The categories with the most spending, and how much the others add up to. */
export function topCategories(categories: CategoryStat[], max: number): { top: CategoryStat[]; rest: { count: number; spent: number } } {
  const spent = categories.filter((c) => c.spent > 0);
  // "1 more" would take as much room as showing it
  const top = spent.length <= max + 1 ? spent : spent.slice(0, max);
  const others = spent.slice(top.length);
  return { top, rest: { count: others.length, spent: others.reduce((s, c) => s + c.spent, 0) } };
}

/** Who spent more than the next one; `even` = practically the same. null = nobody to compare with. */
export function topSpender(people: PersonStat[], total: number): { name: string; gap: number; even: boolean } | null {
  const [top, second] = people.filter((p) => p.id !== null).sort((a, b) => b.spent - a.spent);
  if (!top || !second || top.spent + second.spent <= 0) return null;
  const gap = top.spent - second.spent;
  return { name: top.name, gap, even: gap < Math.max(500, total * 0.02) };
}

export interface TrendPoint {
  month: string;
  /** spent (expense list) or received (income list); a main category includes its subcategories */
  spent: number;
  count: number;
  /** null = no limit that month (always null for income) */
  limit: number | null;
}

/** One category month by month (entries dated in the future don't count yet). */
export function categoryTrend(input: ReportInput, categoryId: string, months: string[]): TrendPoint[] {
  const cat = input.categories.find((c) => c.id === categoryId);
  if (!cat) return months.map((month) => ({ month, spent: 0, count: 0, limit: null }));
  const resolve = categoryResolver(input.categories);
  const ids = new Set([cat.id, ...input.categories.filter((c) => c.parent_id === cat.id).map((c) => c.id)]);
  const wanted = new Set(months);
  const per = new Map(months.map((m) => [m, { spent: 0, count: 0 }]));
  for (const t of input.transactions) {
    const m = monthOf(t.date);
    if (t.kind !== cat.kind || !wanted.has(m) || isPlanned(t, input.today)) continue;
    const c = resolve(t.category_id, cat.kind);
    if (!c || !ids.has(c.id)) continue;
    const p = per.get(m)!;
    p.spent += t.amount_cents;
    p.count += 1;
  }
  return months.map((month) => ({
    month,
    ...per.get(month)!,
    limit: cat.kind === 'expense' ? limitFor(input.limits, cat.id, month) : null,
  }));
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
  const txs = input.transactions.filter((t) => t.date.startsWith(`${year}-`) && !isPlanned(t, input.today));
  const expenses = ofKind(txs, 'expense');

  const totals: MonthTotal[] = months.map((month) => {
    const mt = txs.filter((t) => monthOf(t.date) === month);
    return { month, spent: sum(ofKind(mt, 'expense')), income: sum(ofKind(mt, 'income')), saved: sum(ofKind(mt, 'saving')) };
  });
  const spent = sum(expenses);
  const income = sum(ofKind(txs, 'income'));
  const saved = sum(ofKind(txs, 'saving'));
  const withSpending = totals.filter((m) => m.spent > 0);
  const variable = expenses.filter((t) => !t.recurring_id && !t.write_off);

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
  const all = ofKind(input.transactions, 'saving').filter((t) => !isPlanned(t, input.today));
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
