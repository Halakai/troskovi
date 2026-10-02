import { useState } from 'react';
import { useData } from '../data/DataProvider';
import { errorMessage } from '../supabase';
import type { Category, CategoryKind } from '../types';
import { currentMonth, formatMonth } from '../lib/dates';
import { centsToInput, formatMoney, parseAmount } from '../lib/money';
import { limitFor } from '../lib/stats';
import { navigate } from '../lib/router';
import { useToast } from '../components/Toast';
import { CatIcon, ColorPicker, Field, PALETTE, Segmented, Sheet, Toggle, TopBar } from '../components/ui';
import { IconLock, IconPlus, IconRight } from '../components/Icons';

const EMOJIS: Record<CategoryKind, string[]> = {
  expense: ['🛒', '☕', '🍕', '⛽', '🚗', '🏠', '💡', '📱', '💊', '👕', '🎬', '🎁', '✈️', '🧹', '🐶', '👶', '🎓', '💄', '🏋️', '🚬', '🍺', '📚', '🎮', '🏦'],
  income: ['💼', '💰', '🎉', '💻', '🎁', '↩️', '📈', '🏆', '🧾', '🏠', '🚗', '👶', '🎓', '🏦', '💶', '🤝'],
};

export function CategoriesSettings({ params }: { params: URLSearchParams }) {
  const data = useData();
  const kind: CategoryKind = params.get('kind') === 'income' ? 'income' : 'expense';
  const [editing, setEditing] = useState<Category | 'new' | null>(null);
  const month = currentMonth();

  const list = data.categories.filter((c) => c.kind === kind);
  const shared = list.filter((c) => c.owner_id === null);
  const mine = list.filter((c) => c.owner_id === data.userId);
  const others = list.filter((c) => c.owner_id !== null && c.owner_id !== data.userId);
  const ownerName = (id: string) => data.profiles.find((p) => p.id === id)?.display_name ?? '?';

  const row = (c: Category) => {
    const limit = limitFor(data.limits, c.id, month);
    return (
      <button key={c.id} className="cat-row" onClick={() => setEditing(c)}>
        <CatIcon category={c} size={36} />
        <span className="grow">
          <span className="cat-row-name">{c.name}</span>
          <span className="small dim block">
            {kind === 'expense' && (limit !== null ? `Limit ${formatMoney(limit, { whole: true })} / month` : 'No limit')}
            {c.is_system && (kind === 'expense' ? ' · ' : '') + 'default for deleted categories'}
          </span>
        </span>
        <IconRight className="dim" />
      </button>
    );
  };

  return (
    <>
      <TopBar
        title="Categories"
        back="/settings"
        right={
          <button className="icon-btn" onClick={() => setEditing('new')} aria-label="Add category">
            <IconPlus />
          </button>
        }
      />

      <div className="tabs">
        <Segmented<CategoryKind>
          value={kind}
          onChange={(k) => navigate(`/settings/categories${k === 'income' ? '?kind=income' : ''}`)}
          options={[
            { value: 'expense', label: 'Expenses' },
            { value: 'income', label: 'Income' },
          ]}
        />
      </div>

      <p className="page-note">
        {kind === 'expense' ? 'Expense' : 'Income'} categories are a separate list. Shared ones are visible to everyone;
        private ones appear only in your own list when adding an entry – but the entries themselves are still visible to
        everyone.
      </p>

      <section className="card">
        <h3>Shared</h3>
        <div className="cat-list">{shared.map(row)}</div>
      </section>

      <section className="card">
        <h3>
          My private <IconLock />
        </h3>
        {mine.length ? <div className="cat-list">{mine.map(row)}</div> : <p className="small dim">None yet – add one with +</p>}
      </section>

      {others.length > 0 && (
        <section className="card">
          <h3>Other people's private</h3>
          <div className="cat-list">
            {others.map((c) => (
              <div key={c.id}>
                {row(c)}
                <span className="small dim owner-note">belongs to {ownerName(c.owner_id!)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <button className="btn btn-primary btn-block" onClick={() => setEditing('new')}>
        Add {kind} category
      </button>

      {editing && <CategorySheet category={editing === 'new' ? null : editing} kind={kind} onClose={() => setEditing(null)} />}
    </>
  );
}

function CategorySheet({ category, kind, onClose }: { category: Category | null; kind: CategoryKind; onClose: () => void }) {
  const data = useData();
  const toast = useToast();
  const month = currentMonth();
  const isNew = category === null;
  const currentLimit = category ? limitFor(data.limits, category.id, month) : null;
  const otherName = kind === 'income' ? 'Other income' : 'Other';

  const canEdit = isNew || data.isAdmin || category.owner_id === null || category.owner_id === data.userId;
  const canDelete = !isNew && !category.is_system && (data.isAdmin || category.owner_id === data.userId);
  const canChangePrivacy = !category?.is_system && (isNew || data.isAdmin || category.owner_id === data.userId);

  const [name, setName] = useState(category?.name ?? '');
  const [emoji, setEmoji] = useState(category?.emoji ?? '🏷️');
  const [color, setColor] = useState(category?.color ?? PALETTE[Math.floor(Math.random() * PALETTE.length)]);
  const [isPrivate, setIsPrivate] = useState(Boolean(category?.owner_id));
  const [limit, setLimitText] = useState(currentLimit !== null ? centsToInput(currentLimit) : '');
  const [busy, setBusy] = useState(false);

  async function save() {
    const limitCents = limit.trim() ? parseAmount(limit) : null;
    if (limit.trim() && limitCents === null) return toast('The limit is not a valid amount', 'error');
    setBusy(true);
    try {
      const owner = isPrivate ? (category?.owner_id ?? data.userId) : null;
      const saved = await data.saveCategory({
        id: category?.id,
        name: name.trim(),
        emoji: firstEmoji(emoji) || '🏷️',
        color,
        owner_id: owner,
        kind: category?.kind ?? kind,
      });
      if (kind === 'expense' && limitCents !== currentLimit) await data.setLimit(saved.id, month, limitCents);
      toast(isNew ? 'Category added' : 'Saved');
      onClose();
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!category || !confirm(`Delete "${category.name}"? Its entries will move to "${otherName}".`)) return;
    setBusy(true);
    try {
      await data.deleteCategory(category.id);
      toast(`Deleted – entries moved to ${otherName}`);
      onClose();
    } catch (e) {
      toast(errorMessage(e), 'error');
      setBusy(false);
    }
  }

  return (
    <Sheet title={isNew ? `New ${kind} category` : 'Edit category'} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <fieldset className="stack" disabled={!canEdit || busy}>
          <div className="cat-preview">
            <CatIcon category={{ ...(category ?? ({} as Category)), emoji: firstEmoji(emoji) || '🏷️', color }} size={56} />
            <input className="input grow" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={40} />
          </div>

          <div>
            <div className="field-label">Icon – pick one or type any emoji</div>
            <div className="emoji-grid">
              {EMOJIS[kind].map((e) => (
                <button type="button" key={e} className={`emoji ${e === emoji ? 'emoji-on' : ''}`} onClick={() => setEmoji(e)}>
                  {e}
                </button>
              ))}
              <input className="input emoji-input" value={emoji} onChange={(e) => setEmoji(e.target.value)} aria-label="Custom emoji" />
            </div>
          </div>

          <div>
            <div className="field-label">Color</div>
            <ColorPicker value={color} onChange={setColor} />
          </div>

          {kind === 'expense' && (
            <Field label="Monthly limit (optional)" hint={`Applies from ${formatMonth(month)} on – earlier months keep their old limit`}>
              <input className="input" inputMode="decimal" placeholder="e.g. 300" value={limit} onChange={(e) => setLimitText(e.target.value)} />
            </Field>
          )}

          {canChangePrivacy && (
            <Toggle
              checked={isPrivate}
              onChange={setIsPrivate}
              label="Private category"
              hint="Only shown in your own category list"
            />
          )}
        </fieldset>

        {!canEdit && <p className="meta">This is someone else's private category.</p>}

        <div className="sheet-actions">
          {canDelete && (
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

function firstEmoji(s: string): string {
  const t = s.trim();
  if (!t) return '';
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    for (const { segment } of seg.segment(t)) return segment;
  }
  return Array.from(t)[0];
}
