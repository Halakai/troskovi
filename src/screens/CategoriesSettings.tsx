import { useState } from 'react';
import { useData } from '../data/DataProvider';
import { errorMessage } from '../supabase';
import type { Category, CategoryKind } from '../types';
import { currentMonth, formatMonth } from '../lib/dates';
import { centsToInput, formatMoney, parseAmount } from '../lib/money';
import { limitFor } from '../lib/stats';
import { isMainIn } from '../lib/categories';
import { navigate } from '../lib/router';
import { useToast } from '../components/Toast';
import { CatIcon, ColorPicker, Field, PALETTE, Segmented, Sheet, Toggle, TopBar } from '../components/ui';
import { IconLock, IconPlus, IconRight } from '../components/Icons';

const EMOJIS: Record<CategoryKind, string[]> = {
  expense: ['🛒', '☕', '🍕', '⛽', '🚗', '🏠', '💡', '📱', '💊', '👕', '🎬', '🎁', '✈️', '🧹', '🐶', '👶', '🎓', '💄', '🏋️', '🚬', '🍺', '📚', '🎮', '🏦'],
  income: ['💼', '💰', '🎉', '💻', '🎁', '↩️', '📈', '🏆', '🧾', '🏠', '🚗', '👶', '🎓', '🏦', '💶', '🤝'],
};

type Editing = { category: Category } | { parentId: string | null } | null;

