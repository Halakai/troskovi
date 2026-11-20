import { useEffect, useState } from 'react';
import { useData } from '../data/DataProvider';
import { errorMessage } from '../supabase';
import { formatDayHeading, formatMonth, monthOf, todayISO, yearOf } from '../lib/dates';
import { formatMoney, parseAmount } from '../lib/money';
import { navigate } from '../lib/router';
import { categoryResolver, isPlanned } from '../lib/stats';
import { withSubcategories } from '../lib/categories';
import { normalizeText } from '../lib/search';
import type { CategoryKind, Transaction } from '../types';
import { CategoryOptions, Empty, MonthSwitcher, Sheet, TopBar, useLookups } from '../components/ui';
import { TxRow } from '../components/TxRow';
import { CategoryPicker } from '../components/TxSheet';
import { useToast } from '../components/Toast';
import { IconClose, IconSearch } from '../components/Icons';

interface Props {
  month: string;
  setMonth: (m: string) => void;
  params: URLSearchParams;
  onOpen: (tx: Transaction) => void;
}

export function History({ month, setMonth, params, onOpen }: Props) {
  const data = useData();
  const { ensureYear } = data;
  const { category, parent, account, personName } = useLookups();
  const who = params.get('who') ?? 'all';
  const kind = params.get('kind') ?? 'all';
  const cat = params.get('cat') ?? 'all';

  const [query, setQuery] = useState('');
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [moving, setMoving] = useState(false);

  const searching = query.trim() !== '';
  const thisYear = new Date().getFullYear();
  const firstYear = data.firstDate ? yearOf(data.firstDate) : thisYear;

  useEffect(() => ensureYear(yearOf(month)), [month, ensureYear]);
  // a search looks through every year, not just the month on screen
  useEffect(() => {
    if (searching) for (let y = firstYear; y <= thisYear; y++) ensureYear(y);
  }, [searching, firstYear, thisYear, ensureYear]);

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value === 'all') next.delete(key);
    else next.set(key, value);
    if (key === 'kind') next.delete('cat'); // categories differ per type
    const q = next.toString();
    navigate(`/history${q ? `?${q}` : ''}`);
  };

  const people = data.profiles.filter((p) => p.active).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const expenseCats = data.categories.filter((c) => c.kind === 'expense');
  const incomeCats = data.categories.filter((c) => c.kind === 'income');

  const resolve = categoryResolver(data.categories);
  // a main category also shows the entries of its subcategories
  const catIds = withSubcategories(data.categories, cat);
  const matchesCat = (t: Transaction) => {
    if (cat === 'all') return true;
    if (cat.startsWith('acc:')) return t.kind === 'saving' && t.savings_account_id === cat.slice(4);
    if (t.kind === 'saving') return false;
    const c = resolve(t.category_id, t.kind);
    return c !== undefined && catIds.has(c.id);
  };

  // every word has to appear in the note, category, account or person; a number also finds that amount
  const words = normalizeText(query).split(' ').filter(Boolean);
  const cents = parseAmount(query);
  const matchesSearch = (t: Transaction) => {
    if (!searching) return true;
    if (cents !== null && Math.abs(t.amount_cents) === cents) return true;
    const c = t.kind === 'saving' ? undefined : category(t.category_id, t.kind);
    const text = normalizeText(
      [t.note, c?.name, parent(c)?.name, t.kind === 'saving' ? account(t.savings_account_id)?.name : '', personName(t.person_id)]
        .filter(Boolean)
        .join(' '),
    );
    return words.every((w) => text.includes(w));
  };

  const filtered = data.allTransactions
    .filter((t) => searching || monthOf(t.date) === month)
    .filter((t) => who === 'all' || (who === 'shared' ? t.person_id === null : t.person_id === who))
    .filter((t) => kind === 'all' || t.kind === kind)
    .filter(matchesCat)
    .filter(matchesSearch)
    .sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at));

  const days: { date: string; items: Transaction[]; spent: number }[] = [];
  for (const t of filtered) {
    let g = days[days.length - 1];
    if (!g || g.date !== t.date) days.push((g = { date: t.date, items: [], spent: 0 }));
    g.items.push(t);
    if (t.kind === 'expense') g.spent += t.amount_cents;
  }

  // entries dated in the future don't count yet
  const today = todayISO();
  const total = (k: Transaction['kind']) =>
    filtered.filter((t) => t.kind === k && !isPlanned(t, today)).reduce((s, t) => s + t.amount_cents, 0);
  const spent = total('expense');
  const income = total('income');
  const saved = total('saving');
  const filtering = who !== 'all' || kind !== 'all' || cat !== 'all';

  // ---- selecting several entries to move them into another category
  const selectedTxs = data.allTransactions.filter((t) => selected.has(t.id));
  const selectedKind = selectedTxs[0]?.kind as CategoryKind | undefined;
  const canMove = (t: Transaction) =>
    t.kind !== 'saving' && (data.isAdmin || t.created_by === data.userId) && (!selectedKind || t.kind === selectedKind);
  const selectState = (t: Transaction) => (selected.has(t.id) ? 'on' : canMove(t) ? 'off' : 'disabled');
  const toggle = (t: Transaction) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(t.id)) next.delete(t.id);
      else next.add(t.id);
      return next;
    });
  const selectAll = () => {
    const kindToTake = selectedKind ?? filtered.find((t) => t.kind !== 'saving' && canMove(t))?.kind;
    setSelected(new Set([...selected, ...filtered.filter((t) => t.kind === kindToTake && canMove(t)).map((t) => t.id)]));
  };
  const stopSelecting = () => {
    setSelecting(false);
    setSelected(new Set());
  };

  return (
    <>
      <TopBar title={<MonthSwitcher month={month} onChange={setMonth} />} />

      <div className="filters">
        <div className="search-row">
          <label className="search">
            <IconSearch />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search notes, categories, amounts"
              enterKeyHint="search"
              autoComplete="off"
              aria-label="Search all entries"
            />
            {query && (
              <button type="button" className="search-clear" onClick={() => setQuery('')} aria-label="Clear search">
                <IconClose width={18} height={18} />
              </button>
            )}
          </label>
          <button
            type="button"
            className={`select-btn ${selecting ? 'select-btn-on' : ''}`}
            onClick={() => (selecting ? stopSelecting() : setSelecting(true))}
          >
            {selecting ? 'Done' : 'Select'}
          </button>
        </div>
        <div className="chips-scroll">
          {[{ id: 'all', name: 'Everyone' }, ...people.map((p) => ({ id: p.id, name: p.display_name })), { id: 'shared', name: '🤝 Shared' }].map(
            (p) => (
              <button key={p.id} className={`chip ${who === p.id ? 'chip-on' : ''}`} onClick={() => setFilter('who', p.id)}>
                {p.name}
              </button>
            ),
          )}
        </div>
        <div className="filters-row">
          <select className="input input-sm" value={kind} onChange={(e) => setFilter('kind', e.target.value)}>
            <option value="all">All entries</option>
            <option value="expense">Expenses</option>
            <option value="income">Income</option>
            <option value="saving">Savings</option>
          </select>
          <select className="input input-sm" value={cat} onChange={(e) => setFilter('cat', e.target.value)}>
            <option value="all">{kind === 'saving' ? 'All accounts' : 'All categories'}</option>
            {(kind === 'all' || kind === 'expense') && (
              <optgroup label="Expense categories">
                <CategoryOptions categories={expenseCats} />
              </optgroup>
            )}
            {(kind === 'all' || kind === 'income') && (
              <optgroup label="Income categories">
                <CategoryOptions categories={incomeCats} />
              </optgroup>
            )}
            {(kind === 'all' || kind === 'saving') && data.savingsAccounts.length > 0 && (
              <optgroup label="Savings accounts">
                {data.savingsAccounts.map((a) => (
                  <option key={a.id} value={`acc:${a.id}`}>
                    {a.emoji} {a.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </div>
      </div>

      <div className="summary-line">
        <span>
          {filtered.length} {filtered.length === 1 ? 'entry' : 'entries'}
          {searching && ' in all months'}
          {filtering && (
            <button className="link" onClick={() => navigate('/history')}>
              {' '}
              · clear filters
            </button>
          )}
        </span>
        <span>
          {spent > 0 && <b>−{formatMoney(spent)}</b>}
          {income > 0 && <b className="pos"> +{formatMoney(income)}</b>}
          {saved !== 0 && (
            <b className="save">
              {' '}
              🐷 {saved > 0 ? '+' : '−'}
              {formatMoney(Math.abs(saved))}
            </b>
          )}
        </span>
      </div>

      {days.length === 0 ? (
        <div className="card">
          {data.yearLoading(yearOf(month)) ? (
            <Empty emoji="⏳" title="Loading…" />
          ) : (
            <Empty
              emoji="🔍"
              title={
                searching ? `Nothing found for “${query.trim()}”` : filtering ? 'Nothing matches these filters' : `Nothing in ${formatMonth(month)}`
              }
            />
          )}
        </div>
      ) : (
        days.map((d) => (
          <section key={d.date} className="card day">
            <div className="day-head">
              <span>
                {formatDayHeading(d.date)}
                {yearOf(d.date) !== thisYear && ` ${yearOf(d.date)}`}
                {isPlanned(d, today) && (
                  <>
                    {' · '}
                    <span className="text-accent">planned</span>
                  </>
                )}
              </span>
              {d.spent > 0 && <span className={isPlanned(d, today) ? 'dim' : ''}>−{formatMoney(d.spent)}</span>}
            </div>
            {d.items.map((t) => (
              <TxRow
                key={t.id}
                tx={t}
                onClick={() => (selecting ? toggle(t) : onOpen(t))}
                select={selecting ? selectState(t) : undefined}
              />
            ))}
          </section>
        ))
      )}

      {selecting && <div className="select-spacer" />}
      {selecting && (
        <div className="select-bar">
          <span className="grow">
            <b>{selected.size ? `${selected.size} selected` : 'Tap entries to select them'}</b>
            <button className="link block" onClick={selectAll}>
              Select all shown
            </button>
          </span>
          <button className="btn btn-primary" disabled={!selected.size} onClick={() => setMoving(true)}>
            Move to…
          </button>
        </div>
      )}

      {moving && selectedKind && (
        <MoveSheet
          ids={[...selected]}
          kind={selectedKind}
          onClose={() => setMoving(false)}
          onDone={() => {
            setMoving(false);
            stopSelecting();
          }}
        />
      )}
    </>
  );
}

function MoveSheet({ ids, kind, onClose, onDone }: { ids: string[]; kind: CategoryKind; onClose: () => void; onDone: () => void }) {
  const data = useData();
  const toast = useToast();
  const { category } = useLookups();
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pickable = data.categories.filter((c) => c.kind === kind && (c.owner_id === null || c.owner_id === data.userId));
  const what = kind === 'income' ? (ids.length === 1 ? 'income' : 'incomes') : ids.length === 1 ? 'expense' : 'expenses';

  async function move() {
    if (!categoryId) return;
    setBusy(true);
    try {
      const moved = await data.moveTransactions(ids, categoryId);
      const name = category(categoryId, kind)?.name;
      if (moved === ids.length) toast(`Moved ${moved} ${what} to ${name}`);
      else toast(`Moved ${moved} of ${ids.length} – you can only change entries you added`, 'info');
      onDone();
    } catch (e) {
      toast(errorMessage(e), 'error');
      setBusy(false);
    }
  }

  return (
    <Sheet title={`Move ${ids.length} ${what}`} onClose={onClose}>
      <CategoryPicker categories={pickable} value={categoryId} onChange={setCategoryId} error={false} />
      <div className="sheet-actions">
        <button className="btn btn-primary btn-grow" disabled={!categoryId || busy} onClick={move}>
          {busy ? 'Moving…' : 'Move'}
        </button>
      </div>
    </Sheet>
  );
}
