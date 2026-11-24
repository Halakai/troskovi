// Blocks that the month and year reports share.
import { useState } from 'react';
import { topSpender, type CategoryStat, type PersonStat } from '../lib/stats';
import { formatMoney, percent } from '../lib/money';
import { Avatar, CatIcon, Progress } from './ui';
import { IconDown } from './Icons';

export function PeopleBlock({ people, total }: { people: PersonStat[]; total: number }) {
  const persons = people.filter((p) => p.id !== null);
  const shared = people.find((p) => p.id === null)!;
  const sorted = [...persons].sort((a, b) => b.spent - a.spent);
  const top = topSpender(people, total);
  const verdict =
    top &&
    (top.even
      ? '🤝 Neck and neck – you spend almost exactly the same'
      : `👑 ${top.name} is the bigger spender (+${formatMoney(top.gap, { whole: true })})`);

  return (
    <>
      <div className="stacked">
        {people
          .filter((p) => p.spent > 0)
          .map((p) => (
            <div key={p.id ?? 'shared'} style={{ flexGrow: p.spent, background: p.color }} title={p.name} />
          ))}
      </div>
      {[...sorted, shared].map((p) => (
        <div key={p.id ?? 'shared'} className="person-row">
          <Avatar name={p.name} color={p.color} />
          <span className="grow">
            <b>{p.name}</b>
            <span className="dim small">
              {' '}
              · {p.count} {p.count === 1 ? 'expense' : 'expenses'}
            </span>
          </span>
          <span className="dim small">{percent(p.spent, total)}%</span>
          <b>{formatMoney(p.spent, { whole: true })}</b>
        </div>
      ))}
      {shared.spent > 0 && persons.length > 1 && (
        <div className="fair">
          <div className="fair-title">Fair split – shared costs divided equally</div>
          {persons.map((p) => (
            <div key={p.id} className="fair-row">
              <span className="dot" style={{ background: p.color }} />
              <span className="grow">{p.name}</span>
              <span className="dim small">
                {formatMoney(p.spent, { whole: true })} + {formatMoney(shared.spent / persons.length, { whole: true })}
              </span>
              <b>{formatMoney(p.fairShare, { whole: true })}</b>
            </div>
          ))}
        </div>
      )}
      {verdict && <div className="verdict">{verdict}</div>}
    </>
  );
}

export function CategoryList({
  stats,
  onPick,
  limitLabel = '',
}: {
  stats: CategoryStat[];
  onPick?: (id: string) => void;
  limitLabel?: string;
}) {
  return (
    <div className="cat-list">
      {stats.map((s) => (
        <CategoryItem key={s.category.id} stat={s} onPick={onPick} limitLabel={limitLabel} />
      ))}
    </div>
  );
}

function CategoryItem({ stat: s, onPick, limitLabel }: { stat: CategoryStat; onPick?: (id: string) => void; limitLabel: string }) {
  const [open, setOpen] = useState(false);
  const over = s.subs.filter((x) => x.limit !== null && x.spent > x.limit).length;
  return (
    <div className="cat-item">
      <CategoryRow stat={s} onPick={onPick} limitLabel={limitLabel} />
      {s.subs.length > 0 && (
        <>
          <button className={`cat-expand ${open ? 'cat-expand-open' : ''}`} onClick={() => setOpen(!open)} aria-expanded={open}>
            <IconDown width={16} height={16} />
            {s.subs.filter((x) => !x.general).length} subcategories
            {over > 0 && !open && <span className="text-danger"> · {over} over limit</span>}
          </button>
          {open && (
            <div className="cat-subs">
              {s.subs.map((sub) => (
                <CategoryRow key={sub.general ? 'general' : sub.category.id} stat={sub} onPick={onPick} limitLabel={limitLabel} sub />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function CategoryRow({
  stat: s,
  onPick,
  limitLabel,
  sub,
}: {
  stat: CategoryStat;
  onPick?: (id: string) => void;
  limitLabel: string;
  sub?: boolean;
}) {
  return (
    <button className={`cat-row ${sub ? 'cat-row-sub' : ''}`} onClick={() => onPick?.(s.category.id)}>
      <CatIcon category={s.category} size={sub ? 28 : 36} />
      <span className="grow">
        <span className="cat-row-top">
          <span className="cat-row-name">{s.general ? 'General' : s.category.name}</span>
          <span>
            <b>{formatMoney(s.spent, { whole: s.spent >= 100000 })}</b>
            {s.limit !== null && <span className="dim small"> / {formatMoney(s.limit, { whole: true })}{limitLabel}</span>}
          </span>
        </span>
        {s.limit !== null ? (
          <>
            <Progress value={s.spent} max={s.limit} color={s.category.color} />
            <span className={`small ${s.spent > s.limit ? 'text-danger' : 'dim'}`}>
              {s.spent > s.limit
                ? `${formatMoney(s.spent - s.limit, { whole: true })} over limit`
                : `${formatMoney(s.limit - s.spent, { whole: true })} left`}
            </span>
          </>
        ) : (
          <span className="small dim">
            {s.count} ×{s.general ? ' · no subcategory picked' : s.category.kind === 'expense' && !sub && ' · no limit'}
          </span>
        )}
      </span>
    </button>
  );
}