export function CategoriesSettings({ params }: { params: URLSearchParams }) {
  const data = useData();
  const kind: CategoryKind = params.get('kind') === 'income' ? 'income' : 'expense';
  const [editing, setEditing] = useState<Editing>(null);
  const month = currentMonth();

  const list = data.categories.filter((c) => c.kind === kind);
  const isMain = isMainIn(list);
  const mains = list.filter(isMain);
  const childrenOf = (id: string) => list.filter((c) => c.parent_id === id);
  const shared = mains.filter((c) => c.owner_id === null);
  const mine = mains.filter((c) => c.owner_id === data.userId);
  const others = mains.filter((c) => c.owner_id !== null && c.owner_id !== data.userId);
  const ownerName = (id: string) => data.profiles.find((p) => p.id === id)?.display_name ?? '?';

  const row = (c: Category) => {
    const limit = limitFor(data.limits, c.id, month);
    const details = [
      kind === 'expense' && (limit !== null ? `Limit ${formatMoney(limit, { whole: true })} / month` : 'No limit'),
      c.default_shared && '🤝 starts as Shared',
      c.is_system && 'default for deleted categories',
    ].filter(Boolean);
    const child = !isMain(c);
    return (
      <button key={c.id} className={`cat-row ${child ? 'cat-row-child' : ''}`} onClick={() => setEditing({ category: c })}>
        <CatIcon category={c} size={child ? 28 : 36} />
        <span className="grow">
          <span className="cat-row-name">{c.name}</span>
          <span className="small dim block">{details.join(' · ')}</span>
        </span>
        <IconRight className="dim" />
      </button>
    );
  };
  const tree = (list: Category[]) => list.flatMap((c) => [row(c), ...childrenOf(c.id).map(row)]);

  return (
    <>
      <TopBar
        title="Categories"
        back="/settings"
        right={
          <button className="icon-btn" onClick={() => setEditing({ parentId: null })} aria-label="Add category">
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
        everyone. Open a category to give it subcategories, or to move it under another one.
      </p>

      <section className="card">
        <h3>Shared</h3>
        <div className="cat-list">{tree(shared)}</div>
      </section>

      <section className="card">
        <h3>
          My private <IconLock />
        </h3>
        {mine.length ? <div className="cat-list">{tree(mine)}</div> : <p className="small dim">None yet – add one with +</p>}
      </section>

      {others.length > 0 && (
        <section className="card">
          <h3>Other people's private</h3>
          <div className="cat-list">
            {others.map((c) => (
              <div key={c.id}>
                {tree([c])}
                <span className="small dim owner-note">belongs to {ownerName(c.owner_id!)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <button className="btn btn-primary btn-block" onClick={() => setEditing({ parentId: null })}>
        Add {kind} category
      </button>

      {editing && (
        <CategorySheet
          // a fresh sheet when switching from a category to "add a subcategory" to it
          key={'category' in editing ? editing.category.id : `new-${editing.parentId}`}
          category={'category' in editing ? editing.category : null}
          parentId={'category' in editing ? editing.category.parent_id : editing.parentId}
          kind={kind}
          onAddSub={(parentId) => setEditing({ parentId })}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function CategorySheet({
  category,
  parentId: initialParent,
  kind,
  onAddSub,
  onClose,
}: {
  category: Category | null;
  parentId: string | null;
  kind: CategoryKind;
  onAddSub: (parentId: string) => void;
  onClose: () => void;
}) {
  const data = useData();
  const toast = useToast();
  const month = currentMonth();
  const isNew = category === null;
  const currentLimit = category ? limitFor(data.limits, category.id, month) : null;
  const otherName = kind === 'income' ? 'Other income' : 'Other';
  const startParent = data.categories.find((c) => c.id === initialParent);

  const canEdit = isNew || data.isAdmin || category.owner_id === null || category.owner_id === data.userId;
  const canDelete = !isNew && !category.is_system && (data.isAdmin || category.owner_id === data.userId);
  const canChangePrivacy = !category?.is_system && (isNew || data.isAdmin || category.owner_id === data.userId);

  const children = category ? data.categories.filter((c) => c.parent_id === category.id) : [];
  // main categories this one can go under: same list, not itself, visible to me
  const possibleParents = data.categories.filter(
    (c) =>
      c.kind === kind &&
      !c.parent_id &&
      c.id !== category?.id &&
      (c.owner_id === null || c.owner_id === data.userId || c.id === initialParent),
  );

  const [name, setName] = useState(category?.name ?? '');
  const [emoji, setEmoji] = useState(category?.emoji ?? startParent?.emoji ?? '🏷️');
  const [color, setColor] = useState(category?.color ?? PALETTE[Math.floor(Math.random() * PALETTE.length)]);
  const [isPrivate, setIsPrivate] = useState(Boolean(category?.owner_id));
  const [parentId, setParentId] = useState<string | null>(initialParent);
  const [defaultShared, setDefaultShared] = useState(category?.default_shared ?? startParent?.default_shared ?? false);
  const [limit, setLimitText] = useState(currentLimit !== null ? centsToInput(currentLimit) : '');
  const [busy, setBusy] = useState(false);

  const parent = data.categories.find((c) => c.id === parentId);
  const isSub = Boolean(parent);
  const canMove = !category?.is_system && children.length === 0;

  async function save() {
    const limitCents = limit.trim() ? parseAmount(limit) : null;
    if (limit.trim() && limitCents === null) return toast('The limit is not a valid amount', 'error');
    setBusy(true);
    try {
      // a subcategory is shared/private and colored like its main category
      const owner = parent ? parent.owner_id : isPrivate ? (category?.owner_id ?? data.userId) : null;
      const saved = await data.saveCategory({
        id: category?.id,
        name: name.trim(),
        emoji: firstEmoji(emoji) || '🏷️',
        color: parent ? parent.color : color,
        owner_id: owner,
        kind: category?.kind ?? kind,
        parent_id: parent ? parent.id : null,
        default_shared: defaultShared,
      });
      if (kind === 'expense' && limitCents !== currentLimit) await data.setLimit(saved.id, month, limitCents);
      toast(isNew ? (parent ? 'Subcategory added' : 'Category added') : 'Saved');
      onClose();
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!category) return;
    const stored = data.categories.find((c) => c.id === category.parent_id);
    const question = stored
      ? `Delete "${category.name}"? Its entries will move to "${stored.name}".`
      : children.length
        ? `Delete "${category.name}" and its ${children.length} ${children.length === 1 ? 'subcategory' : 'subcategories'}? All their entries will move to "${otherName}".`
        : `Delete "${category.name}"? Its entries will move to "${otherName}".`;
    if (!confirm(question)) return;
    setBusy(true);
    try {
      await data.deleteCategory(category.id);
      toast(`Deleted – entries moved to ${stored?.name ?? otherName}`);
      onClose();
    } catch (e) {
      toast(errorMessage(e), 'error');
      setBusy(false);
    }
  }

  const title = isNew ? (isSub ? 'New subcategory' : `New ${kind} category`) : isSub ? 'Edit subcategory' : 'Edit category';

  return (
    <Sheet title={title} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <fieldset className="stack" disabled={!canEdit || busy}>
          <div className="cat-preview">
            <CatIcon category={{ emoji: firstEmoji(emoji) || '🏷️', color: parent?.color ?? color }} size={56} />
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

          {!isSub && (
            <div>
              <div className="field-label">Color</div>
              <ColorPicker value={color} onChange={setColor} />
            </div>
          )}

          {canMove && (
            <Field
              label="Main category"
              hint={
                isSub
                  ? `A subcategory: it counts towards ${parent!.name} and is ${parent!.owner_id ? 'private' : 'shared'} like it.`
                  : !isNew && 'Pick one to turn this into its subcategory – all its entries come along.'
              }
            >
              <select className="input" value={parentId ?? ''} onChange={(e) => setParentId(e.target.value || null)}>
                <option value="">— none, this is a main category —</option>
                {possibleParents.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.emoji} {c.name}
                  </option>
                ))}
              </select>
            </Field>
          )}

          {kind === 'expense' && (
            <Field
              label="Monthly limit (optional)"
              hint={`Applies from ${formatMonth(month)} on – earlier months keep their old limit${isSub ? '. It is separate from the main category’s limit.' : ''}`}
            >
              <input className="input" inputMode="decimal" placeholder="e.g. 300" value={limit} onChange={(e) => setLimitText(e.target.value)} />
            </Field>
          )}

          <Toggle
            checked={defaultShared}
            onChange={setDefaultShared}
            label="New entries start as 🤝 Shared"
            hint="Otherwise they start as the person adding them. It can always be changed per entry."
          />

          {canChangePrivacy && !isSub && (
            <Toggle
              checked={isPrivate}
              onChange={setIsPrivate}
              label="Private category"
              hint={children.length ? 'Only shown in your own category list – its subcategories too' : 'Only shown in your own category list'}
            />
          )}
        </fieldset>

        {!canEdit && <p className="meta">This is someone else's private category.</p>}

        {!isNew && !isSub && canEdit && (
          <div className="sub-list">
            <div className="field-label">Subcategories</div>
            {children.length > 0 && (
              <div className="sub-list-chips">
                {children.map((c) => (
                  <span key={c.id} className="chip">
                    {c.emoji} {c.name}
                  </span>
                ))}
              </div>
            )}
            <button type="button" className="btn btn-ghost btn-block" onClick={() => onAddSub(category.id)} disabled={busy}>
              <IconPlus width={18} height={18} /> Add subcategory
            </button>
          </div>
        )}

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
