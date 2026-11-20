// Helpers for main categories and their subcategories (one level deep).
import type { Category } from '../types';

/** A category counts as a main one when it has no parent – or its parent isn't in `list`. */
export function isMainIn(list: Category[]) {
  const ids = new Set(list.map((c) => c.id));
  return (c: Category) => !c.parent_id || !ids.has(c.parent_id);
}

/** Main categories in their order, each followed by its subcategories. */
export function categoryTree(list: Category[]): { category: Category; depth: 0 | 1 }[] {
  const isMain = isMainIn(list);
  return list
    .filter(isMain)
    .flatMap((main) => [
      { category: main, depth: 0 as const },
      ...list.filter((c) => c.parent_id === main.id).map((category) => ({ category, depth: 1 as const })),
    ]);
}

/** The id itself plus all its subcategories – for "show everything in this category" filters. */
export function withSubcategories(categories: Category[], id: string): Set<string> {
  return new Set([id, ...categories.filter((c) => c.parent_id === id).map((c) => c.id)]);
}
