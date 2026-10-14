import { ALPHABET } from './config';

export function newCode(): string {
  const a = new Uint32Array(6);
  crypto.getRandomValues(a);
  // 2^32 is divisible by 32, so this is unbiased.
  return Array.from(a, (n) => ALPHABET[n % ALPHABET.length]).join('');
}

export function uid(): string {
  const a = new Uint8Array(8);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function hueOf(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

export function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function snippet(text: string, max = 80): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

/** "Asha is typing…", "Asha, hdfc and user 405 are typing…" */
export function typingLabel(names: string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return `${names[0]} is typing…`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} are typing…`;
}

/** Strict majority of n people. */
export const majority = (n: number): number => Math.floor(n / 2) + 1;

/**
 * Reports needed before the whole room mutes someone.
 * members includes the person being reported.
 */
export function reportThreshold(members: number): number {
  const others = Math.max(0, members - 1);
  return Math.max(2, Math.ceil(others / 2));
}

export function formatClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}
