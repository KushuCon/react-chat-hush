import { EXTEND_MS, SESSION_MS } from './config';

/** localStorage that never throws (private windows, blocked storage, node tests). */
export const storage = {
  get(k: string): string | null {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string): boolean {
    try {
      localStorage.setItem(k, v);
      return true;
    } catch {
      return false;
    }
  },
  del(k: string): void {
    try {
      localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  },
  getJSON<T>(k: string): T | null {
    const s = storage.get(k);
    if (!s) return null;
    try {
      return JSON.parse(s) as T;
    } catch {
      return null;
    }
  },
  setJSON(k: string, v: unknown): boolean {
    return storage.set(k, JSON.stringify(v));
  },
  /** Drop saved rooms whose session is over. */
  purgeExpired(): void {
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (!k || !k.startsWith('hush:room:')) continue;
        const d = JSON.parse(localStorage.getItem(k) || '{}') as { roomStart?: number; ext?: number };
        const end = (d.roomStart ?? 0) + SESSION_MS + (d.ext ?? 0) * EXTEND_MS;
        if (!d.roomStart || end < Date.now()) localStorage.removeItem(k);
      }
    } catch {
      /* ignore */
    }
  }
};
