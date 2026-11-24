import { describe, expect, it } from 'vitest';
import type { Transaction } from '../types';
import { normalizeText, noteSuggestions } from './search';

let n = 0;
const tx = (note: string | null, category: string, date = '2026-11-01', extra: Partial<Transaction> = {}): Transaction => ({
  id: `t${++n}`,
  kind: 'expense',
  amount_cents: 100,
  category_id: category,
  savings_account_id: null,
  person_id: 'david',
  date,
  note,
  recurring_id: null,
  balance_check_id: null,
  write_off: false,
  created_by: 'david',
  created_at: `${date}T10:00:00Z`,
  updated_at: `${date}T10:00:00Z`,
  ...extra,
});

describe('normalizeText', () => {
  it('ignores case, accents and extra spaces', () => {
    expect(normalizeText('  Šminka  i  ĐAK ')).toBe('sminka i dak');
    expect(normalizeText('Doručak, ćevapi, žganci')).toBe('dorucak, cevapi, zganci');
  });
});

describe('noteSuggestions', () => {
  const txs = [
    tx('Lidl', 'groceries', '2026-10-01'),
    tx('lidl ', 'groceries', '2026-10-05'),
    tx('Lidl', 'groceries', '2026-11-02'),
    tx('Kaufland', 'groceries'),
    tx('Parking', 'transport', '2026-10-01'),
    tx('parking', 'other', '2026-11-03'),
    tx('Parking', 'transport', '2026-11-04'),
    tx('Pekara', 'bakery'),
    tx('Novi Lidl', 'groceries'),
    tx('Rent', 'rent', '2026-11-01', { recurring_id: 'r1' }),
    tx('Plaća', 'salary', '2026-11-01', { kind: 'income' }),
  ];
  const suggest = (query: string, categoryId: string | null = null) =>
    noteSuggestions(txs, { kind: 'expense', categoryId, query }).map((s) => `${s.note}>${s.categoryId}`);

  it('finds notes while typing, word starts first, and knows their usual category', () => {
    expect(suggest('li')).toEqual(['Lidl>groceries', 'Novi Lidl>groceries']);
    expect(suggest('PAR')).toEqual(['Parking>transport']); // 2× transport beats 1× other
    expect(suggest('e')).toContain('Pekara>bakery');
  });

  it('shows the most used notes of the picked category before anything is typed', () => {
    expect(suggest('', 'groceries')).toEqual(['Lidl>groceries', 'Kaufland>groceries', 'Novi Lidl>groceries']);
    expect(suggest('')).toEqual([]);
  });

  it("hides a note that's already typed in full once a category is picked", () => {
    expect(suggest('lidl', 'groceries')).toEqual(['Novi Lidl>groceries']);
    expect(suggest('lidl')).toEqual(['Lidl>groceries', 'Novi Lidl>groceries']);
  });

  it('leaves out monthly items and the other list', () => {
    expect(suggest('rent')).toEqual([]);
    expect(suggest('placa')).toEqual([]);
    expect(noteSuggestions(txs, { kind: 'income', categoryId: null, query: 'placa' })[0].note).toBe('Plaća');
  });
});
