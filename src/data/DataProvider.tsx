import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { errorMessage, isNetworkError, supabase } from '../supabase';
import type { Category, CategoryLimit, Profile, Recurring, Transaction, TransactionInput } from '../types';
import { monthOf, monthStart, todayISO, yearOf } from '../lib/dates';
import { uuid } from '../lib/uuid';

interface Snapshot {
  profiles: Profile[];
  categories: Category[];
  limits: CategoryLimit[];
  recurring: Recurring[];
  /** transactions of every year listed in `years` */
  transactions: Transaction[];
  years: number[];
}

const EMPTY: Snapshot = { profiles: [], categories: [], limits: [], recurring: [], transactions: [], years: [] };

export type CategoryDraft = Pick<Category, 'name' | 'emoji' | 'color' | 'owner_id'> & { id?: string };
export type RecurringDraft = Pick<
  Recurring,
  'kind' | 'name' | 'amount_cents' | 'category_id' | 'person_id' | 'day_of_month' | 'start_month' | 'end_month' | 'active'
> & { id?: string };

interface DataContextValue extends Snapshot {
  userId: string;
  me: Profile | undefined;
  isAdmin: boolean;
  /** server data + expenses saved offline that are still waiting to upload */
  allTransactions: Transaction[];
  pendingCount: number;
  ready: boolean;
  syncError: string | null;
  live: boolean;
  refresh: () => Promise<void>;
  ensureYear: (year: number) => void;
  yearLoading: (year: number) => boolean;

  addTransaction: (input: TransactionInput, opts?: { repeatMonthly?: boolean; recurringName?: string }) => Promise<'saved' | 'queued'>;
  updateTransaction: (id: string, patch: Partial<TransactionInput>) => Promise<void>;
  deleteTransaction: (id: string) => Promise<void>;

  saveCategory: (draft: CategoryDraft) => Promise<Category>;
  deleteCategory: (id: string) => Promise<void>;
  setLimit: (categoryId: string, month: string, cents: number | null) => Promise<void>;

  saveRecurring: (draft: RecurringDraft) => Promise<void>;
  deleteRecurring: (id: string) => Promise<void>;

  changeMyPassword: (current: string, next: string) => Promise<void>;
  adminCreateUser: (u: { username: string; password: string; displayName: string; isAdmin: boolean; color: string }) => Promise<void>;
  adminUpdateUser: (u: { id: string; username: string; displayName: string; isAdmin: boolean; active: boolean; color: string }) => Promise<void>;
  adminSetPassword: (id: string, password: string) => Promise<void>;
  adminDeleteUser: (id: string) => Promise<void>;
}

const DataContext = createContext<DataContextValue | null>(null);

export function useData(): DataContextValue {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData outside DataProvider');
  return ctx;
}

// ---------------------------------------------------------------- helpers

const cacheKey = (userId: string) => `troskovi.cache.v1.${userId}`;
const outboxKey = (userId: string) => `troskovi.outbox.v1.${userId}`;

function readJSON<T>(key: string, fallback: T): T {
  try {
    const s = localStorage.getItem(key);
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or unavailable – the app still works, just without cache */
  }
}

type Row = Record<string, unknown>;
const normTx = (r: Row) => ({ ...r, amount_cents: Number(r.amount_cents) }) as Transaction;
const normRecurring = (r: Row) => ({ ...r, amount_cents: Number(r.amount_cents), day_of_month: Number(r.day_of_month) }) as Recurring;
const normLimit = (r: Row) => ({ ...r, amount_cents: r.amount_cents == null ? null : Number(r.amount_cents) }) as CategoryLimit;
const normCategory = (r: Row) => ({ ...r, sort_order: Number(r.sort_order) }) as Category;
const sortCategories = (list: Category[]) =>
  [...list].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));

function upsertById<T extends { id: string }>(list: T[], item: T): T[] {
  const i = list.findIndex((x) => x.id === item.id);
  if (i < 0) return [...list, item];
  const copy = list.slice();
  copy[i] = item;
  return copy;
}

const sameLimit = (a: CategoryLimit, b: Pick<CategoryLimit, 'category_id' | 'effective_from'>) =>
  a.category_id === b.category_id && a.effective_from === b.effective_from;

/** Only the real table columns (no client-only fields). */
function txRow(t: Transaction) {
  const { id, kind, amount_cents, category_id, person_id, date, note, recurring_id, created_by } = t;
  return { id, kind, amount_cents, category_id, person_id, date, note, recurring_id, created_by };
}

