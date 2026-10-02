import type { Transaction } from '../types';
import { formatMoney } from '../lib/money';
import { formatDay } from '../lib/dates';
import { CatIcon, useLookups } from './ui';
import { IconCloudOff, IconLock, IconRepeat } from './Icons';

export function TxRow({ tx, onClick, showDate }: { tx: Transaction; onClick?: () => void; showDate?: boolean }) {
  const { category, account, personName, personColor } = useLookups();
  const isSaving = tx.kind === 'saving';
  const cat = isSaving ? undefined : category(tx.category_id, tx.kind === 'income' ? 'income' : 'expense');
  const acc = isSaving ? account(tx.savings_account_id) : undefined;
  const icon = isSaving ? (acc ?? { emoji: '🐷', color: '#14b8a6' }) : cat;
  const title = isSaving ? (acc?.name ?? 'Savings') : (cat?.name ?? 'Other');
  const label = isSaving ? (tx.amount_cents < 0 ? 'taken out' : 'saved') : null;
  const amount = Math.abs(tx.amount_cents);
  const sign = tx.kind === 'expense' || tx.amount_cents < 0 ? '−' : '+';
  const tone = tx.kind === 'income' ? 'pos' : isSaving ? 'save' : '';

  return (
    <button className="tx" onClick={onClick}>
      <CatIcon category={icon} />
      <span className="tx-main">
        <span className="tx-title">
          {title}
          {(cat?.owner_id || acc?.owner_id) && <IconLock className="tx-flag" />}
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
