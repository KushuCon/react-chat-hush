import { APP_ID, LOBBY_ID, MAX_MEMBERS } from './config';
import type { Status } from './types';
import type { TrysteroModule } from './RoomClient';

export interface OpenRoom {
  code: string;
  count: number;
  created: number;
}

/**
 * Everyone with the page open joins one shared "lobby" room. It only carries
 * a tiny status line per person, which gives us the online count and the list
 * of public rooms. Chat messages never go through it.
 */
export class Lobby {
  peers = new Map<string, Status>();
  private room: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  private tx: (d: unknown, to?: string) => unknown;
  private getStatus: () => Status;
  private onChange: () => void;

  constructor(t: TrysteroModule, getStatus: () => Status, onChange: () => void) {
    this.getStatus = getStatus;
    this.onChange = onChange;
    this.room = t.joinRoom({ appId: APP_ID }, LOBBY_ID);
    const [send, get] = this.room.makeAction('status') as [
      (d: unknown, to?: string) => unknown,
      (cb: (d: unknown, id: string) => void) => void
    ];
    this.tx = send;
    get((d, id) => {
      this.peers.set(id, sanitize(d));
      this.onChange();
    });
    this.room.onPeerJoin((id: string) => {
      if (!this.peers.has(id)) this.peers.set(id, { code: null, count: 0, created: 0 });
      this.safeSend(this.getStatus(), id);
      this.onChange();
    });
    this.room.onPeerLeave((id: string) => {
      this.peers.delete(id);
      this.onChange();
    });
  }

  private safeSend(d: unknown, to?: string): void {
    try {
      const r = this.tx(d, to);
      if (r && typeof (r as Promise<unknown>).catch === 'function') (r as Promise<unknown>).catch(() => {});
    } catch {
      /* ignore */
    }
  }

  broadcast(): void {
    this.safeSend(this.getStatus());
  }

  online(): number {
    return this.peers.size + 1;
  }

  /** Public rooms with space, merged across everyone who advertises them. */
  openRooms(own?: Status): OpenRoom[] {
    const map = new Map<string, OpenRoom>();
    const add = (s: Status) => {
      if (!s.code || s.count >= MAX_MEMBERS) return;
      const e = map.get(s.code);
      if (!e) map.set(s.code, { code: s.code, count: s.count, created: s.created });
      else {
        e.count = Math.max(e.count, s.count);
        e.created = Math.min(e.created, s.created);
      }
    };
    this.peers.forEach(add);
    if (own) add(own);
    return [...map.values()];
  }

  leave(): void {
    try {
      void Promise.resolve(this.room.leave()).catch(() => {});
    } catch {
      /* ignore */
    }
  }
}

function sanitize(d: unknown): Status {
  const o = (d && typeof d === 'object' ? d : {}) as Record<string, unknown>;
  const code = typeof o.code === 'string' && /^[A-Z0-9]{6}$/.test(o.code) ? o.code : null;
  const count = Math.min(MAX_MEMBERS, Math.max(0, Number(o.count) || 0));
  const created = Number(o.created);
  return { code, count, created: Number.isFinite(created) ? created : 0 };
}