async function fetchYear(year: number): Promise<Transaction[]> {
  const PAGE = 1000;
  const rows: Transaction[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('transactions')
      .select('*')
      .gte('date', `${year}-01-01`)
      .lte('date', `${year}-12-31`)
      .order('date')
      .order('id')
      .range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...data.map(normTx));
    if (data.length < PAGE) return rows;
  }
}

async function fetchTable<T>(table: string, norm: (r: Row) => T): Promise<T[]> {
  const { data, error } = await supabase.from(table).select('*');
  if (error) throw error;
  return data.map(norm);
}

function hydrate(userId: string): Snapshot {
  const cached = readJSON<Snapshot>(cacheKey(userId), EMPTY);
  // keep the start-up refresh small: only this year and last year come from cache
  const thisYear = new Date().getFullYear();
  const years = (cached.years ?? []).filter((y) => y >= thisYear - 1);
  return {
    ...EMPTY,
    ...cached,
    years,
    transactions: (cached.transactions ?? []).filter((t) => years.includes(yearOf(t.date))),
  };
}

// ---------------------------------------------------------------- provider

export function DataProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const [snap, setSnap] = useState<Snapshot>(() => hydrate(userId));
  const [outbox, setOutbox] = useState<Transaction[]>(() => readJSON<Transaction[]>(outboxKey(userId), []));
  const [ready, setReady] = useState(() => snap.profiles.length > 0);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [loadingYears, setLoadingYears] = useState<number[]>([]);

  const snapRef = useRef(snap);
  snapRef.current = snap;
  const outboxRef = useRef(outbox);
  outboxRef.current = outbox;

  // When a row was last changed locally or by realtime. A full reload that
  // started earlier must not overwrite these newer versions.
  const touched = useRef(new Map<string, number>());
  const touch = (id: string) => touched.current.set(id, Date.now());
  const isNewer = (id: string, since: number) => (touched.current.get(id) ?? 0) > since;

  // ---- local state updates

  const putTx = useCallback((tx: Transaction) => {
    touch(tx.id);
    setSnap((s) => ({ ...s, transactions: upsertById(s.transactions, tx) }));
  }, []);

  const dropTx = useCallback((id: string) => {
    touch(id);
    setSnap((s) => ({ ...s, transactions: s.transactions.filter((t) => t.id !== id) }));
  }, []);

  const replaceYear = (s: Snapshot, year: number, rows: Transaction[], since: number): Snapshot => {
    const prefix = `${year}-`;
    const kept = s.transactions.filter((t) => !t.date.startsWith(prefix) || isNewer(t.id, since));
    const keptIds = new Set(kept.map((t) => t.id));
    const fresh = rows.filter((r) => !isNewer(r.id, since) && !keptIds.has(r.id));
    return {
      ...s,
      transactions: [...kept, ...fresh],
      years: s.years.includes(year) ? s.years : [...s.years, year],
    };
  };

  // ---- persistence

  useEffect(() => {
    const t = setTimeout(() => writeJSON(cacheKey(userId), snap), 400);
    return () => clearTimeout(t);
  }, [snap, userId]);

  useEffect(() => writeJSON(outboxKey(userId), outbox), [outbox, userId]);

  // ---- offline queue

  const flushing = useRef(false);
  const flushOutbox = useCallback(async () => {
    if (flushing.current || outboxRef.current.length === 0) return;
    flushing.current = true;
    try {
      for (const tx of outboxRef.current) {
        const { error } = await supabase.from('transactions').upsert(txRow(tx), { onConflict: 'id', ignoreDuplicates: true });
        if (error && isNetworkError(error)) return;
        setOutbox((o) => o.filter((x) => x.id !== tx.id));
        if (error) {
          setSyncError(`An expense saved offline could not be uploaded: ${errorMessage(error)}`);
        } else {
          putTx({ ...tx, pending: undefined });
        }
      }
    } finally {
      flushing.current = false;
    }
  }, [putTx]);

  // ---- loading

  const refreshing = useRef<Promise<void> | null>(null);
  const lastRefresh = useRef(0);

  const refresh = useCallback(async () => {
    if (refreshing.current) return refreshing.current;
    const run = async () => {
      const since = Date.now();
      try {
        await flushOutbox();
        const rec = await supabase.rpc('apply_recurring', { p_today: todayISO() });
        if (rec.error && isNetworkError(rec.error)) throw rec.error;

        const [profiles, categories, limits, recurring] = await Promise.all([
          fetchTable('profiles', (r) => r as unknown as Profile),
          fetchTable('categories', normCategory),
          fetchTable('category_limits', normLimit),
          fetchTable('recurring', normRecurring),
        ]);
        const thisYear = new Date().getFullYear();
        const years = [...new Set([thisYear, ...snapRef.current.years])];
        const perYear = await Promise.all(years.map(fetchYear));

        setSnap((s) => {
          let next: Snapshot = { ...s, profiles, categories: sortCategories(categories), limits, recurring };
          years.forEach((y, i) => (next = replaceYear(next, y, perYear[i], since)));
          return next;
        });
        setReady(true);
        setSyncError(null);
        lastRefresh.current = Date.now();
      } catch (e) {
        setSyncError(errorMessage(e));
      }
    };
    refreshing.current = run().finally(() => (refreshing.current = null));
    return refreshing.current;
  }, [flushOutbox]);

  const loadingRef = useRef(new Set<number>());
  const ensureYear = useCallback((year: number) => {
    if (snapRef.current.years.includes(year) || loadingRef.current.has(year)) return;
    loadingRef.current.add(year);
    setLoadingYears([...loadingRef.current]);
    const since = Date.now();
    fetchYear(year)
      .then((rows) => setSnap((s) => replaceYear(s, year, rows, since)))
      .catch((e) => setSyncError(errorMessage(e)))
      .finally(() => {
        loadingRef.current.delete(year);
        setLoadingYears([...loadingRef.current]);
      });
  }, []);

  // ---- realtime + lifecycle

  useEffect(() => {
    refresh();

    const onTx = (p: RealtimePostgresChangesPayload<Row>) => {
      if (p.eventType === 'DELETE') {
        dropTx(String(p.old.id));
      } else {
        const tx = normTx(p.new);
        putTx(tx);
        setOutbox((o) => (o.some((x) => x.id === tx.id) ? o.filter((x) => x.id !== tx.id) : o));
      }
    };
    const byId =
      <K extends 'profiles' | 'categories' | 'recurring'>(key: K, norm: (r: Row) => Snapshot[K][number]) =>
      (p: RealtimePostgresChangesPayload<Row>) =>
        setSnap((s) => {
          const list = s[key] as Array<{ id: string }>;
          const next =
            p.eventType === 'DELETE'
              ? list.filter((x) => x.id !== p.old.id)
              : upsertById(list, norm(p.new) as unknown as { id: string });
          return { ...s, [key]: key === 'categories' ? sortCategories(next as Category[]) : next };
        });
    const onLimit = (p: RealtimePostgresChangesPayload<Row>) =>
      setSnap((s) => {
        const key = (p.eventType === 'DELETE' ? p.old : p.new) as unknown as CategoryLimit;
        const rest = s.limits.filter((l) => !sameLimit(l, key));
        return { ...s, limits: p.eventType === 'DELETE' ? rest : [...rest, normLimit(p.new)] };
      });

    const changes = { event: '*', schema: 'public' } as const;
    const channel = supabase
      .channel(`troskovi-${userId}`)
      .on('postgres_changes', { ...changes, table: 'transactions' }, onTx)
      .on('postgres_changes', { ...changes, table: 'categories' }, byId('categories', normCategory))
      .on('postgres_changes', { ...changes, table: 'recurring' }, byId('recurring', normRecurring))
      .on('postgres_changes', { ...changes, table: 'profiles' }, byId('profiles', (r) => r as unknown as Profile))
      .on('postgres_changes', { ...changes, table: 'category_limits' }, onLimit)
      // The database feed is ready a moment after the channel itself. Changes made
      // before that (or while disconnected) aren't pushed, so catch up with a reload.
      .on('system', {}, (m: { extension?: string; status?: string }) => {
        if (m.extension === 'postgres_changes' && m.status === 'ok') {
          (refreshing.current ?? Promise.resolve()).then(() => refresh());
        }
      })
      .subscribe((status) => setLive(status === 'SUBSCRIBED'));

    // Phones suspend background apps; reload when the app comes back to the screen.
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastRefresh.current > 5000) refresh();
    };
    const onOnline = () => refresh();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    const timer = setInterval(() => outboxRef.current.length && flushOutbox(), 30000);

    return () => {
      supabase.removeChannel(channel);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      clearInterval(timer);
    };
  }, [userId, refresh, flushOutbox, putTx, dropTx]);

  // ---------------------------------------------------------------- mutations

  const addTransaction = useCallback<DataContextValue['addTransaction']>(
    async (input, opts = {}) => {
      const now = new Date().toISOString();
      let recurringId: string | null = null;

      if (opts.repeatMonthly) {
        // Starts in the month of this expense and counts this one as already posted,
        // so the next copy is created automatically next month.
        const month = monthStart(monthOf(input.date));
        const { data, error } = await supabase
          .from('recurring')
          .insert({
            kind: input.kind,
            name: opts.recurringName || input.note || 'Monthly',
            amount_cents: input.amount_cents,
            category_id: input.category_id,
            person_id: input.person_id,
            day_of_month: Number(input.date.slice(8, 10)),
            start_month: month,
            posted_through: month,
            created_by: userId,
          })
          .select()
          .single();
        if (error) throw new Error(errorMessage(error));
        recurringId = data.id;
        setSnap((s) => ({ ...s, recurring: upsertById(s.recurring, normRecurring(data)) }));
      }

      const tx: Transaction = {
        id: uuid(),
        ...input,
        recurring_id: recurringId,
        created_by: userId,
        created_at: now,
        updated_at: now,
      };
      putTx(tx);
      const { error } = await supabase.from('transactions').insert(txRow(tx));
      if (!error) return 'saved';
      if (isNetworkError(error)) {
        dropTx(tx.id);
        setOutbox((o) => [...o, { ...tx, pending: true }]);
        return 'queued';
      }
      dropTx(tx.id);
      throw new Error(errorMessage(error));
    },
    [userId, putTx, dropTx],
  );

  const updateTransaction = useCallback<DataContextValue['updateTransaction']>(
    async (id, patch) => {
      const queued = outboxRef.current.find((t) => t.id === id);
      if (queued) {
        setOutbox((o) => o.map((t) => (t.id === id ? { ...t, ...patch } : t)));
        return;
      }
      const before = snapRef.current.transactions.find((t) => t.id === id);
      if (before) putTx({ ...before, ...patch });
      const { data, error } = await supabase.from('transactions').update(patch).eq('id', id).select();
      if (error || !data?.length) {
        if (before) putTx(before);
        throw new Error(error ? errorMessage(error) : 'You can only edit entries you added');
      }
      putTx(normTx(data[0]));
    },
    [putTx],
  );

  const deleteTransaction = useCallback<DataContextValue['deleteTransaction']>(
    async (id) => {
      if (outboxRef.current.some((t) => t.id === id)) {
        setOutbox((o) => o.filter((t) => t.id !== id));
        return;
      }
      const before = snapRef.current.transactions.find((t) => t.id === id);
      dropTx(id);
      const { data, error } = await supabase.from('transactions').delete().eq('id', id).select('id');
      if (error || !data?.length) {
        if (before) putTx(before);
        throw new Error(error ? errorMessage(error) : 'Only the admin can delete entries');
      }
    },
    [putTx, dropTx],
  );

  const saveCategory = useCallback<DataContextValue['saveCategory']>(async ({ id, ...fields }) => {
    const q = id
      ? supabase.from('categories').update(fields).eq('id', id).select()
      : supabase.from('categories').insert(fields).select();
    const { data, error } = await q;
    if (error || !data?.length) throw new Error(error ? errorMessage(error) : "You can't edit this category");
    const saved = normCategory(data[0]);
    setSnap((s) => ({ ...s, categories: sortCategories(upsertById(s.categories, saved)) }));
    return saved;
  }, []);

  const deleteCategory = useCallback<DataContextValue['deleteCategory']>(async (id) => {
    const { data, error } = await supabase.from('categories').delete().eq('id', id).select('id');
    if (error || !data?.length) throw new Error(error ? errorMessage(error) : "You can't delete this category");
    // the database moves its expenses to "Other"; mirror that locally right away
    setSnap((s) => {
      const other = s.categories.find((c) => c.is_system)?.id ?? null;
      return {
        ...s,
        categories: s.categories.filter((c) => c.id !== id),
        limits: s.limits.filter((l) => l.category_id !== id),
        transactions: s.transactions.map((t) => (t.category_id === id ? { ...t, category_id: other } : t)),
        recurring: s.recurring.map((r) => (r.category_id === id ? { ...r, category_id: other } : r)),
      };
    });
  }, []);

  const setLimit = useCallback<DataContextValue['setLimit']>(async (categoryId, month, cents) => {
    const from = monthStart(month);
    // a new limit applies from this month on, replacing any later ones
    const del = await supabase.from('category_limits').delete().eq('category_id', categoryId).gt('effective_from', from);
    if (del.error) throw new Error(errorMessage(del.error));
    const row: CategoryLimit = { category_id: categoryId, effective_from: from, amount_cents: cents };
    const { error } = await supabase.from('category_limits').upsert(row, { onConflict: 'category_id,effective_from' });
    if (error) throw new Error(errorMessage(error));
    setSnap((s) => ({
      ...s,
      limits: [...s.limits.filter((l) => l.category_id !== categoryId || l.effective_from < from), row],
    }));
  }, []);

  const saveRecurring = useCallback<DataContextValue['saveRecurring']>(
    async ({ id, ...fields }) => {
      const q = id
        ? supabase.from('recurring').update(fields).eq('id', id).select()
        : supabase.from('recurring').insert({ ...fields, created_by: userId }).select();
      const { data, error } = await q;
      if (error || !data?.length) throw new Error(error ? errorMessage(error) : 'You can only edit items you created');
      setSnap((s) => ({ ...s, recurring: upsertById(s.recurring, normRecurring(data[0])) }));
      // the item may already be due this month
      await refresh();
    },
    [userId, refresh],
  );

  const deleteRecurring = useCallback<DataContextValue['deleteRecurring']>(async (id) => {
    const { data, error } = await supabase.from('recurring').delete().eq('id', id).select('id');
    if (error || !data?.length) throw new Error(error ? errorMessage(error) : 'You can only delete items you created');
    setSnap((s) => ({
      ...s,
      recurring: s.recurring.filter((r) => r.id !== id),
      transactions: s.transactions.map((t) => (t.recurring_id === id ? { ...t, recurring_id: null } : t)),
    }));
  }, []);

  const rpc = useCallback(async (fn: string, args: Record<string, unknown>) => {
    const { error } = await supabase.rpc(fn, args);
    if (error) throw new Error(errorMessage(error));
  }, []);

  const changeMyPassword = useCallback<DataContextValue['changeMyPassword']>(
    (current, next) => rpc('change_my_password', { p_current: current, p_new: next }),
    [rpc],
  );

  const adminCreateUser = useCallback<DataContextValue['adminCreateUser']>(
    async (u) => {
      await rpc('admin_create_user', {
        p_username: u.username,
        p_password: u.password,
        p_display_name: u.displayName,
        p_is_admin: u.isAdmin,
        p_color: u.color,
      });
      await refresh();
    },
    [rpc, refresh],
  );

  const adminUpdateUser = useCallback<DataContextValue['adminUpdateUser']>(
    async (u) => {
      await rpc('admin_update_user', {
        p_user_id: u.id,
        p_username: u.username,
        p_display_name: u.displayName,
        p_is_admin: u.isAdmin,
        p_active: u.active,
        p_color: u.color,
      });
      await refresh();
    },
    [rpc, refresh],
  );

  const adminSetPassword = useCallback<DataContextValue['adminSetPassword']>(
    (id, password) => rpc('admin_set_password', { p_user_id: id, p_password: password }),
    [rpc],
  );

  const adminDeleteUser = useCallback<DataContextValue['adminDeleteUser']>(
    async (id) => {
      await rpc('admin_delete_user', { p_user_id: id });
      setSnap((s) => ({ ...s, profiles: s.profiles.filter((p) => p.id !== id) }));
    },
    [rpc],
  );

  // ---------------------------------------------------------------- value

  const allTransactions = useMemo(() => {
    if (!outbox.length) return snap.transactions;
    const ids = new Set(snap.transactions.map((t) => t.id));
    return [...snap.transactions, ...outbox.filter((t) => !ids.has(t.id)).map((t) => ({ ...t, pending: true }))];
  }, [snap.transactions, outbox]);

  const me = snap.profiles.find((p) => p.id === userId);

  const value: DataContextValue = {
    ...snap,
    userId,
    me,
    isAdmin: Boolean(me?.is_admin && me.active),
    allTransactions,
    pendingCount: outbox.length,
    ready,
    syncError,
    live,
    refresh,
    ensureYear,
    yearLoading: (y) => loadingYears.includes(y),
    addTransaction,
    updateTransaction,
    deleteTransaction,
    saveCategory,
    deleteCategory,
    setLimit,
    saveRecurring,
    deleteRecurring,
    changeMyPassword,
    adminCreateUser,
    adminUpdateUser,
    adminSetPassword,
    adminDeleteUser,
  };

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}
