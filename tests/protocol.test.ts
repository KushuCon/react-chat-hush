import { afterEach, describe, expect, it } from 'vitest';
import { RoomClient } from '../src/lib/RoomClient';
import { Lobby } from '../src/lib/Lobby';
import { FakeNet, flush } from './fakeNet';
import { EXTEND_MS, SESSION_MS } from '../src/lib/config';
import { majority, newCode, reportThreshold, typingLabel } from '../src/lib/util';
import { validateName } from '../src/lib/moderation';

const clients: RoomClient[] = [];
afterEach(() => {
  clients.splice(0).forEach((c) => c.dispose());
});

function join(net: FakeNet, id: string, name: string, opts: Partial<{ code: string; creator: boolean; pub: boolean; pin: string }> = {}) {
  const c = new RoomClient({
    t: net.module(id),
    code: opts.code ?? 'ABC234',
    name,
    creator: opts.creator ?? false,
    pub: opts.pub ?? false,
    pin: opts.pin ?? ''
  });
  clients.push(c);
  return c;
}
const texts = (c: RoomClient) => c.getSnapshot().items.filter((m) => !m.sys).map((m) => m.text);

describe('pure helpers', () => {
  it('formats typing labels for any number of people', () => {
    expect(typingLabel([])).toBe('');
    expect(typingLabel(['user1'])).toBe('user1 is typing…');
    expect(typingLabel(['user1', 'hdfc', 'user 405'])).toBe('user1, hdfc and user 405 are typing…');
  });
  it('computes majority and report thresholds', () => {
    expect(majority(1)).toBe(1);
    expect(majority(2)).toBe(2);
    expect(majority(3)).toBe(2);
    expect(majority(10)).toBe(6);
    expect(reportThreshold(3)).toBe(2);
    expect(reportThreshold(10)).toBe(5);
  });
  it('makes 6 character room codes without look-alike characters', () => {
    for (let i = 0; i < 200; i++) expect(newCode()).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
  });
  it('filters nicknames', () => {
    for (const ok of ['Priya', 'user1', 'hdfc', 'user 405', 'Shital', 'Dickinson']) expect(validateName(ok).ok, ok).toBe(true);
    for (const bad of ['f u c k', 'admin', 'Hush Support', 'call 9876543210', 'a', 'porn_king', 'visit site.com', 'sh1t']) {
      expect(validateName(bad).ok, bad).toBe(false);
    }
  });
});

