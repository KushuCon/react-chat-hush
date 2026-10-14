import { useState } from 'react';
import { storage } from './lib/storage';
import { validateName } from './lib/moderation';
import { ThemeButton } from './ui';
import { Icon } from './ui';

export interface HomeProps {
  initialCode: string;
  online: number | null;
  openRooms: number;
  busy: boolean;
  onCreate: (name: string, pub: boolean, pin: string) => void;
  onJoin: (name: string, code: string, pin: string) => void;
  onRandom: (name: string) => void;
}

export function Home(p: HomeProps) {
  const [name, setName] = useState(storage.get('hush:name') ?? '');
  const [code, setCode] = useState(p.initialCode);
  const [pub, setPub] = useState(false);
  const [lock, setLock] = useState(false);
  const [pin, setPin] = useState('');
  const [joinPin, setJoinPin] = useState('');
  const [needPin, setNeedPin] = useState(false);
  const [err, setErr] = useState('');

  const checkName = (): string | null => {
    const v = validateName(name);
    if (!v.ok) {
      setErr(v.reason);
      return null;
    }
    storage.set('hush:name', v.name);
    setName(v.name);
    setErr('');
    return v.name;
  };

  const create = () => {
    const n = checkName();
    if (!n) return;
    if (lock && !/^\d{4,8}$/.test(pin)) return setErr('A PIN is 4 to 8 digits.');
    p.onCreate(n, pub && !lock, lock ? pin : '');
  };
  const join = (e: React.FormEvent) => {
    e.preventDefault();
    const n = checkName();
    if (!n) return;
    if (!/^[A-Z0-9]{6}$/.test(code)) return setErr('Enter the 6 character room code.');
    if (needPin && !/^\d{4,8}$/.test(joinPin)) return setErr('Enter the 4 to 8 digit PIN.');
    p.onJoin(n, code, needPin ? joinPin : '');
  };
  const random = () => {
    const n = checkName();
    if (n) p.onRandom(n);
  };

  return (
    <main className="home">
      <ThemeButton className="theme-fab" />
      <div className="card">
        <div>
          <h1 className="brand">
            hush<i>.</i>
          </h1>
          <p className="tag">Chats that last 30 minutes and leave no trace.</p>
        </div>

        <div className="field">
          <label htmlFor="name">Your name</label>
          <input
            id="name"
            className="input"
            maxLength={20}
            autoComplete="nickname"
            placeholder="e.g. Priya"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setErr('');
            }}
          />
        </div>
        {err && (
          <p className="err" role="alert">
            {err}
          </p>
        )}

        <div className="field" style={{ gap: 10 }}>
          <button className="btn" onClick={create} disabled={p.busy}>
            Start a new room
          </button>
          <label className="check">
            <input type="checkbox" checked={pub && !lock} disabled={lock} onChange={(e) => setPub(e.target.checked)} />
            Public: let strangers find and join this room
          </label>
          <label className="check">
            <input type="checkbox" checked={lock} onChange={(e) => setLock(e.target.checked)} />
            Lock with a PIN
          </label>
          {lock && (
            <input
              className="input pin"
              inputMode="numeric"
              maxLength={8}
              placeholder="4 to 8 digit PIN"
              aria-label="Room PIN"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            />
          )}
        </div>

        <div className="or">or join with a code</div>
        <form className="joinrow" onSubmit={join}>
          <input
            className="input code"
            maxLength={6}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            placeholder="K7P2QX"
            aria-label="6 character room code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
          />
          <button className="btn ghost" type="submit" disabled={p.busy}>
            Join
          </button>
        </form>
        <label className="check">
          <input type="checkbox" checked={needPin} onChange={(e) => setNeedPin(e.target.checked)} />
          This room has a PIN
        </label>
        {needPin && (
          <input
            className="input pin"
            inputMode="numeric"
            maxLength={8}
            placeholder="PIN"
            aria-label="Room PIN"
            value={joinPin}
            onChange={(e) => setJoinPin(e.target.value.replace(/\D/g, ''))}
          />
        )}

        <div className="or">or meet someone new</div>
        <button className="btn ghost" onClick={random} disabled={p.busy}>
          Join a random room
        </button>
        <p className={'live' + (p.online !== null ? ' on' : '')}>
          <i />
          <span>
            {p.online === null
              ? 'Connecting…'
              : `${p.online} online · ${p.openRooms} open public room${p.openRooms === 1 ? '' : 's'}`}
          </span>
        </p>
        <p className="fine">
          <Icon.Lock /> Peer to peer. No server keeps your messages. Up to 10 people per room. For adults, 18+.
        </p>
      </div>
    </main>
  );
}
