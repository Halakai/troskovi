import { describe, expect, it } from 'vitest';
import type { ExportData } from '../data/DataProvider';
import type { Category, Transaction } from '../types';
import { entriesCsv } from './export';

const cat = (id: string, name: string, extra: Partial<Category> = {}): Category => ({
  id,
  name,
  emoji: '🏷️',
  color: '#000',
  kind: 'expense',
  owner_id: null,
  parent_id: null,
  default_shared: false,
  is_system: false,
  sort_order: 1,
  created_by: null,
  created_at: '2026-01-01',
  ...extra,
});

const tx = (t: Partial<Transaction>): Transaction => ({
  id: 'x',
  kind: 'expense',
  amount_cents: 1250,
  category_id: 'food',
  savings_account_id: null,
  person_id: 'd',
  date: '2026-11-02',
  note: null,
  recurring_id: null,
  balance_check_id: null,
  write_off: false,
  created_by: 'd',
  created_at: '2026-11-02T10:00:00Z',
  updated_at: '2026-11-02T10:00:00Z',
  ...t,
});

const data: ExportData = {
  exported_at: '2026-11-20T10:00:00Z',
  profiles: [{ id: 'd', username: 'david', display_name: 'David', is_admin: true, active: true, color: '#000', created_at: '' }],
  categories: [cat('food', 'Hrana'), cat('wolt', 'Wolt i Glovo', { parent_id: 'food' }), cat('other', 'Other', { is_system: true })],
  limits: [],
  savingsAccounts: [
    { id: 'acc', name: 'Odmor', emoji: '🏖️', color: '#000', owner_id: null, goal_cents: null, initial_cents: 0, archived: false, sort_order: 1, created_by: null, created_at: '' },
  ],
  recurring: [],
  wallets: [],
  checks: [],
  checkItems: [],
  settings: { carry_from: null, check_weekday: 0, check_time: '14:00', check_skipped_at: null },
  transactions: [
    tx({ id: 'b', category_id: 'wolt', note: 'Pizza, "big" one', person_id: null }),
    tx({ id: 'a', date: '2026-11-01', category_id: 'gone' }),
    tx({ id: 'c', date: '2026-11-03', kind: 'saving', category_id: null, savings_account_id: 'acc', amount_cents: -5000 }),
  ],
};

describe('entriesCsv', () => {
  const lines = entriesCsv(data).split(String.fromCharCode(13, 10));

  it('starts with a byte order mark and a header', () => {
    expect(lines[0].charCodeAt(0)).toBe(0xfeff);
    expect(lines[0].slice(1)).toBe('Date,Type,Amount,Category,Subcategory,Savings account,Person,Note,Monthly item,Added by,Added at');
  });

  it('lists entries oldest first with main and subcategory, quoting where needed', () => {
    expect(lines[1]).toBe('2026-11-01,Expense,12.50,Other,,,David,,,David,2026-11-02T10:00:00Z'); // unknown category → Other
    expect(lines[2]).toBe('2026-11-02,Expense,12.50,Hrana,Wolt i Glovo,,Shared,"Pizza, ""big"" one",,David,2026-11-02T10:00:00Z');
    expect(lines[3]).toBe('2026-11-03,Savings,-50.00,,,Odmor,David,,,David,2026-11-02T10:00:00Z');
    expect(lines[4]).toBe('');
  });
});
