import type { TrysteroModule } from '../src/lib/RoomClient';

type Handler = (d: unknown, id: string) => void;

/** An in-memory stand-in for Trystero: same room id + same password = same room. */
class FakeRoom {
  handlers = new Map<string, Handler[]>();
  joinCbs: Array<(id: string) => void> = [];
  leaveCbs: Array<(id: string) => void> = [];
  constructor(private net: FakeNet, public key: string, public selfId: string) {}

  makeAction = (name: string) => {
    const send = (data: unknown, to?: string) => {
      this.net.deliver(this, name, data, to);
      return Promise.resolve([]);
    };
    const get = (cb: Handler) => {
      const a = this.handlers.get(name) ?? [];
      a.push(cb);
      this.handlers.set(name, a);
    };
    return [send, get, () => {}];
  };
  onPeerJoin = (cb: (id: string) => void) => {
    this.joinCbs.push(cb);
  };
  onPeerLeave = (cb: (id: string) => void) => {
    this.leaveCbs.push(cb);
  };
  leave = () => {
    this.net.drop(this);
    return Promise.resolve();
  };
}

export class FakeNet {
  private rooms = new Map<string, Set<FakeRoom>>();

  module(selfId: string): TrysteroModule {
    return {
      selfId,
      joinRoom: (cfg: { password?: string }, roomId: string) => {
        const key = roomId + '|' + (cfg.password ?? '');
        const room = new FakeRoom(this, key, selfId);
        const set = this.rooms.get(key) ?? new Set<FakeRoom>();
        const others = [...set];
        set.add(room);
        this.rooms.set(key, set);
        setTimeout(() => {
          for (const o of others) {
            o.joinCbs.forEach((cb) => cb(selfId));
            room.joinCbs.forEach((cb) => cb(o.selfId));
          }
        }, 0);
        return room;
      }
    };
  }

  deliver(from: FakeRoom, name: string, data: unknown, to?: string) {
    const copy = JSON.parse(JSON.stringify(data ?? null));
    for (const r of this.rooms.get(from.key) ?? []) {
      if (r === from || (to && r.selfId !== to)) continue;
      setTimeout(() => (r.handlers.get(name) ?? []).forEach((h) => h(copy, from.selfId)), 0);
    }
  }

  drop(room: FakeRoom) {
    const set = this.rooms.get(room.key);
    if (!set) return;
    set.delete(room);
    for (const r of set) setTimeout(() => r.leaveCbs.forEach((cb) => cb(room.selfId)), 0);
  }
}

export const flush = (ms = 25) => new Promise<void>((r) => setTimeout(r, ms));
