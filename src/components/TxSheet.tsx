import { Fragment, useState } from 'react';
import { useData } from '../data/DataProvider';
import { errorMessage } from '../supabase';
import type { Category, CategoryKind, Kind, SavingsAccount, Transaction, TransactionInput } from '../types';
import { centsToInput, parseAmount } from '../lib/money';
import { formatDay, ordinal, todayISO } from '../lib/dates';
import { isMainIn } from '../lib/categories';
import { navigate } from '../lib/router';
import { useToast } from './Toast';
import { DateInput, Field, Segmented, Sheet, Toggle, useLookups } from './ui';
import { IconClock, IconLock } from './Icons';

export interface NewEntryDefaults {
  date?: string;
  kind?: Kind;
  /** savings: put money in or take it out */
  direction?: 'in' | 'out';
  accountId?: string;
}

interface Props {
  tx: Transaction | null;
  /** for new entries */
  defaults?: NewEntryDefaults;
  onClose: () => void;
}

type Direction = 'in' | 'out';

export function TxSheet({ tx, defaults = {}, onClose }: Props) {
  const data = useData();
  const toast = useToast();
  const { category, account, personName, personColor } = useLookups();

  const isNew = tx === null;
  const canEdit = isNew || data.isAdmin || tx.created_by === data.userId;
  const canDelete = !isNew && (data.isAdmin || (tx.pending === true && tx.created_by === data.userId));

  const [kind, setKind] = useState<Kind>(tx?.kind ?? defaults.kind ?? 'expense');
  const [amount, setAmount] = useState(tx ? centsToInput(Math.abs(tx.amount_cents)) : '');
  const [direction, setDirection] = useState<Direction>(tx ? (tx.amount_cents < 0 ? 'out' : 'in') : (defaults.direction ?? 'in'));
  // each list remembers its own pick while switching between Expense and Income
  const [cats, setCats] = useState<Record<CategoryKind, string | null>>({
    expense: tx?.kind === 'expense' ? tx.category_id : null,
    income: tx?.kind === 'income' ? tx.category_id : null,
  });
  const [accountId, setAccountId] = useState<string | null>(tx?.savings_account_id ?? defaults.accountId ?? null);
  // New entries start as the category's default person (the one adding it, or Shared) until
  // the person is picked by hand.
  const defaultPerson = (categoryId: string | null) =>
    data.categories.find((c) => c.id === categoryId)?.default_shared ? 'shared' : data.userId;
  const [person, setPerson] = useState<string>(tx ? (tx.person_id ?? 'shared') : data.userId);
  const [personPicked, setPersonPicked] = useState(!isNew);
  const [date, setDate] = useState(tx?.date ?? defaults.date ?? todayISO());
  const [note, setNote] = useState(tx?.note ?? '');
  const [repeat, setRepeat] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showErrors, setShowErrors] = useState(false);

  const isSaving = kind === 'saving';
  const catKind: CategoryKind = kind === 'income' ? 'income' : 'expense';
  const categoryId = isSaving ? null : cats[catKind];
  const cents = parseAmount(amount);
  const canRepeat = !(isSaving && direction === 'out');

  const txCategory = data.categories.find((c) => c.id === tx?.category_id);
  const pickableCats = data.categories.filter(
    (c) =>
      c.kind === catKind &&
      (c.owner_id === null || c.owner_id === data.userId || c.id === txCategory?.id || c.id === txCategory?.parent_id),
  );
  const pickableAccounts = data.savingsAccounts.filter(
    (a) => (!a.archived && (a.owner_id === null || a.owner_id === data.userId)) || a.id === tx?.savings_account_id,
  );
  const people = data.profiles
    .filter((p) => p.active || p.id === tx?.person_id)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));

  const amountError = showErrors && cents === null;
  const pickError = showErrors && (isSaving ? !accountId : !categoryId);
  const dateError = showErrors && !date;
  const planned = Boolean(date) && date > todayISO();

  const pickCategory = (id: string) => {
    setCats((c) => ({ ...c, [catKind]: id }));
    if (!personPicked) setPerson(defaultPerson(id));
  };
  const changeKind = (k: Kind) => {
    setKind(k);
    if (!personPicked) setPerson(k === 'saving' ? data.userId : defaultPerson(cats[k === 'income' ? 'income' : 'expense']));
  };

  async function save() {
    if (cents === null || (isSaving ? !accountId : !categoryId) || !date) {
      setShowErrors(true);
      return;
    }
    const input: TransactionInput = {
      kind,
      amount_cents: isSaving && direction === 'out' ? -cents : cents,
      category_id: categoryId,
      savings_account_id: isSaving ? accountId : null,
      person_id: person === 'shared' ? null : person,
      date,
      note: note.trim() || null,
    };
    setBusy(true);
    try {
      if (isNew) {
        const recurringName =
          note.trim() ||
          (isSaving
            ? account(accountId)?.name
            : kind === 'income'
              ? `${category(categoryId, 'income')?.name} · ${personName(input.person_id)}`
              : category(categoryId)?.name);
        const result = await data.addTransaction(input, { repeatMonthly: repeat && canRepeat, recurringName });
        if (result === 'queued') toast('No connection – saved on this phone, will upload automatically', 'info');
        else toast(isSaving ? (direction === 'in' ? 'Added to savings' : 'Taken from savings') : kind === 'income' ? 'Income added' : 'Expense added');
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
    if (!tx || !confirm(`Delete this ${tx.kind === 'saving' ? 'savings entry' : tx.kind}? This can't be undone.`)) return;
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

  const newTitle = isSaving ? (direction === 'in' ? 'Add to savings' : 'Take from savings') : kind === 'income' ? 'Add income' : 'Add expense';
  const title = isNew ? newTitle : canEdit ? 'Edit' : 'Details';
  const whoLabel = isSaving ? (direction === 'in' ? 'Who put it in' : 'Who took it out') : kind === 'income' ? 'Whose income' : 'Who paid';
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
            onChange={changeKind}
            options={[
              { value: 'expense', label: 'Expense' },
              { value: 'income', label: 'Income' },
              { value: 'saving', label: 'Savings' },
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

          {isSaving ? (
            <>
              <Segmented<Direction>
                value={direction}
                onChange={setDirection}
                options={[
                  { value: 'in', label: '➕ Put in' },
                  { value: 'out', label: '➖ Take out' },
                ]}
              />
              <AccountPicker
                accounts={pickableAccounts}
                value={accountId}
                onChange={setAccountId}
                error={pickError}
                onCreate={() => {
                  onClose();
                  navigate('/savings?new=1');
                }}
              />
            </>
          ) : (
            <CategoryPicker
              categories={pickableCats}
              value={categoryId}
              onChange={pickCategory}
              error={pickError}
            />
          )}

          <div>
            <div className="field-label">{whoLabel}</div>
            <Segmented
              value={person}
              onChange={(p) => {
                setPerson(p);
                setPersonPicked(true);
              }}
              options={[
                ...people.map((p) => ({ value: p.id, label: p.display_name, color: p.color })),
                { value: 'shared', label: '🤝 Shared', color: personColor(null) },
              ]}
            />
          </div>

          <div className="row-2">
            <Field
              label="Date"
              hint={
                dateError ? (
                  <span className="text-danger">Pick a date</span>
                ) : planned ? (
                  <span className="planned-hint">
                    <IconClock /> Planned – counts from that day on
                  </span>
                ) : undefined
              }
            >
              <DateInput value={date} onChange={setDate} />
            </Field>
            <Field label="Note (optional)">
              <input
                className="input"
                value={note}
                maxLength={200}
                onChange={(e) => setNote(e.target.value)}
                placeholder={isSaving ? 'e.g. bonus' : kind === 'income' ? 'e.g. September' : 'e.g. Lidl'}
              />
            </Field>
          </div>

          {isNew && canRepeat && (
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
            Added by {tx.created_by === data.userId ? 'you' : personName(tx.created_by)}
            {tx.pending ? ' · waiting for connection' : ` · ${formatDay(tx.created_at.slice(0, 10))}`}
            {recurring && <> · from monthly “{recurring.name}”</>}
            {!canEdit && (
              <>
                <br />
                Only the admin or the person who added this can change it.
              </>
            )}
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

const GRID_COLUMNS = 4; // keep in sync with .cat-grid in styles.css

/**
 * Main categories as tiles. A main category with subcategories opens a row of
 * subcategory chips right below its tile row; picking one is optional.
 */
function CategoryPicker({
  categories,
  value,
  onChange,
  error,
}: {
  categories: Category[];
  value: string | null;
  onChange: (id: string) => void;
  error: boolean;
}) {
  const isMain = isMainIn(categories);
  const mains = categories.filter(isMain);
  const picked = categories.find((c) => c.id === value);
  const mainId = picked && !isMain(picked) ? picked.parent_id : (picked?.id ?? null);
  const main = mains.find((c) => c.id === mainId);
  const subs = mainId ? categories.filter((c) => c.parent_id === mainId) : [];
  // the subcategory row goes after the last tile in the picked tile's row
  const at = mains.findIndex((c) => c.id === mainId);
  const rowEnd = at < 0 ? -1 : Math.min(mains.length - 1, Math.floor(at / GRID_COLUMNS) * GRID_COLUMNS + GRID_COLUMNS - 1);

  return (
    <div>
      <div className={`field-label ${error ? 'text-danger' : ''}`}>{error ? 'Pick a category' : 'Category'}</div>
      <div className="cat-grid">
        {mains.map((c, i) => (
          <Fragment key={c.id}>
            <button
              type="button"
              className={`cat-pick ${c.id === mainId ? 'cat-pick-on' : ''}`}
              style={c.id === mainId ? { borderColor: c.color, background: `${c.color}22` } : undefined}
              onClick={() => onChange(c.id)}
              aria-expanded={categories.some((s) => s.parent_id === c.id) ? c.id === mainId : undefined}
            >
              <span className="cat-pick-emoji">{c.emoji}</span>
              <span className="cat-pick-name">
                {c.name}
                {c.owner_id && <IconLock className="tx-flag" />}
              </span>
            </button>
            {i === rowEnd && subs.length > 0 && main && (
              <div className="sub-picks" style={{ borderColor: `${main.color}55` }}>
                {subs.map((s) => (
                  <button
                    type="button"
                    key={s.id}
                    className={`chip ${s.id === value ? 'chip-on' : ''}`}
                    style={s.id === value ? { background: main.color } : undefined}
                    // tapping the picked one again goes back to just the main category
                    onClick={() => onChange(s.id === value ? main.id : s.id)}
                  >
                    {s.emoji} {s.name}
                  </button>
                ))}
              </div>
            )}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

function AccountPicker({
  accounts,
  value,
  onChange,
  error,
  onCreate,
}: {
  accounts: SavingsAccount[];
  value: string | null;
  onChange: (id: string) => void;
  error: boolean;
  onCreate: () => void;
}) {
  if (!accounts.length) {
    return (
      <div className="card-tip notice">
        You don't have a savings account yet.{' '}
        <button type="button" className="link" onClick={onCreate}>
          Create one
        </button>
      </div>
    );
  }
  return (
    <div>
      <div className={`field-label ${error ? 'text-danger' : ''}`}>{error ? 'Pick an account' : 'Savings account'}</div>
      <div className="cat-grid">
        {accounts.map((a) => (
          <button
            type="button"
            key={a.id}
            className={`cat-pick ${a.id === value ? 'cat-pick-on' : ''}`}
            style={a.id === value ? { borderColor: a.color, background: `${a.color}22` } : undefined}
            onClick={() => onChange(a.id)}
          >
            <span className="cat-pick-emoji">{a.emoji}</span>
            <span className="cat-pick-name">
              {a.name}
              {a.owner_id && <IconLock className="tx-flag" />}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