describe('room protocol', () => {
  it('delivers messages, replies and typing between people', async () => {
    const net = new FakeNet();
    const a = join(net, 'pA', 'Asha', { creator: true });
    const b = join(net, 'pB', 'Ben');
    const c = join(net, 'pC', 'Chitra');
    await flush();
    a.sendText('hello all');
    await flush();
    expect(texts(b)).toContain('hello all');
    expect(texts(c)).toContain('hello all');
    const original = b.getSnapshot().items.find((m) => m.text === 'hello all')!;
    b.sendText('hi Asha', { id: original.id, name: original.name, text: original.text! });
    await flush();
    const reply = a.getSnapshot().items.find((m) => m.text === 'hi Asha')!;
    expect(reply.re?.id).toBe(original.id);

    b.typing(true);
    c.typing(true);
    await flush();
    expect(a.getSnapshot().typing.sort()).toEqual(['Ben', 'Chitra']);
    b.typing(false);
    await flush();
    expect(a.getSnapshot().typing).toEqual(['Chitra']);
    c.sendText('done'); // sending clears the typing state
    await flush();
    expect(a.getSnapshot().typing).toEqual([]);
  });

  it('syncs reactions and lets only the author delete', async () => {
    const net = new FakeNet();
    const a = join(net, 'pA', 'Asha', { creator: true });
    const b = join(net, 'pB', 'Ben');
    await flush();
    a.sendText('first');
    await flush();
    const mid = a.getSnapshot().items.find((m) => m.text === 'first')!.id;
    b.react(mid, '👍');
    a.react(mid, '👍');
    await flush();
    expect(a.getSnapshot().items.find((m) => m.id === mid)!.reactions['👍'].sort()).toEqual(['pA', 'pB']);
    b.react(mid, '👍'); // toggle off
    await flush();
    expect(b.getSnapshot().items.find((m) => m.id === mid)!.reactions['👍']).toEqual(['pA']);

    b.remove(mid); // not the author: nothing happens
    await flush();
    expect(a.getSnapshot().items.find((m) => m.id === mid)!.deleted).toBeFalsy();

    a.remove(mid);
    await flush();
    const gone = b.getSnapshot().items.find((m) => m.id === mid)!;
    expect(gone.deleted).toBe(true);
    expect(gone.text).toBeUndefined();
  });

  it('keeps view-once photos off the sender and drops them after opening', async () => {
    const net = new FakeNet();
    const a = join(net, 'pA', 'Asha', { creator: true });
    const b = join(net, 'pB', 'Ben');
    await flush();
    a.sendImage('data:image/jpeg;base64,AAAA', true);
    await flush();
    const mine = a.getSnapshot().items.find((m) => m.once)!;
    expect(mine.img).toBeUndefined();
    const theirs = b.getSnapshot().items.find((m) => m.once)!;
    expect(theirs.img).toBe('data:image/jpeg;base64,AAAA');
    b.markOpened(theirs.id);
    const after = b.getSnapshot().items.find((m) => m.once)!;
    expect(after.img).toBeUndefined();
    expect(after.opened).toBe(true);
  });

  it('rejects non-JPEG image payloads', async () => {
    const net = new FakeNet();
    const a = join(net, 'pA', 'Asha', { creator: true });
    const b = join(net, 'pB', 'Ben');
    await flush();
    a.sendImage('data:image/svg+xml;base64,AAAA', false);
    await flush();
    expect(b.getSnapshot().items.some((m) => m.img)).toBe(false);
  });

  it('extends the session when a majority votes', async () => {
    const net = new FakeNet();
    const a = join(net, 'pA', 'Asha', { creator: true });
    const b = join(net, 'pB', 'Ben');
    const c = join(net, 'pC', 'Chitra');
    await flush();
    const before = a.getSnapshot().expiresAt!;
    expect(before).toBe(a.getSnapshot().roomStart! + SESSION_MS);
    a.voteExtend(true);
    await flush();
    expect(a.getSnapshot().votes).toMatchObject({ count: 1, needed: 2, mine: true });
    expect(a.getSnapshot().expiresAt).toBe(before);
    b.voteExtend(true);
    await flush();
    for (const x of [a, b, c]) {
      expect(x.getSnapshot().extensions).toBe(1);
      expect(x.getSnapshot().expiresAt).toBe(before + EXTEND_MS);
      expect(x.getSnapshot().votes.count).toBe(0);
    }
  });

  it('mutes someone for everyone after enough reports', async () => {
    const net = new FakeNet();
    const a = join(net, 'pA', 'Asha', { creator: true });
    const b = join(net, 'pB', 'Ben');
    const c = join(net, 'pC', 'Chitra');
    const d = join(net, 'pD', 'Dev');
    await flush();
    d.sendText('spam');
    await flush();
    expect(texts(a)).toContain('spam');
    a.report('pD', 'Spam');
    expect(texts(a)).not.toContain('spam'); // reporter blocks at once
    await flush();
    expect(texts(c)).toContain('spam'); // one report is not enough for the others
    b.report('pD', 'Spam');
    await flush();
    expect(texts(c)).not.toContain('spam');
    expect(c.getSnapshot().people.find((p) => p.id === 'pD')!.muted).toBe(true);
    expect(c.getSnapshot().items.some((m) => m.sys && m.text!.includes('muted by the room'))).toBe(true);
  });

  it('lets people block and unblock locally', async () => {
    const net = new FakeNet();
    const a = join(net, 'pA', 'Asha', { creator: true });
    const b = join(net, 'pB', 'Ben');
    await flush();
    const heard: string[] = [];
    a.onIncoming((m) => heard.push(m.text ?? ''));
    a.block('pB');
    b.sendText('muted talk');
    await flush();
    expect(texts(a)).not.toContain('muted talk');
    expect(heard).toEqual([]);
    a.unblock('pB');
    expect(texts(a)).toContain('muted talk');
  });

  it('keeps people with a different PIN out of the room', async () => {
    const net = new FakeNet();
    const a = join(net, 'pA', 'Asha', { creator: true, pin: '4821' });
    const b = join(net, 'pB', 'Ben', { pin: '4821' });
    const x = join(net, 'pX', 'Xena', { pin: '0000' });
    await flush();
    a.sendText('secret');
    await flush();
    expect(texts(b)).toContain('secret');
    expect(texts(x)).not.toContain('secret');
    expect(a.getSnapshot().people.length).toBe(2);
  });

  it('turns away the 11th person', async () => {
    const net = new FakeNet();
    const members: RoomClient[] = [];
    for (let i = 0; i < 10; i++) {
      members.push(join(net, 'p' + String(i).padStart(2, '0'), 'User' + i, { creator: i === 0 }));
      await flush(6);
    }
    await flush();
    expect(members.every((m) => !m.getSnapshot().ended)).toBe(true);
    const late = join(net, 'pLate', 'Late');
    await flush(40);
    expect(late.getSnapshot().ended).toBe('full');
    expect(members[0].getSnapshot().people.length).toBe(10);
  });

  it('adopts the earliest start time and extensions from people already inside', async () => {
    const net = new FakeNet();
    const a = join(net, 'pA', 'Asha', { creator: true });
    await flush();
    a.voteExtend(true); // alone: majority of 1 passes at once
    await flush();
    const b = join(net, 'pB', 'Ben');
    await flush();
    expect(b.getSnapshot().roomStart).toBe(a.getSnapshot().roomStart);
    expect(b.getSnapshot().extensions).toBe(1);
  });
});

describe('lobby', () => {
  it('counts people online and merges public room adverts', async () => {
    const net = new FakeNet();
    const mk = (id: string, status: { code: string | null; count: number; created: number }) => {
      let changes = 0;
      const l = new Lobby(net.module(id), () => status, () => changes++);
      return { l, changes: () => changes };
    };
    const a = mk('pA', { code: 'ROOM22', count: 1, created: 100 });
    const b = mk('pB', { code: null, count: 0, created: 200 });
    const c = mk('pC', { code: 'ROOM22', count: 2, created: 90 });
    await flush();
    a.l.broadcast();
    c.l.broadcast();
    await flush();
    expect(b.l.online()).toBe(3);
    expect(b.l.openRooms()).toEqual([{ code: 'ROOM22', count: 2, created: 90 }]);
    a.l.leave();
    c.l.leave();
    b.l.leave();
  });
});
