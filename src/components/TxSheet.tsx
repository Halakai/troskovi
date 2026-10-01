import { useState } from 'react';
import { useData } from '../data/DataProvider';
import { errorMessage } from '../supabase';
import type { Kind, Transaction, TransactionInput } from '../types';
import { centsToInput, parseAmount } from '../lib/money';
import { formatDay, ordinal, todayISO } from '../lib/dates';
import { useToast } from './Toast';
import { Field, Segmented, Sheet, Toggle, useLookups } from './ui';
import { IconLock } from './Icons';

export function TxSheet({ tx, onClose }: { tx: Transaction | null; onClose: () => void }) {
  const data = useData();
  const toast = useToast();
  const { category, personName, personColor } = useLookups();

  const isNew = tx === null;
  const canEdit = isNew || data.isAdmin || tx.created_by === data.userId;
  const canDelete = !isNew && (data.isAdmin || (tx.pending === true && tx.created_by === data.userId));

  const [kind, setKind] = useState<Kind>(tx?.kind ?? 'expense');
  const [amount, setAmount] = useState(tx ? centsToInput(tx.amount_cents) : '');
  const [categoryId, setCategoryId] = useState<string | null>(tx?.category_id ?? null);
  const [person, setPerson] = useState<string>(tx ? (tx.person_id ?? 'shared') : data.userId);
  const [date, setDate] = useState(tx?.date ?? todayISO());
  const [note, setNote] = useState(tx?.note ?? '');
  const [repeat, setRepeat] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showErrors, setShowErrors] = useState(false);

  const cents = parseAmount(amount);
  const pickable = data.categories.filter(
    (c) => c.owner_id === null || c.owner_id === data.userId || c.id === tx?.category_id,
  );
  const people = data.profiles
    .filter((p) => p.active || p.id === tx?.person_id)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const amountError = showErrors && cents === null;
  const categoryError = showErrors && kind === 'expense' && !categoryId;

  async function save() {
    if (cents === null || (kind === 'expense' && !categoryId) || !date) {
      setShowErrors(true);
      return;
    }
    const input: TransactionInput = {
      kind,
      amount_cents: cents,
      category_id: kind === 'expense' ? categoryId : null,
      person_id: person === 'shared' ? null : person,
      date,
      note: note.trim() || null,
    };
    setBusy(true);
    try {
      if (isNew) {
        const recurringName =
          note.trim() || (kind === 'income' ? `${personName(input.person_id)} – income` : category(categoryId)?.name);
        const result = await data.addTransaction(input, { repeatMonthly: repeat, recurringName });
        if (result === 'queued') toast('No connection – saved on this phone, will upload automatically', 'info');
        else toast(kind === 'income' ? 'Income added' : 'Expense added');
      } else {
        await data.updateTransaction(tx.id, input);
        toast('Saved');
      }
      onClose();
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!tx || !confirm(`Delete this ${tx.kind}? This can't be undone.`)) return;
    setBusy(true);
    try {
      await data.deleteTransaction(tx.id);
      toast('Deleted');
      onClose();
    } catch (e) {
      toast(errorMessage(e), 'error');
      setBusy(false);
    }
  }

  const title = isNew ? (kind === 'income' ? 'Add income' : 'Add expense') : canEdit ? 'Edit' : 'Details';
  const recurring = tx?.recurring_id ? data.recurring.find((r) => r.id === tx.recurring_id) : undefined;

  return (
    <Sheet title={title} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <fieldset disabled={!canEdit || busy} className="stack">
          <Segmented<Kind>
            value={kind}
            onChange={setKind}
            options={[
              { value: 'expense', label: 'Expense' },
              { value: 'income', label: 'Income' },
            ]}
          />

          <div className={`amount ${amountError ? 'invalid' : ''}`}>
            <span className="amount-currency">€</span>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              enterKeyHint="done"
              autoComplete="off"
              placeholder="0.00"
              autoFocus={isNew}
              aria-label="Amount"
            />
          </div>

          {kind === 'expense' && (
            <div>
              <div className={`field-label ${categoryError ? 'text-danger' : ''}`}>
                {categoryError ? 'Pick a category' : 'Category'}
              </div>
              <div className="cat-grid">
                {pickable.map((c) => (
                  <button
                    type="button"
                    key={c.id}
                    className={`cat-pick ${c.id === categoryId ? 'cat-pick-on' : ''}`}
                    style={c.id === categoryId ? { borderColor: c.color, background: `${c.color}22` } : undefined}
                    onClick={() => setCategoryId(c.id)}
                  >
                    <span className="cat-pick-emoji">{c.emoji}</span>
                    <span className="cat-pick-name">
                      {c.name}
                      {c.owner_id && <IconLock className="tx-flag" />}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="field-label">{kind === 'income' ? 'Whose income' : 'Who paid'}</div>
            <Segmented
              value={person}
              onChange={setPerson}
              options={[
                ...people.map((p) => ({ value: p.id, label: p.display_name, color: p.color })),
                { value: 'shared', label: '🤝 Shared', color: personColor(null) },
              ]}
            />
          </div>

          <div className="row-2">
            <Field label="Date">
              <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} required />
            </Field>
            <Field label="Note (optional)">
              <input
                className="input"
                value={note}
                maxLength={200}
                onChange={(e) => setNote(e.target.value)}
                placeholder={kind === 'income' ? 'Salary' : 'e.g. Lidl'}
              />
            </Field>
          </div>

          {isNew && (
            <Toggle
              checked={repeat}
              onChange={setRepeat}
              label="Repeat every month"
              hint={`Added automatically on the ${ordinal(Number(date.slice(8, 10)) || 1)} of each month`}
            />
          )}
        </fieldset>

        {!isNew && (
          <p className="meta">
            Added by {personNameOrYou(tx.created_by, data.userId, personName)}
            {tx.pending ? ' · waiting for connection' : ` · ${formatDay(tx.created_at.slice(0, 10))}`}
            {recurring && <> · from monthly “{recurring.name}”</>}
            {!canEdit && <><br />Only the admin or the person who added this can change it.</>}
          </p>
        )}

        <div className="sheet-actions">
          {canDelete && (
            <button type="button" className="btn btn-danger" onClick={remove} disabled={busy}>
              Delete
            </button>
          )}
          {canEdit && (
            <button type="submit" className="btn btn-primary btn-grow" disabled={busy}>
              {busy ? 'Saving…' : isNew ? 'Add' : 'Save'}
            </button>
          )}
        </div>
      </form>
    </Sheet>
  );
}

function personNameOrYou(id: string, me: string, personName: (id: string | null) => string) {
  return id === me ? 'you' : personName(id);
}
