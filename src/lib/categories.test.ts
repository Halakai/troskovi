import { describe, expect, it } from 'vitest';
import type { Category } from '../types';
import { categoryTree, withSubcategories } from './categories';

const cat = (id: string, parent: string | null = null): Category => ({
  id,
  name: id,
  emoji: '🏷️',
  color: '#000',
  kind: 'expense',
  owner_id: null,
  parent_id: parent,
  default_shared: false,
  is_system: false,
  sort_order: 1,
  created_by: null,
  created_at: '2026-01-01',
});

describe('categoryTree', () => {
  it('puts subcategories right after their main category', () => {
    const list = [cat('food'), cat('wolt', 'food'), cat('rent'), cat('mcd', 'food'), cat('lost', 'missing')];
    expect(categoryTree(list).map((n) => `${n.depth}:${n.category.id}`)).toEqual([
      '0:food',
      '1:wolt',
      '1:mcd',
      '0:rent',
      '0:lost', // parent not in the list → shown as a main category
    ]);
  });
  it('finds a category with all its subcategories', () => {
    expect([...withSubcategories([cat('food'), cat('wolt', 'food'), cat('rent')], 'food')]).toEqual(['food', 'wolt']);
  });
});
