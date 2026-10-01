import type { Transaction } from '../types';
import { formatMoney } from '../lib/money';
import { formatDay } from '../lib/dates';
import { CatIcon, useLookups } from './ui';
import { IconCloudOff, IconLock, IconRepeat } from './Icons';

export function TxRow({ tx, onClick, showDate }: { tx: Transaction; onClick?: () => void; showDate?: boolean }) {
  const { category, personName, personColor } = useLookups();
  const cat = tx.kind === 'income' ? undefined : category(tx.category_id);
  const title = tx.kind === 'income' ? tx.note || 'Income' : cat?.name ?? 'Other';
  const subtitle = tx.kind === 'income' ? null : tx.note;

  return (
    <button className="tx" onClick={onClick}>
      {tx.kind === 'income' ? (
        <span className="cat-icon" style={{ background: '#22c55e26', width: 40, height: 40, fontSize: 20 }}>
          💰
        </span>
      ) : (
        <CatIcon category={cat} />
      )}
      <span className="tx-main">
        <span className="tx-title">
          {title}
          {cat?.owner_id && <IconLock className="tx-flag" />}
          {tx.recurring_id && <IconRepeat className="tx-flag" />}
          {tx.pending && <IconCloudOff className="tx-flag tx-pending" />}
        </span>
        <span className="tx-sub">
          <span className="dot" style={{ background: personColor(tx.person_id) }} />
          {personName(tx.person_id)}
          {showDate && <> · {formatDay(tx.date)}</>}
          {subtitle && <> · {subtitle}</>}
        </span>
      </span>
      <span className={`tx-amount ${tx.kind === 'income' ? 'pos' : ''}`}>
        {tx.kind === 'income' ? '+' : '−'}
        {formatMoney(tx.amount_cents)}
      </span>
    </button>
  );
}
