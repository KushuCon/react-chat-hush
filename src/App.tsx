import { useCallback, useEffect, useRef, useState } from 'react';
import { RoomClient, type TrysteroModule } from './lib/RoomClient';
import { Lobby } from './lib/Lobby';
import { storage } from './lib/storage';
import { newCode } from './lib/util';
import type { EndReason, Status } from './lib/types';
import { unlockAudio } from './lib/sound';
import { Home } from './Home';
import { Chat } from './Chat';
import { Overlay } from './ui';

const END_COPY: Record<Exclude<EndReason, 'left'>, { title: string; body: string }> = {
  time: { title: 'Time is up', body: 'This room has closed and the chat has been cleared from this device.' },
  full: { title: 'This room is full', body: 'A room holds 10 people. Try another code, or start your own.' }
};

interface Active {
  code: string;
  name: string;
  pub: boolean;
  pin: string;
}

export function App() {
  const [adult, setAdult] = useState(storage.get('hush:adult') === '1');
  const [client, setClient] = useState<RoomClient | null>(null);
  const [ended, setEnded] = useState<Exclude<EndReason, 'left'> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [, tick] = useState(0);

  const tRef = useRef<TrysteroModule | null>(null);
  const loading = useRef<Promise<TrysteroModule> | null>(null);
  const lobbyRef = useRef<Lobby | null>(null);
  const clientRef = useRef<RoomClient | null>(null);
  const migrating = useRef(false);

  const getT = useCallback((): Promise<TrysteroModule> => {
    if (tRef.current) return Promise.resolve(tRef.current);
    loading.current ??= import('trystero').then((m) => {
      tRef.current = m as unknown as TrysteroModule;
      return tRef.current;
    });
    return loading.current;
  }, []);

  const ownStatus = useCallback((): Status => {
    const c = clientRef.current;
    return c && !c.closed ? c.status() : { code: null, count: 0, created: Date.now() };
  }, []);

  const begin = useCallback(
    async (a: Active, creator: boolean, note?: string) => {
      let t: TrysteroModule;
      try {
        t = await getT();
      } catch {
        setError('Could not load the connection library. Check your internet and try again.');
        return;
      }
      clientRef.current?.dispose();
      const c = new RoomClient({
        t,
        code: a.code,
        name: a.name,
        creator,
        pub: a.pub,
        pin: a.pin,
        note,
        onStatus: () => {
          lobbyRef.current?.broadcast();
          maybeMigrate();
        },
        onEnd: (reason) => {
          if (clientRef.current === c) clientRef.current = null;
          setClient(null);
          history.replaceState(null, '', location.pathname);
          if (reason !== 'left') setEnded(reason);
          lobbyRef.current?.broadcast();
        }
      });
      clientRef.current = c;
      setClient(c);
      setError('');
      storage.setJSON('hush:active', a);
      history.replaceState(null, '', '#' + a.code);
      lobbyRef.current?.broadcast();
    },
    // maybeMigrate is stable (refs only)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [getT]
  );

  /* Two people who each started a public room while alone would never meet.
     The one in the newer room moves to the older one, so they always converge. */
  const maybeMigrate = useCallback(() => {
    const c = clientRef.current;
    const l = lobbyRef.current;
    if (!c || !l || migrating.current || !c.canMigrate()) return;
    const mine = c.status();
    const better = l
      .openRooms()
      .filter((r) => r.code !== c.code && (r.created < mine.created || (r.created === mine.created && r.code < c.code)))
      .sort((a, b) => a.created - b.created || (a.code < b.code ? -1 : 1))[0];
    if (!better) return;
    migrating.current = true;
    const name = c.myName;
    void begin({ code: better.code, name, pub: true, pin: '' }, false, 'Found someone. You moved into their room.').finally(() => {
      migrating.current = false;
    });
  }, [begin]);

  /* Lobby: live online count and public rooms */
  useEffect(() => {
    let dead = false;
    void getT()
      .then((t) => {
        if (dead) return;
        lobbyRef.current = new Lobby(t, ownStatus, () => {
          tick((n) => n + 1);
          maybeMigrate();
        });
        lobbyRef.current.broadcast();
        tick((n) => n + 1);
      })
      .catch(() => {});
    return () => {
      dead = true;
      lobbyRef.current?.leave();
      lobbyRef.current = null;
    };
  }, [getT, ownStatus, maybeMigrate]);

  /* Rejoin after a refresh while the session is still running */
  useEffect(() => {
    storage.purgeExpired();
    const a = storage.getJSON<Active>('hush:active');
    if (!a || !storage.get('hush:room:' + a.code) || storage.get('hush:adult') !== '1') {
      if (a) storage.del('hush:active');
      return;
    }
    void begin(a, false);
    // run once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const leave = () => {
      clientRef.current?.dispose();
      lobbyRef.current?.leave();
    };
    window.addEventListener('pagehide', leave);
    return () => window.removeEventListener('pagehide', leave);
  }, []);

  const run = async (f: () => Promise<void>) => {
    unlockAudio();
    setBusy(true);
    try {
      await f();
    } finally {
      setBusy(false);
    }
  };

  const onRandom = (name: string) =>
    run(async () => {
      const l = lobbyRef.current;
      const open = l ? l.openRooms() : [];
      const waiting = open.filter((r) => r.count === 1);
      const pool = waiting.length ? waiting : open;
      if (pool.length) {
        const r = pool[Math.floor(Math.random() * pool.length)];
        await begin({ code: r.code, name, pub: true, pin: '' }, false, 'Joined a random public room.');
      } else {
        await begin(
          { code: newCode(), name, pub: true, pin: '' },
          true,
          'No one else is waiting yet. Stay here and the next person who taps Random will join you.'
        );
      }
    });

  const initial = (location.hash || '').replace('#', '').toUpperCase();
  const initialCode = /^[A-Z0-9]{6}$/.test(initial) ? initial : '';
  const l = lobbyRef.current;

  return (
    <>
      {client ? (
        <Chat key={client.code} client={client} />
      ) : (
        <Home
          initialCode={initialCode}
          online={l ? l.online() : null}
          openRooms={l ? l.openRooms().length : 0}
          busy={busy}
          onCreate={(name, pub, pin) => run(() => begin({ code: newCode(), name, pub, pin }, true))}
          onJoin={(name, code, pin) => run(() => begin({ code, name, pub: false, pin }, false))}
          onRandom={onRandom}
        />
      )}

      {error && !client && (
        <div className="toast" role="alert">
          {error}
        </div>
      )}

      {!adult && (
        <Overlay label="Adults only">
          <div className="card">
            <h2 className="dlg-title">For adults, 18 and over</h2>
            <p className="muted">
              Hush Room connects you with other people, including strangers if you use public rooms. Be kind, never share personal
              details, and leave any room that feels wrong. By continuing you confirm you are at least 18.
            </p>
            <button
              className="btn"
              onClick={() => {
                storage.set('hush:adult', '1');
                setAdult(true);
              }}
            >
              I am 18 or older
            </button>
          </div>
        </Overlay>
      )}

      {ended && (
        <Overlay label={END_COPY[ended].title} onClose={() => setEnded(null)}>
          <div className="card center">
            <h2 className="dlg-title">{END_COPY[ended].title}</h2>
            <p className="muted">{END_COPY[ended].body}</p>
            <button className="btn" onClick={() => setEnded(null)}>
              Back to start
            </button>
          </div>
        </Overlay>
      )}
    </>
  );
}
