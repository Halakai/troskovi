import { useState } from 'react';
import { useData } from '../data/DataProvider';
import { errorMessage } from '../supabase';
import type { Kind, Recurring } from '../types';
import { currentMonth, formatMonth, monthStart, ordinal } from '../lib/dates';
import { centsToInput, formatMoney, parseAmount } from '../lib/money';
import { useToast } from '../components/Toast';
import { CatIcon, Empty, Field, Segmented, Sheet, Toggle, TopBar, useLookups } from '../components/ui';
import { IconPlus, IconRight } from '../components/Icons';

export function RecurringSettings() {
  const data = useData();
  const { category, personName } = useLookups();
  const [editing, setEditing] = useState<Recurring | 'new' | null>(null);

  const sorted = [...data.recurring].sort((a, b) => a.day_of_month - b.day_of_month);
  const incomes = sorted.filter((r) => r.kind === 'income');
  const expenses = sorted.filter((r) => r.kind === 'expense');
  const total = (list: Recurring[]) => list.filter((r) => r.active).reduce((s, r) => s + r.amount_cents, 0);

  const row = (r: Recurring) => (
    <button key={r.id} className={`cat-row ${r.active ? '' : 'inactive'}`} onClick={() => setEditing(r)}>
      {r.kind === 'income' ? (
        <span className="cat-icon" style={{ background: '#22c55e26', width: 36, height: 36, fontSize: 18 }}>
          💰
        </span>
      ) : (
        <CatIcon category={category(r.category_id)} size={36} />
      )}
      <span className="grow">
        <span className="cat-row-top">
          <span className="cat-row-name">{r.name}</span>
          <b className={r.kind === 'income' ? 'pos' : ''}>{formatMoney(r.amount_cents)}</b>
        </span>
        <span className="small dim block">
          every {ordinal(r.day_of_month)} · {personName(r.person_id)}
          {!r.active && ' · paused'}
          {r.end_month && ` · until ${formatMonth(r.end_month.slice(0, 7))}`}
        </span>
      </span>
      <IconRight className="dim" />
    </button>
  );

  return (
    <>
      <TopBar
        title="Monthly items"
        back="/settings"
        right={
          <button className="icon-btn" onClick={() => setEditing('new')} aria-label="Add monthly item">
            <IconPlus />
          </button>
        }
      />

      <p className="page-note">
        Things that repeat every month. On their day they're added automatically – and until then the month overview shows
        them as <i>expected</i>. That way an income that arrives mid-month (or a bill at the end of the month) is already
        counted in “left to spend”.
      </p>

      {data.recurring.length === 0 ? (
        <div className="card">
          <Empty emoji="🔁" title="No monthly items yet">
            Add your rent, loan, subscriptions and both salaries.
          </Empty>
        </div>
      ) : (
        <>
          {incomes.length > 0 && (
            <section className="card">
              <div className="card-head">
                <h3>Income</h3>
                <span className="pos small">+{formatMoney(total(incomes), { whole: true })} / month</span>
              </div>
              <div className="cat-list">{incomes.map(row)}</div>
            </section>
          )}
          {expenses.length > 0 && (
            <section className="card">
              <div className="card-head">
                <h3>Bills & fixed costs</h3>
                <span className="small dim">−{formatMoney(total(expenses), { whole: true })} / month</span>
              </div>
              <div className="cat-list">{expenses.map(row)}</div>
            </section>
          )}
        </>
      )}

      <button className="btn btn-primary btn-block" onClick={() => setEditing('new')}>
        Add monthly item
      </button>

      {editing && <RecurringSheet item={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function RecurringSheet({ item, onClose }: { item: Recurring | null; onClose: () => void }) {
  const data = useData();
  const toast = useToast();
  const isNew = item === null;
  const canEdit = isNew || data.isAdmin || item.created_by === data.userId;

  const [kind, setKind] = useState<Kind>(item?.kind ?? 'expense');
  const [name, setName] = useState(item?.name ?? '');
  const [amount, setAmount] = useState(item ? centsToInput(item.amount_cents) : '');
  const [categoryId, setCategoryId] = useState(item?.category_id ?? '');
  const [person, setPerson] = useState(item ? (item.person_id ?? 'shared') : 'shared');
  const [day, setDay] = useState(String(item?.day_of_month ?? 1));
  const [start, setStart] = useState((item?.start_month ?? monthStart(currentMonth())).slice(0, 7));
  const [active, setActive] = useState(item?.active ?? true);
  const [busy, setBusy] = useState(false);

  const people = data.profiles.filter((p) => p.active || p.id === item?.person_id);
  const pickable = data.categories.filter((c) => c.owner_id === null || c.owner_id === data.userId || c.id === item?.category_id);

  async function save() {
    const cents = parseAmount(amount);
    const d = Number(day);
    if (!name.trim()) return toast('Give it a name', 'error');
    if (cents === null) return toast('Enter a valid amount', 'error');
    if (kind === 'expense' && !categoryId) return toast('Pick a category', 'error');
    if (!(d >= 1 && d <= 31)) return toast('Day must be between 1 and 31', 'error');
    if (!/^\d{4}-\d{2}$/.test(start)) return toast('Pick a start month', 'error');
    setBusy(true);
    try {
      await data.saveRecurring({
        id: item?.id,
        kind,
        name: name.trim(),
        amount_cents: cents,
        category_id: kind === 'expense' ? categoryId : null,
        person_id: person === 'shared' ? null : person,
        day_of_month: d,
        start_month: monthStart(start),
        end_month: item?.end_month ?? null,
        active,
      });
      toast(isNew ? 'Monthly item added' : 'Saved');
      onClose();
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!item || !confirm(`Delete "${item.name}"? Entries it already created stay.`)) return;
    setBusy(true);
    try {
      await data.deleteRecurring(item.id);
      toast('Deleted');
      onClose();
    } catch (e) {
      toast(errorMessage(e), 'error');
      setBusy(false);
    }
  }

  return (
    <Sheet title={isNew ? 'New monthly item' : 'Edit monthly item'} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <fieldset className="stack" disabled={!canEdit || busy}>
          <Segmented<Kind>
            value={kind}
            onChange={setKind}
            options={[
              { value: 'expense', label: 'Expense' },
              { value: 'income', label: 'Income' },
            ]}
          />
          <div className="row-2">
            <Field label="Name">
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === 'income' ? 'Salary' : 'Rent'} maxLength={60} />
            </Field>
            <Field label="Amount (€)">
              <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
            </Field>
          </div>

          {kind === 'expense' && (
            <Field label="Category">
              <select className="input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">Choose…</option>
                {pickable.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.emoji} {c.name}
                  </option>
                ))}
              </select>
            </Field>
          )}

          <div>
            <div className="field-label">{kind === 'income' ? 'Whose income' : 'Who pays'}</div>
            <Segmented
              value={person}
              onChange={setPerson}
              options={[
                ...people.map((p) => ({ value: p.id, label: p.display_name, color: p.color })),
                { value: 'shared', label: '🤝 Shared', color: '#94a3b8' },
              ]}
            />
          </div>

          <div className="row-2">
            <Field label="Day of month" hint="31 = last day of the month">
              <select className="input" value={day} onChange={(e) => setDay(e.target.value)}>
                {Array.from({ length: 31 }, (_, i) => (
                  <option key={i + 1} value={i + 1}>
                    {ordinal(i + 1)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="First month">
              <input className="input" type="month" value={start} onChange={(e) => setStart(e.target.value)} />
            </Field>
          </div>
          {isNew && (
            <p className="small dim">
              If the day has already passed in the first month, that month's entry is added right away. Already entered it by
              hand? Start next month instead.
            </p>
          )}

          {!isNew && <Toggle checked={active} onChange={setActive} label="Active" hint="Pause it to stop adding new entries" />}
        </fieldset>

        {!canEdit && <p className="meta">Only the admin or the person who created this item can change it.</p>}

        <div className="sheet-actions">
          {!isNew && canEdit && (
            <button type="button" className="btn btn-danger" onClick={remove} disabled={busy}>
              Delete
            </button>
          )}
          {canEdit && (
            <button className="btn btn-primary btn-grow" disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          )}
        </div>
      </form>
    </Sheet>
  );
}
