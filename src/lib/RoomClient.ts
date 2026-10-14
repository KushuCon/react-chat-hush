import type { EndReason, Msg, Peer, ReplyRef, Status } from './types';
import { APP_ID, EXTEND_MS, MAX_EXTENSIONS, MAX_MEMBERS, SESSION_MS } from './config';
import { majority, reportThreshold, snippet, uid } from './util';
import { safeIncomingName } from './moderation';
import { storage } from './storage';

/** The two things we need from Trystero (kept loose so tests can fake it). */
export interface TrysteroModule {
  selfId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  joinRoom: (config: any, roomId: string) => any;
}

export interface RoomOpts {
  t: TrysteroModule;
  code: string;
  name: string;
  creator: boolean;
  pub: boolean;
  pin: string;
  note?: string;
  onStatus?: () => void;
  onEnd?: (reason: EndReason) => void;
}

export interface PersonView {
  id: string;
  name: string;
  me: boolean;
  blocked: boolean;
  muted: boolean;
}

export interface Snapshot {
  code: string;
  pub: boolean;
  locked: boolean;
  selfId: string;
  myName: string;
  items: Msg[];
  people: PersonView[];
  typing: string[];
  roomStart: number | null;
  expiresAt: number | null;
  extensions: number;
  votes: { count: number; needed: number; mine: boolean; maxed: boolean };
  ended: EndReason | null;
  version: number;
}

type Saved = { roomStart: number; ext: number; items: Msg[] };
type Send = (data: unknown, to?: string) => unknown;

const KEY = (code: string) => 'hush:room:' + code;
const MAX_IMG = 1_500_000;
const PUBLIC_NOTE = 'Public room: anyone online can join. Images from others stay blurred until you tap them.';

const cap = (s: unknown, n: number): string => String(s ?? '').slice(0, n);
const validEmoji = (e: string): boolean => [...e].length <= 6 && /\p{Extended_Pictographic}/u.test(e);

function cleanReply(re: unknown): ReplyRef | undefined {
  if (!re || typeof re !== 'object') return undefined;
  const r = re as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.text !== 'string') return undefined;
  return { id: cap(r.id, 40), name: cap(r.name, 20), text: cap(r.text, 90) };
}

export class RoomClient {
  readonly code: string;
  readonly myName: string;
  readonly selfId: string;
  readonly pin: string;
  pub: boolean;
  closed = false;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private room: any;
  private tx: Record<string, Send> = {};
  private peers = new Map<string, Peer>();
  private announced = new Set<string>();
  private items: Msg[] = [];
  private typers = new Map<string, number>();
  private votes = new Set<string>();
  private reports = new Map<string, Set<string>>();
  private blocked = new Set<string>();
  private muted = new Set<string>();
  private roomStart: number | null = null;
  private extensions = 0;
  private joinedAt = Date.now();
  private warned5 = false;
  private warned1 = false;
  private endedWith: EndReason | null = null;
  private lastTyping = 0;
  private typingOn = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private fallback: ReturnType<typeof setTimeout> | null = null;
  private persistT: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<() => void>();
  private incoming = new Set<(m: Msg) => void>();
  private version = 0;
  private snap!: Snapshot;
  private o: RoomOpts;

  constructor(o: RoomOpts) {
    this.o = o;
    this.code = o.code;
    this.myName = o.name;
    this.pin = o.pin;
    this.pub = o.pub;
    this.selfId = o.t.selfId;

    const saved = storage.getJSON<Saved>(KEY(o.code));
    if (saved && saved.roomStart + SESSION_MS + (saved.ext || 0) * EXTEND_MS > Date.now()) {
      this.roomStart = saved.roomStart;
      this.extensions = Math.min(MAX_EXTENSIONS, saved.ext || 0);
      this.items = (saved.items || []).filter((m) => m && typeof m.id === 'string');
    }
    if (o.creator && !this.roomStart) this.roomStart = Date.now();

    const cfg: Record<string, unknown> = { appId: APP_ID };
    if (o.pin) cfg.password = o.pin;
    this.room = o.t.joinRoom(cfg, o.code);
    this.bind();

    this.push(
      this.sysMsg(
        (o.creator ? 'Room created. Share the code, or tap it to copy.' : 'Connecting to the room…') +
          ' Tap any message to reply, react or delete it.'
      )
    );
    if (o.pin) this.push(this.sysMsg('This room is locked with a PIN. Share the PIN with the people you invite.'));
    if (o.note) this.push(this.sysMsg(o.note));
    if (this.pub) this.push(this.sysMsg(PUBLIC_NOTE));

    this.timer = setInterval(this.tick, 1000);
    if (!this.roomStart) {
      this.fallback = setTimeout(() => {
        if (this.roomStart || this.closed) return;
        this.roomStart = Date.now();
        this.sys(
          'You are the first one here. The 30 minute timer has started. If you expected people, check the code' +
            (this.pin ? ' and PIN.' : '.')
        );
        this.persist();
        this.o.onStatus?.();
      }, 6000);
    }
    this.emit();
  }

