import { useState } from 'react';
import { useData } from '../data/DataProvider';
import { errorMessage } from '../supabase';
import type { ThemePref } from '../lib/theme';
import { navigate } from '../lib/router';
import { useToast } from '../components/Toast';
import { Avatar, ColorPicker, Field, Segmented, Sheet, TopBar } from '../components/ui';
import { IconRight } from '../components/Icons';

interface Props {
  theme: ThemePref;
  setTheme: (t: ThemePref) => void;
  onSignOut: () => void;
}

export function Settings({ theme, setTheme, onSignOut }: Props) {
  const data = useData();
  const me = data.me!;
  const [sheet, setSheet] = useState<'password' | 'profile' | null>(null);

  return (
    <>
      <TopBar title="Settings" />

      <section className="card">
        <div className="person-row">
          <Avatar name={me.display_name} color={me.color} size={48} />
          <span className="grow">
            <b className="big">{me.display_name}</b>
            <span className="dim small block">
              @{me.username}
              {me.is_admin && <span className="badge">Admin</span>}
            </span>
          </span>
        </div>
        <div className="menu">
          <button className="menu-item" onClick={() => setSheet('password')}>
            🔑 Change my password <IconRight />
          </button>
          {data.isAdmin && (
            <button className="menu-item" onClick={() => setSheet('profile')}>
              ✏️ Edit my username & name <IconRight />
            </button>
          )}
        </div>
      </section>

      <section className="card">
        <h3>Appearance</h3>
        <Segmented<ThemePref>
          value={theme}
          onChange={setTheme}
          options={[
            { value: 'system', label: 'Auto' },
            { value: 'light', label: '☀️ Light' },
            { value: 'dark', label: '🌙 Dark' },
          ]}
        />
      </section>

      <section className="card">
        <h3>Shared setup</h3>
        <div className="menu">
          <button className="menu-item" onClick={() => navigate('/settings/categories')}>
            🏷️ Categories & monthly limits <IconRight />
          </button>
          <button className="menu-item" onClick={() => navigate('/settings/recurring')}>
            🔁 Monthly items (rent, loan, salary…) <IconRight />
          </button>
        </div>
      </section>

      {data.isAdmin && (
        <section className="card">
          <h3>Admin</h3>
          <div className="menu">
            <button className="menu-item" onClick={() => navigate('/settings/users')}>
              👥 Accounts – create, edit, reset passwords <IconRight />
            </button>
          </div>
        </section>
      )}

      <button className="btn btn-ghost btn-block" onClick={onSignOut}>
        Sign out
      </button>

      <section className="card card-tip small">
        <b>Install on your phone</b>
        <br />
        iPhone: open in Safari → Share → <i>Add to Home Screen</i>.
        <br />
        Android: open in Chrome → ⋮ → <i>Add to Home screen / Install app</i>.
        <div className="dim" style={{ marginTop: 8 }}>
          {data.live ? '🟢 Live – changes from others appear instantly' : '⚪ Not connected right now'}
        </div>
      </section>

      {sheet === 'password' && <PasswordSheet onClose={() => setSheet(null)} />}
      {sheet === 'profile' && <MyProfileSheet onClose={() => setSheet(null)} />}
    </>
  );
}

function PasswordSheet({ onClose }: { onClose: () => void }) {
  const { changeMyPassword } = useData();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const mismatch = repeat.length > 0 && next !== repeat;

  async function save() {
    if (next.length < 4) return toast('The new password needs at least 4 characters', 'error');
    if (next !== repeat) return toast("The new passwords don't match", 'error');
    setBusy(true);
    try {
      await changeMyPassword(current, next);
      toast('Password changed');
      onClose();
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title="Change password" onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Field label="Current password">
          <input className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
        </Field>
        <Field label="New password">
          <input className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />
        </Field>
        <Field label="Repeat new password" hint={mismatch ? <span className="text-danger">Doesn't match</span> : undefined}>
          <input className="input" type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} required />
        </Field>
        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'Saving…' : 'Change password'}
        </button>
      </form>
    </Sheet>
  );
}

function MyProfileSheet({ onClose }: { onClose: () => void }) {
  const { me, adminUpdateUser } = useData();
  const toast = useToast();
  const [username, setUsername] = useState(me!.username);
  const [name, setName] = useState(me!.display_name);
  const [color, setColor] = useState(me!.color);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await adminUpdateUser({ id: me!.id, username, displayName: name, isAdmin: true, active: true, color });
      toast('Saved – use the new username next time you sign in');
      onClose();
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title="My account" onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Field label="Username (for signing in)">
          <input className="input" autoCapitalize="none" autoCorrect="off" value={username} onChange={(e) => setUsername(e.target.value)} required />
        </Field>
        <Field label="Display name">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={40} />
        </Field>
        <div>
          <div className="field-label">My color</div>
          <ColorPicker value={color} onChange={setColor} />
        </div>
        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </form>
    </Sheet>
  );
}
