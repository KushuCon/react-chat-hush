import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { RoomClient } from './lib/RoomClient';
import type { Msg, ReplyRef } from './lib/types';
import { EMOJIS, QUICK_REACTIONS } from './lib/config';
import { compressImage } from './lib/image';
import { playPing, unlockAudio } from './lib/sound';
import { storage } from './lib/storage';
import { fmtTime, formatClock, hueOf, snippet, typingLabel } from './lib/util';
import { Icon, Lightbox, ThemeButton } from './ui';
import { Panel } from './Panel';

const EMOJI_ONLY = /^(\p{Extended_Pictographic}|\p{Emoji_Modifier}|‍|️|\s){1,6}$/u;

function Countdown({ expiresAt }: { expiresAt: number | null }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (!expiresAt) return <div className="timer">--:--</div>;
  const left = expiresAt - now;
  return (
    <div className={'timer' + (left < 5 * 60_000 ? ' low' : '')} aria-label="Time left" role="timer">
      {formatClock(left)}
    </div>
  );
}

export function Chat({ client }: { client: RoomClient }) {
  const s = useSyncExternalStore(client.subscribe, client.getSnapshot);
  const [panel, setPanel] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [replyTo, setReplyTo] = useState<ReplyRef | null>(null);
  const [text, setText] = useState('');
  const [emoji, setEmoji] = useState(false);
  const [once, setOnce] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const [view, setView] = useState<{ src: string; mid?: string; once?: boolean } | null>(null);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [soundOn, setSoundOn] = useState(storage.get('hush:sound') !== '0');
  const soundRef = useRef(soundOn);
  soundRef.current = soundOn;

  const feed = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const fileRef = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* unread count in the tab title + sound */
  useEffect(() => {
    const base = document.title;
    let unread = 0;
    const paint = () => {
      document.title = unread ? `(${unread}) ${base}` : base;
    };
    const away = () => document.visibilityState === 'hidden' || !document.hasFocus();
    const clear = () => {
      if (!away()) {
        unread = 0;
        paint();
      }
    };
    const off = client.onIncoming(() => {
      if (!away()) return;
      unread++;
      paint();
      if (soundRef.current) playPing();
    });
    document.addEventListener('visibilitychange', clear);
    window.addEventListener('focus', clear);
    return () => {
      off();
      document.removeEventListener('visibilitychange', clear);
      window.removeEventListener('focus', clear);
      document.title = base;
    };
  }, [client]);

  /* keep the newest message in view unless the reader scrolled up */
  useEffect(() => {
    const el = feed.current;
    if (!el) return;
    const last = s.items[s.items.length - 1];
    if (stick.current || last?.me) el.scrollTop = el.scrollHeight;
  }, [s.items.length, s.typing.length]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(''), 2600);
    return () => clearTimeout(id);
  }, [toast]);

  const onScroll = () => {
    const el = feed.current!;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const flash = (m: string) => setToast(m);

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(s.code);
      flash('Code copied.');
    } catch {
      flash('Room code: ' + s.code);
    }
  };

  const typed = (v: string) => {
    setText(v);
    if (idle.current) clearTimeout(idle.current);
    if (v.trim()) {
      client.typing(true);
      idle.current = setTimeout(() => client.typing(false), 3000);
    } else client.typing(false);
  };

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    unlockAudio();
    if (!text.trim()) return;
    client.sendText(text, replyTo ?? undefined);
    if (idle.current) clearTimeout(idle.current);
    setText('');
    setReplyTo(null);
    setEmoji(false);
    stick.current = true;
    if (taRef.current) taRef.current.style.height = 'auto';
  };

  const sendFile = async (f: File | undefined) => {
    if (!f) return;
    if (!f.type.startsWith('image/')) return flash('Pick an image file.');
    setBusy(true);
    try {
      const img = await compressImage(f);
      client.sendImage(img, once, replyTo ?? undefined);
      setReplyTo(null);
      stick.current = true;
    } catch {
      flash('Could not read that image.');
    } finally {
      setBusy(false);
    }
  };

  const pick = (m: Msg) => {
    if (m.sys || m.deleted) return;
    setPicked((p) => (p === m.id ? null : m.id));
    setConfirmDel(false);
  };

  const startReply = (m: Msg) => {
    setReplyTo({ id: m.id, name: m.me ? 'You' : m.name, text: m.img || m.once ? '📷 Photo' : snippet(m.text ?? '', 90) });
    setPicked(null);
    taRef.current?.focus();
  };

  const jump = (id: string) => {
    const el = feed.current?.querySelector<HTMLElement>(`[data-mid="${CSS.escape(id)}"]`);
    if (!el) return flash('That message is no longer here.');
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.add('hit');
    setTimeout(() => el.classList.remove('hit'), 1200);
  };

  const closeView = () => {
    if (view?.once && view.mid) client.markOpened(view.mid);
    setView(null);
  };

  const body = (m: Msg) => {
    if (m.deleted) return <div className="bub gone">This message was deleted</div>;
    if (m.once) {
      if (m.me) return <div className="bub once">Photo sent · view once</div>;
      if (m.opened || !m.img) return <div className="bub once off">Photo opened</div>;
      return (
        <button className="bub once" onClick={() => setView({ src: m.img!, mid: m.id, once: true })}>
          Photo · tap to view once
        </button>
      );
    }
    if (m.img) {
      const blur = s.pub && !m.me && !revealed.has(m.id);
      return (
        <div className="bub imgb">
          <img
            src={m.img}
            alt={'Photo from ' + m.name}
            className={blur ? 'blur' : ''}
            onClick={(e) => {
              e.stopPropagation();
              if (blur) setRevealed((r) => new Set(r).add(m.id));
              else setView({ src: m.img! });
            }}
          />
        </div>
      );
    }
    const big = EMOJI_ONLY.test(m.text ?? '') && /\p{Extended_Pictographic}/u.test(m.text ?? '');
    return <div className={'bub' + (big ? ' emoji-only' : '')}>{m.text}</div>;
  };

  let prev: string | null = null;
  const rows = s.items.map((m) => {
    if (m.sys) {
      prev = null;
      return (
        <div className="sys" key={m.id}>
          {m.text}
        </div>
      );
    }
    const showName = !m.me && prev !== m.who;
    prev = m.who;
    const open = picked === m.id;
    const rx = Object.entries(m.reactions);
    return (
      <div
        key={m.id}
        data-mid={m.id}
        className={'msg' + (m.me ? ' me' : '') + (open ? ' open' : '')}
        style={{ ['--h' as string]: hueOf(m.name) }}
      >
        {showName && <div className="who">{m.name}</div>}
        <div className="bwrap" onClick={() => pick(m)}>
          {m.re && !m.deleted && (
            <button
              className="quote"
              onClick={(e) => {
                e.stopPropagation();
                jump(m.re!.id);
              }}
            >
              <b>{m.re.name}</b>
              <span>{m.re.text}</span>
            </button>
          )}
          {body(m)}
        </div>
        {rx.length > 0 && (
          <div className="rx">
            {rx.map(([e, ids]) => (
              <button
                key={e}
                className={ids.includes(s.selfId) ? 'on' : ''}
                onClick={() => client.react(m.id, e)}
                aria-label={`${e} ${ids.length}`}
              >
                {e} <span>{ids.length}</span>
              </button>
            ))}
          </div>
        )}
        {open && (
          <div className="actions" role="menu">
            {QUICK_REACTIONS.map((e) => (
              <button
                key={e}
                className="qr"
                onClick={() => {
                  client.react(m.id, e);
                  setPicked(null);
                }}
              >
                {e}
              </button>
            ))}
            <button className="act" onClick={() => startReply(m)}>
              Reply
            </button>
            {m.me &&
              (confirmDel ? (
                <button
                  className="act danger"
                  onClick={() => {
                    client.remove(m.id);
                    setPicked(null);
                    setConfirmDel(false);
                  }}
                >
                  Delete for everyone?
                </button>
              ) : (
                <button className="act danger" onClick={() => setConfirmDel(true)}>
                  Delete
                </button>
              ))}
          </div>
        )}
        <div className="time">{fmtTime(m.ts)}</div>
      </div>
    );
  });

  const typing = typingLabel(s.typing);

  return (
    <section className="chat">
      <header className="bar">
        <button className="chip" onClick={copyCode} title="Copy room code">
          <small>Room</small>
          <b>{s.code}</b>
        </button>
        {s.pub && <span className="pill">Public</span>}
        {s.locked && (
          <span className="pill lock">
            <Icon.Lock /> PIN
          </span>
        )}
        <div className="spacer" />
        <Countdown expiresAt={s.expiresAt} />
        <button className="mbtn" onClick={() => setPanel(true)} aria-label="People and room settings">
          <Icon.People />
          <span>{s.people.length}/10</span>
        </button>
        <ThemeButton />
        <button className="ib" onClick={() => client.leave()} aria-label="Leave room">
          <Icon.Leave />
        </button>
      </header>

      <div className="feed" ref={feed} onScroll={onScroll} aria-live="polite">
        {rows}
      </div>

      <div className={'typing' + (typing ? ' on' : '')} aria-live="polite">
        {typing && (
          <>
            <span className="dots">
              <i />
              <i />
              <i />
            </span>
            {typing}
          </>
        )}
      </div>

      <form className="composer" onSubmit={submit}>
        {replyTo && (
          <div className="replying">
            <div>
              <b>Replying to {replyTo.name}</b>
              <span>{replyTo.text}</span>
            </div>
            <button type="button" className="ib sm" onClick={() => setReplyTo(null)} aria-label="Cancel reply">
              <Icon.Close />
            </button>
          </div>
        )}
        {emoji && (
          <div className="emojis">
            {EMOJIS.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => {
                  typed(text + e);
                  taRef.current?.focus();
                }}
              >
                {e}
              </button>
            ))}
          </div>
        )}
        <div className="crow">
          <button type="button" className="ib" onClick={() => setEmoji((v) => !v)} aria-label="Emoji" aria-expanded={emoji}>
            <Icon.Emoji />
          </button>
          <button type="button" className="ib" onClick={() => fileRef.current?.click()} disabled={busy} aria-label="Send an image">
            <Icon.Image />
          </button>
          <button
            type="button"
            className={'ib toggle' + (once ? ' on' : '')}
            onClick={() => setOnce((v) => !v)}
            aria-pressed={once}
            aria-label="View once photos"
            title={once ? 'Photos disappear after one view' : 'Photos stay in the chat'}
          >
            <Icon.Flame />
          </button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { void sendFile(e.target.files?.[0]); e.target.value = ''; }} />
          <textarea
            ref={taRef}
            id="message"
            rows={1}
            maxLength={2000}
            placeholder={once ? 'Photos will be view once' : 'Message'}
            aria-label="Message"
            value={text}
            onChange={(e) => {
              typed(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = Math.min(e.target.scrollHeight, 128) + 'px';
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            onPaste={(e) => {
              const f = [...e.clipboardData.files].find((x) => x.type.startsWith('image/'));
              if (f) {
                e.preventDefault();
                void sendFile(f);
              }
            }}
          />
          <button className="send" type="submit" aria-label="Send" disabled={!text.trim()}>
            <Icon.Send />
          </button>
        </div>
      </form>

      {panel && (
        <Panel
          s={s}
          client={client}
          soundOn={soundOn}
          setSoundOn={(v) => {
            setSoundOn(v);
            storage.set('hush:sound', v ? '1' : '0');
            if (v) unlockAudio();
          }}
          onClose={() => setPanel(false)}
        />
      )}
      {view && <Lightbox src={view.src} onClose={closeView} note={view.once ? 'This photo disappears when you close it.' : undefined} />}
      {toast && <div className="toast">{toast}</div>}
    </section>
  );
}