  /* ---------------- subscription (for useSyncExternalStore) ---------------- */

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  };
  getSnapshot = (): Snapshot => this.snap;

  /** Fires for every message from someone else that is not hidden. */
  onIncoming(cb: (m: Msg) => void): () => void {
    this.incoming.add(cb);
    return () => {
      this.incoming.delete(cb);
    };
  }

  /* ---------------- public actions ---------------- */

  status(): Status {
    return {
      code: this.pub && !this.closed ? this.code : null,
      count: 1 + this.peers.size,
      created: this.roomStart ?? this.joinedAt
    };
  }

  /** Alone in a public room: free to move into an older room. */
  canMigrate(): boolean {
    return this.pub && !this.closed && this.peers.size === 0;
  }

  sendText(text: string, re?: ReplyRef): void {
    const t = text.trim().slice(0, 2000);
    if (!t || this.closed) return;
    const id = uid();
    this.send('msg', { id, text: t, re });
    this.addLocal({ id, who: this.selfId, name: this.myName, ts: Date.now(), me: true, text: t, re, reactions: {} });
    this.typing(false);
  }

  sendImage(img: string, once: boolean, re?: ReplyRef): void {
    if (this.closed) return;
    const id = uid();
    this.send('img', { id, img, once, re });
    this.addLocal({
      id,
      who: this.selfId,
      name: this.myName,
      ts: Date.now(),
      me: true,
      // A view-once photo is not kept on the sender's device either.
      img: once ? undefined : img,
      once,
      re,
      reactions: {}
    });
  }

  react(mid: string, emoji: string): void {
    const m = this.items.find((x) => x.id === mid);
    if (!m || m.deleted || m.sys || !validEmoji(emoji)) return;
    const on = !(m.reactions[emoji] ?? []).includes(this.selfId);
    this.setReaction(mid, emoji, this.selfId, on);
    this.send('react', { mid, e: emoji, on });
  }

  /** Delete for everyone. Only your own messages. */
  remove(mid: string): void {
    const m = this.items.find((x) => x.id === mid);
    if (!m || m.who !== this.selfId || m.sys) return;
    this.replace(mid, { deleted: true, text: undefined, img: undefined, reactions: {}, re: undefined });
    this.send('del', { mid });
  }

  typing(on: boolean): void {
    if (this.closed) return;
    const now = Date.now();
    if (on) {
      if (now - this.lastTyping > 2500) {
        this.lastTyping = now;
        this.typingOn = true;
        this.send('typing', { on: true });
      }
    } else if (this.typingOn) {
      this.typingOn = false;
      this.lastTyping = 0;
      this.send('typing', { on: false });
    }
  }

  voteExtend(on: boolean): void {
    if (this.closed || this.extensions >= MAX_EXTENSIONS) return;
    if (on) this.votes.add(this.selfId);
    else this.votes.delete(this.selfId);
    this.send('vote', { on, r: this.extensions });
    this.evalExtend();
    this.emit();
  }

  block(id: string): void {
    if (id === this.selfId) return;
    this.blocked.add(id);
    this.typers.delete(id);
    this.emit();
  }

  unblock(id: string): void {
    this.blocked.delete(id);
    this.emit();
  }

  /** Blocks the person for you and tells the room. Enough reports mute them for everyone. */
  report(id: string, reason: string): void {
    if (id === this.selfId || !this.peers.has(id)) return;
    this.blocked.add(id);
    this.typers.delete(id);
    this.send('report', { target: id, reason: cap(reason, 40) });
    this.addReport(id, this.selfId);
  }

  markOpened(mid: string): void {
    this.replace(mid, { opened: true, img: undefined });
  }

  leave(): void {
    this.end('left');
  }

  /** Leaves without telling the UI (used when hopping to another room). */
  dispose(): void {
    if (this.closed) return;
    this.shutdown();
    storage.del(KEY(this.code));
  }

  /* ---------------- wiring ---------------- */

  private bind(): void {
    const kinds = ['hello', 'msg', 'img', 'typing', 'react', 'del', 'vote', 'extend', 'report'];
    for (const k of kinds) {
      const [send, get] = this.room.makeAction(k) as [Send, (cb: (d: unknown, id: string) => void) => void];
      this.tx[k] = send;
      get((d, id) => this.recv(k, d, id));
    }
    this.room.onPeerJoin((id: string) => {
      this.send('hello', this.helloData(), id);
    });
    this.room.onPeerLeave((id: string) => this.onLeave(id));
  }

  private send(kind: string, data: unknown, to?: string): void {
    try {
      const r = this.tx[kind](data, to);
      if (r && typeof (r as Promise<unknown>).catch === 'function') (r as Promise<unknown>).catch(() => {});
    } catch {
      /* peer may have just left */
    }
  }

  private helloData() {
    return { name: this.myName, joinedAt: this.joinedAt, roomStart: this.roomStart, ext: this.extensions, pub: this.pub };
  }

  private recv(kind: string, raw: unknown, id: string): void {
    if (this.closed || !raw || typeof raw !== 'object') return;
    const d = raw as Record<string, unknown>;
    if (kind === 'hello') return this.onHello(d, id);
    if (!this.allowed(id)) return;
    switch (kind) {
      case 'msg': {
        if (typeof d.text !== 'string' || typeof d.id !== 'string') return;
        this.addIncoming({
          id: cap(d.id, 40),
          who: id,
          name: this.nameFor(id, d.name),
          ts: Date.now(),
          me: false,
          text: cap(d.text, 2000),
          re: cleanReply(d.re),
          reactions: {}
        });
        break;
      }
      case 'img': {
        if (typeof d.img !== 'string' || typeof d.id !== 'string') return;
        if (!d.img.startsWith('data:image/jpeg;base64,') || d.img.length > MAX_IMG) return;
        this.addIncoming({
          id: cap(d.id, 40),
          who: id,
          name: this.nameFor(id, d.name),
          ts: Date.now(),
          me: false,
          img: d.img,
          once: d.once === true,
          re: cleanReply(d.re),
          reactions: {}
        });
        break;
      }
      case 'typing': {
        if (this.isHidden(id)) return;
        if (d.on === true) this.typers.set(id, Date.now() + 4500);
        else this.typers.delete(id);
        this.emit();
        break;
      }
      case 'react': {
        if (typeof d.mid !== 'string' || typeof d.e !== 'string' || !validEmoji(d.e)) return;
        this.setReaction(d.mid, d.e, id, d.on !== false);
        break;
      }
      case 'del': {
        if (typeof d.mid !== 'string') return;
        const m = this.items.find((x) => x.id === d.mid);
        // Only the author can delete a message.
        if (!m || m.sys || m.who !== id) return;
        this.replace(m.id, { deleted: true, text: undefined, img: undefined, reactions: {}, re: undefined });
        break;
      }
      case 'vote': {
        if (this.muted.has(id) || d.r !== this.extensions) return;
        if (d.on === true) this.votes.add(id);
        else this.votes.delete(id);
        this.evalExtend();
        this.emit();
        break;
      }
      case 'extend': {
        const n = Number(d.n);
        if (Number.isInteger(n) && n > this.extensions && n <= MAX_EXTENSIONS) this.applyExtension(n);
        break;
      }
      case 'report': {
        if (typeof d.target !== 'string' || d.target === id || this.muted.has(id)) return;
        this.addReport(d.target, id);
        break;
      }
    }
  }

  private onHello(d: Record<string, unknown>, id: string): void {
    const name = safeIncomingName(d.name, id);
    const first = !this.announced.has(id);
    const at = Number(d.joinedAt);
    this.peers.set(id, { name, joinedAt: Number.isFinite(at) ? at : Date.now() });

    const rs = Number(d.roomStart);
    if (Number.isFinite(rs) && rs > 0 && (!this.roomStart || rs < this.roomStart)) {
      this.roomStart = rs;
      this.clearFallback();
    }
    const ext = Number(d.ext);
    if (Number.isInteger(ext) && ext > this.extensions && ext <= MAX_EXTENSIONS) this.extensions = ext;
    if (d.pub === true && !this.pub) {
      this.pub = true;
      this.sys(PUBLIC_NOTE);
    }
    if (this.order().findIndex((m) => m.id === this.selfId) >= MAX_MEMBERS) {
      this.end('full');
      return;
    }
    if (first) {
      this.announced.add(id);
      this.sys(`${name} joined`);
      this.send('hello', this.helloData(), id);
    }
    this.persist();
    this.o.onStatus?.();
    this.emit();
  }

  private onLeave(id: string): void {
    const p = this.peers.get(id);
    this.peers.delete(id);
    this.announced.delete(id);
    this.typers.delete(id);
    this.votes.delete(id);
    this.reports.delete(id);
    if (p) this.sys(`${p.name} left`);
    this.evalExtend();
    this.o.onStatus?.();
    this.emit();
  }

  /* ---------------- members ---------------- */

  private order(): Array<{ id: string; at: number }> {
    const all = [{ id: this.selfId, at: this.joinedAt }];
    this.peers.forEach((p, id) => all.push({ id, at: p.joinedAt }));
    return all.sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
  }

  /** The first 10 to join are the room. Anyone after that is ignored. */
  private allowed(id: string): boolean {
    if (id === this.selfId) return true;
    if (!this.peers.has(id)) return this.peers.size < MAX_MEMBERS - 1;
    return this.order().slice(0, MAX_MEMBERS).some((m) => m.id === id);
  }

  private isHidden(id: string): boolean {
    return this.blocked.has(id) || this.muted.has(id);
  }

  private activeIds(): string[] {
    const ids = [this.selfId];
    this.peers.forEach((_, id) => {
      if (this.allowed(id) && !this.muted.has(id)) ids.push(id);
    });
    return ids;
  }

  private displayName(id: string): string {
    const base = this.peers.get(id)?.name ?? 'Guest';
    let clash = this.myName === base;
    this.peers.forEach((p, pid) => {
      if (pid !== id && p.name === base) clash = true;
    });
    return clash ? `${base} ·${id.slice(0, 2)}` : base;
  }

  private nameFor(id: string, fallback: unknown): string {
    return this.peers.has(id) ? this.displayName(id) : safeIncomingName(fallback, id);
  }

  /* ---------------- messages ---------------- */

  private sysMsg(text: string): Msg {
    return { id: 's' + uid(), who: 'sys', name: '', ts: Date.now(), me: false, sys: true, text, reactions: {} };
  }

  private push(m: Msg): void {
    this.items.push(m);
  }

  private sys(text: string): void {
    this.push(this.sysMsg(text));
  }

  private addLocal(m: Msg): void {
    this.items.push(m);
    this.persist();
    this.emit();
  }

  private addIncoming(m: Msg): void {
    if (this.items.some((x) => x.id === m.id)) return;
    this.items.push(m);
    this.typers.delete(m.who);
    this.persist();
    this.emit();
    if (!this.isHidden(m.who)) this.incoming.forEach((cb) => cb(m));
  }

  private replace(mid: string, patch: Partial<Msg>): boolean {
    const i = this.items.findIndex((x) => x.id === mid);
    if (i < 0) return false;
    this.items[i] = { ...this.items[i], ...patch };
    this.persist();
    this.emit();
    return true;
  }

  private setReaction(mid: string, emoji: string, who: string, on: boolean): void {
    const m = this.items.find((x) => x.id === mid);
    if (!m || m.deleted || m.sys) return;
    const cur = new Set(m.reactions[emoji] ?? []);
    if (on) cur.add(who);
    else cur.delete(who);
    const reactions = { ...m.reactions };
    if (cur.size) reactions[emoji] = [...cur];
    else delete reactions[emoji];
    this.replace(mid, { reactions });
  }

  /* ---------------- votes, reports ---------------- */

  private evalExtend(): void {
    if (this.extensions >= MAX_EXTENSIONS) return;
    const ids = this.activeIds();
    const count = ids.filter((id) => this.votes.has(id)).length;
    if (count >= majority(ids.length)) {
      const n = this.extensions + 1;
      this.applyExtension(n);
      this.send('extend', { n });
    }
  }

  private applyExtension(n: number): void {
    this.extensions = n;
    this.votes.clear();
    this.warned5 = false;
    this.warned1 = false;
    this.sys(`The room voted to add 15 minutes. (${n} of ${MAX_EXTENSIONS} extensions used)`);
    this.persist();
    this.emit();
  }

  private addReport(target: string, reporter: string): void {
    if (target === this.selfId || !this.peers.has(target) || this.muted.has(target)) return;
    const set = this.reports.get(target) ?? new Set<string>();
    set.add(reporter);
    this.reports.set(target, set);
    const members = this.activeIds().length;
    const valid = [...set].filter((r) => r === this.selfId || (r !== target && this.peers.has(r))).length;
    if (valid >= reportThreshold(members)) {
      this.muted.add(target);
      this.typers.delete(target);
      this.votes.delete(target);
      this.sys(`${this.displayName(target)} was muted by the room after reports.`);
    }
    this.emit();
  }

  /* ---------------- time ---------------- */

  private expiresAt(): number | null {
    return this.roomStart ? this.roomStart + SESSION_MS + this.extensions * EXTEND_MS : null;
  }

  private tick = (): void => {
    if (this.closed) return;
    const now = Date.now();
    let changed = false;
    this.typers.forEach((exp, id) => {
      if (exp < now) {
        this.typers.delete(id);
        changed = true;
      }
    });
    const end = this.expiresAt();
    if (end) {
      const left = end - now;
      if (left <= 0) {
        this.end('time');
        return;
      }
      if (left >= 5 * 60_000) this.warned5 = false;
      if (left >= 60_000) this.warned1 = false;
      if (left < 5 * 60_000 && !this.warned5) {
        this.warned5 = true;
        this.sys('5 minutes left. Open the people panel to vote for more time.');
        changed = true;
      }
      if (left < 60_000 && !this.warned1) {
        this.warned1 = true;
        this.sys('1 minute left.');
        changed = true;
      }
    }
    if (changed) this.emit();
  };

  private clearFallback(): void {
    if (this.fallback) clearTimeout(this.fallback);
    this.fallback = null;
  }

  /* ---------------- lifecycle ---------------- */

  private shutdown(): void {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    if (this.persistT) clearTimeout(this.persistT);
    this.clearFallback();
    try {
      void Promise.resolve(this.room.leave()).catch(() => {});
    } catch {
      /* ignore */
    }
  }

  private end(reason: EndReason): void {
    if (this.closed) return;
    this.shutdown();
    this.endedWith = reason;
    storage.del('hush:active');
    storage.del(KEY(this.code));
    this.items = [];
    this.emit();
    this.o.onEnd?.(reason);
  }

  private persist(): void {
    if (this.persistT) clearTimeout(this.persistT);
    this.persistT = setTimeout(() => {
      if (this.closed || !this.roomStart) return;
      let list = this.items.filter((m) => !(m.once && m.img)).slice(-200);
      for (;;) {
        const ok = storage.setJSON(KEY(this.code), { roomStart: this.roomStart, ext: this.extensions, items: list });
        if (ok) return;
        const idx = list.findIndex((m) => m.img);
        if (idx === -1) return;
        list = list.slice(idx + 1);
      }
    }, 400);
  }

  private build(): Snapshot {
    const hide = (id: string) => this.isHidden(id);
    const items = this.items.filter((m) => m.me || m.sys || !hide(m.who));
    const people: PersonView[] = [{ id: this.selfId, name: this.myName, me: true, blocked: false, muted: false }];
    this.peers.forEach((_, id) => {
      if (this.allowed(id)) {
        people.push({ id, name: this.displayName(id), me: false, blocked: this.blocked.has(id), muted: this.muted.has(id) });
      }
    });
    const typing: string[] = [];
    this.typers.forEach((_, id) => {
      if (this.peers.has(id) && !hide(id)) typing.push(this.displayName(id));
    });
    const active = this.activeIds();
    return {
      code: this.code,
      pub: this.pub,
      locked: !!this.pin,
      selfId: this.selfId,
      myName: this.myName,
      items,
      people,
      typing,
      roomStart: this.roomStart,
      expiresAt: this.expiresAt(),
      extensions: this.extensions,
      votes: {
        count: active.filter((id) => this.votes.has(id)).length,
        needed: majority(active.length),
        mine: this.votes.has(this.selfId),
        maxed: this.extensions >= MAX_EXTENSIONS
      },
      ended: this.endedWith,
      version: ++this.version
    };
  }

  private emit(): void {
    this.snap = this.build();
    this.listeners.forEach((l) => l());
  }
}

export { snippet };
