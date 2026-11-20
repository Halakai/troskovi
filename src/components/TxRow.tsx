import type { Transaction } from '../types';
import { formatMoney } from '../lib/money';
import { formatDay, todayISO } from '../lib/dates';
import { isPlanned } from '../lib/stats';
import { CatIcon, useLookups } from './ui';
import { IconCheck, IconClock, IconCloudOff, IconLock, IconRepeat } from './Icons';

/** `select`: the row is in a multi-select list – 'disabled' rows can't be picked. */
export function TxRow({
  tx,
  onClick,
  showDate,
  select,
}: {
  tx: Transaction;
  onClick?: () => void;
  showDate?: boolean;
  select?: 'on' | 'off' | 'disabled';
}) {
  const { category, parent, account, personName, personColor } = useLookups();
  const isSaving = tx.kind === 'saving';
  const cat = isSaving ? undefined : category(tx.category_id, tx.kind === 'income' ? 'income' : 'expense');
  const acc = isSaving ? account(tx.savings_account_id) : undefined;
  const icon = isSaving ? (acc ?? { emoji: '🐷', color: '#14b8a6' }) : cat;
  const title = isSaving ? (acc?.name ?? 'Savings') : (cat?.name ?? 'Other');
  const main = parent(cat);
  const planned = isPlanned(tx, todayISO());
  const label = isSaving ? (tx.amount_cents < 0 ? 'taken out' : 'saved') : null;
  const amount = Math.abs(tx.amount_cents);
  const sign = tx.kind === 'expense' || tx.amount_cents < 0 ? '−' : '+';
  const tone = tx.kind === 'income' ? 'pos' : isSaving ? 'save' : '';

  return (
    <button
      className={`tx ${planned ? 'tx-planned' : ''}`}
      onClick={onClick}
      disabled={select === 'disabled'}
      role={select ? 'checkbox' : undefined}
      aria-checked={select ? select === 'on' : undefined}
    >
      {select && <span className={`tx-check ${select === 'on' ? 'tx-check-on' : ''}`}>{select === 'on' && <IconCheck />}</span>}
      <CatIcon category={icon} />
      <span className="tx-main">
        <span className="tx-title">
          <span className="tx-name">{title}</span>
          {main && <span className="tx-parent">{main.name}</span>}
          {(cat?.owner_id || acc?.owner_id) && <IconLock className="tx-flag" />}
          {planned && <IconClock className="tx-flag" aria-label="planned" />}
          {tx.recurring_id && <IconRepeat className="tx-flag" />}
          {tx.pending && <IconCloudOff className="tx-flag tx-pending" />}
        </span>
        <span className="tx-sub">
          <span className="dot" style={{ background: personColor(tx.person_id) }} />
          {personName(tx.person_id)}
          {label && <> · {label}</>}
          {showDate && <> · {formatDay(tx.date)}</>}
          {tx.note && <> · {tx.note}</>}
        </span>
      </span>
      <span className={`tx-amount ${tone}`}>
        {sign}
        {formatMoney(amount)}
      </span>
    </button>
  );
}
