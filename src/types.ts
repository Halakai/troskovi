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
  is_system: boolean;
  sort_order: number;
  created_by: string | null;
  created_at: string;
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
  created_by: string;
  created_at: string;
  updated_at: string;
  /** client-only: saved locally, waiting for a connection */
  pending?: boolean;
}

export type TransactionInput = Pick<
  Transaction,
  'kind' | 'amount_cents' | 'category_id' | 'savings_account_id' | 'person_id' | 'date' | 'note'
>;
