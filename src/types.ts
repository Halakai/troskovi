/** 'saving' = money moved into (positive amount) or out of (negative amount) a savings account */
export type Kind = 'expense' | 'income' | 'saving';
/** expense and income categories are two separate lists */
export type CategoryKind = 'expense' | 'income';

export interface Profile {
  id: string;
  username: string;
  display_name: string;
  is_admin: boolean;
  active: boolean;
  color: string;
  created_at: string;
}

export interface Category {
  id: string;
  name: string;
  emoji: string;
  color: string;
  kind: CategoryKind;
  /** null = shared, otherwise private to this person */
  owner_id: string | null;
  /** set = subcategory of that main category (only one level deep) */
  parent_id: string | null;
  /** new entries in this category start as "Shared" instead of the person adding them */
  default_shared: boolean;
  is_system: boolean;
  sort_order: number;
  created_by: string | null;
  created_at: string;
}

/** Household-wide settings (one row). */
export interface AppSettings {
  /** YYYY-MM-01: from this month on, what's left at the end of a month carries into the next. null = off */
  carry_from: string | null;
  /** day the weekly balance check is due: 0 = Sunday … 6 = Saturday, null = never */
  check_weekday: number | null;
  /** HH:MM */
  check_time: string;
  /** the check that was due then was skipped */
  check_skipped_at: string | null;
}

/** Where the everyday money really is: someone's bank account, cash, … (savings accounts are separate). */
export interface Wallet {
  id: string;
  name: string;
  emoji: string;
  /** null = shared */
  owner_id: string | null;
  archived: boolean;
  sort_order: number;
  created_by: string | null;
  created_at: string;
}

/** What was really on the accounts at one moment. The difference to the app is worked out in lib/balance. */
export interface BalanceCheck {
  id: string;
  /** YYYY-MM-DD: the day the balances are from */
  date: string;
  /** true: from the end of that day (typed in later); false: from `checked_at` */
  whole_day: boolean;
  checked_at: string;
  /** all accounts together */
  real_cents: number;
  /** accounts that joined (+) or dropped out (−) since the check before */
  adjust_cents: number;
  /** counted as one with the check after it */
  joined: boolean;
  created_by: string;
  created_at: string;
}

/** One account's balance in a check (only admins get these). */
export interface BalanceCheckItem {
  check_id: string;
  wallet_id: string;
  amount_cents: number;
}

export interface CategoryLimit {
  category_id: string;
  /** YYYY-MM-01 */
  effective_from: string;
  /** null = no limit from this month on */
  amount_cents: number | null;
}

export interface SavingsAccount {
  id: string;
  name: string;
  emoji: string;
  color: string;
  /** null = shared */
  owner_id: string | null;
  /** optional target */
  goal_cents: number | null;
  /** money that was already in the account before it was tracked here */
  initial_cents: number;
  archived: boolean;
  sort_order: number;
  created_by: string | null;
  created_at: string;
}

export interface Recurring {
  id: string;
  kind: Kind;
  name: string;
  amount_cents: number;
  category_id: string | null;
  savings_account_id: string | null;
  /** null = shared */
  person_id: string | null;
  day_of_month: number;
  /** YYYY-MM-01 */
  start_month: string;
  end_month: string | null;
  posted_through: string | null;
  active: boolean;
  created_by: string;
  created_at: string;
}

export interface Transaction {
  id: string;
  kind: Kind;
  /** always positive, except savings withdrawals (negative) */
  amount_cents: number;
  category_id: string | null;
  savings_account_id: string | null;
  /** null = shared */
  person_id: string | null;
  /** YYYY-MM-DD */
  date: string;
  note: string | null;
  recurring_id: string | null;
  /** happened before that balance check, whatever its date or time says (e.g. it was found missing there) */
  balance_check_id: string | null;
  /** the part of a balance check's difference nobody could explain */
  write_off: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
  /** client-only: saved locally, waiting for a connection */
  pending?: boolean;
}

export type TransactionInput = Pick<
  Transaction,
  'kind' | 'amount_cents' | 'category_id' | 'savings_account_id' | 'person_id' | 'date' | 'note'
> &
  Partial<Pick<Transaction, 'balance_check_id' | 'write_off'>>;
