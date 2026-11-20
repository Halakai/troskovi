// Text matching for search and note suggestions – ignores case and Croatian diacritics,
// so "sminka" finds "Šminka" and "dorucak" finds "Doručak".
import type { CategoryKind, Transaction } from '../types';

export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '') // drop accents: č→c, ć→c, š→s, ž→z
    .replace(/đ/g, 'd') // đ has no decomposed form
    .replace(/\s+/g, ' ')
    .trim();
}

/** `query` (already normalized) starts the text or one of its words. */
export function startsWord(text: string, query: string): boolean {
  return text.startsWith(query) || text.includes(` ${query}`);
}

export interface NoteSuggestion {
  /** as it was typed the last time */
  note: string;
  /** the category this note is used with most often */
  categoryId: string | null;
  count: number;
}

/**
 * Notes used before, for the note field of a new entry. With an empty query: the notes
 * most used in the picked category. While typing: notes containing the text, the ones
 * that start with it first. Monthly items' automatic entries are left out.
 */
export function noteSuggestions(
  transactions: Transaction[],
  opts: { kind: CategoryKind; categoryId: string | null; query: string; limit?: number },
): NoteSuggestion[] {
  const q = normalizeText(opts.query);
  if (!q && !opts.categoryId) return [];

  const groups = new Map<string, { note: string; last: string; count: number; inCategory: number; perCategory: Map<string | null, { n: number; last: string }> }>();
  for (const t of transactions) {
    if (t.kind !== opts.kind || !t.note?.trim() || t.recurring_id) continue;
    const key = normalizeText(t.note);
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { note: t.note.trim(), last: '', count: 0, inCategory: 0, perCategory: new Map() }));
    const when = `${t.date}|${t.created_at}`;
    if (when > g.last) {
      g.last = when;
      g.note = t.note.trim();
    }
    g.count += 1;
    if (t.category_id === opts.categoryId) g.inCategory += 1;
    const pc = g.perCategory.get(t.category_id) ?? { n: 0, last: '' };
    g.perCategory.set(t.category_id, { n: pc.n + 1, last: when > pc.last ? when : pc.last });
  }

  const list = [...groups.entries()]
    .filter(([key, g]) => (q ? key.includes(q) && !(key === q && opts.categoryId) : g.inCategory > 0))
    .map(([key, g]) => ({ key, ...g }));
  list.sort(
    (a, b) =>
      Number(q !== '' && startsWord(b.key, q)) - Number(q !== '' && startsWord(a.key, q)) ||
      b.inCategory - a.inCategory ||
      b.count - a.count ||
      b.last.localeCompare(a.last),
  );

  return list.slice(0, opts.limit ?? 4).map((g) => {
    // the category it's used with most often; on a tie the one used last
    let best: [string | null, { n: number; last: string }] = [null, { n: 0, last: '' }];
    for (const e of g.perCategory) {
      if (e[1].n > best[1].n || (e[1].n === best[1].n && e[1].last > best[1].last)) best = e;
    }
    return { note: g.note, categoryId: best[0], count: g.count };
  });
}
