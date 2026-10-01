import { useState } from 'react';
import { useData } from '../data/DataProvider';
import { errorMessage } from '../supabase';
import type { Profile } from '../types';
import { useToast } from '../components/Toast';
import { Avatar, ColorPicker, Empty, Field, PALETTE, Sheet, Toggle, TopBar } from '../components/ui';
import { IconPlus, IconRight } from '../components/Icons';

export function UsersSettings() {
  const data = useData();
  const [editing, setEditing] = useState<Profile | 'new' | null>(null);

  if (!data.isAdmin) {
    return (
      <>
        <TopBar title="Accounts" back="/settings" />
        <div className="card">
          <Empty emoji="🔒" title="Admins only" />
        </div>
      </>
    );
  }

  const users = [...data.profiles].sort((a, b) => a.created_at.localeCompare(b.created_at));

  return (
    <>
      <TopBar
        title="Accounts"
        back="/settings"
        right={
          <button className="icon-btn" onClick={() => setEditing('new')} aria-label="Create account">
            <IconPlus />
          </button>
        }
      />

      <section className="card">
        <div className="cat-list">
          {users.map((u) => (
            <button key={u.id} className={`cat-row ${u.active ? '' : 'inactive'}`} onClick={() => setEditing(u)}>
              <Avatar name={u.display_name} color={u.color} size={40} />
              <span className="grow">
                <span className="cat-row-name">
                  {u.display_name}
                  {u.id === data.userId && <span className="dim"> (you)</span>}
                </span>
                <span className="small dim block">
                  @{u.username}
                  {u.is_admin && <span className="badge">Admin</span>}
                  {!u.active && <span className="badge badge-off">Disabled</span>}
                </span>
              </span>
              <IconRight className="dim" />
            </button>
          ))}
        </div>
      </section>

      <button className="btn btn-primary btn-block" onClick={() => setEditing('new')}>
        Create account
      </button>

      {editing && <UserSheet user={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function UserSheet({ user, onClose }: { user: Profile | null; onClose: () => void }) {
  const data = useData();
  const toast = useToast();
  const isNew = user === null;
  const isMe = user?.id === data.userId;

  const [username, setUsername] = useState(user?.username ?? '');
  const [name, setName] = useState(user?.display_name ?? '');
  const [color, setColor] = useState(user?.color ?? PALETTE[1]);
  const [isAdmin, setIsAdmin] = useState(user?.is_admin ?? false);
  const [active, setActive] = useState(user?.active ?? true);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<void>, done: string, close = true) {
    setBusy(true);
    try {
      await fn();
      toast(done);
      if (close) onClose();
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  function save() {
    if (isNew) {
      if (password.length < 4) return toast('Password needs at least 4 characters', 'error');
      return run(
        () => data.adminCreateUser({ username, password, displayName: name, isAdmin, color }),
        `Account created – ${name || username} can sign in as "${username.trim().toLowerCase()}"`,
      );
    }
    return run(
      () => data.adminUpdateUser({ id: user.id, username, displayName: name, isAdmin, active, color }),
      'Saved',
    );
  }

  function setNewPassword() {
    if (!user) return;
    if (password.length < 4) return toast('Password needs at least 4 characters', 'error');
    run(() => data.adminSetPassword(user.id, password), `New password set for ${user.display_name}`, false).then(() =>
      setPassword(''),
    );
  }

  function remove() {
    if (!user || !confirm(`Delete ${user.display_name}'s account? This only works if they have no entries yet.`)) return;
    run(() => data.adminDeleteUser(user.id), 'Account deleted');
  }

  return (
    <Sheet title={isNew ? 'Create account' : `Edit ${user.display_name}`} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <fieldset className="stack" disabled={busy}>
          <div className="row-2">
            <Field label="Username" hint="Used to sign in">
              <input
                className="input"
                autoCapitalize="none"
                autoCorrect="off"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                placeholder="ana"
              />
            </Field>
            <Field label="Display name">
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={40} placeholder="Ana" />
            </Field>
          </div>

          {isNew && (
            <Field label="Password">
              <input className="input" type="text" autoCapitalize="none" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </Field>
          )}

          <div>
            <div className="field-label">Color</div>
            <ColorPicker value={color} onChange={setColor} />
          </div>

          <Toggle checked={isAdmin} onChange={setIsAdmin} label="Admin" hint="Can manage accounts and edit or delete any entry" />
          {!isNew && !isMe && (
            <Toggle checked={active} onChange={setActive} label="Account enabled" hint="Disabled accounts can't sign in; their entries stay" />
          )}

          <button className="btn btn-primary btn-block" type="submit">
            {busy ? 'Saving…' : isNew ? 'Create account' : 'Save'}
          </button>

          {!isNew && (
            <div className="subsection">
              <Field label="Set a new password" hint={isMe ? 'Tip: use Settings → Change my password for yourself' : 'They can change it later themselves'}>
                <div className="input-row">
                  <input className="input" type="text" autoCapitalize="none" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="New password" />
                  <button type="button" className="btn" onClick={setNewPassword} disabled={!password}>
                    Set
                  </button>
                </div>
              </Field>
            </div>
          )}

          {!isNew && !isMe && (
            <button type="button" className="btn btn-danger btn-block" onClick={remove}>
              Delete account
            </button>
          )}
        </fieldset>
      </form>
    </Sheet>
  );
}
