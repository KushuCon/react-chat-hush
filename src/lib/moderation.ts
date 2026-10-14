/**
 * Client-side nickname filter. It is a speed bump, not a wall:
 * the list is short on purpose and should be extended for your audience.
 */

// Matched anywhere inside the squashed name (long, unambiguous words only).
const BAD_SUBSTR = [
  'fuck', 'bitch', 'cunt', 'nigger', 'nigga', 'faggot', 'whore', 'porn', 'rapist',
  'motherfuck', 'madarchod', 'bhenchod', 'behenchod', 'chutiya', 'chutiye', 'bhosd'
];

// Matched only as a whole word (short words that appear inside real names).
const BAD_TOKENS = new Set([
  'shit', 'sex', 'sexy', 'dick', 'cock', 'ass', 'asshole', 'cum', 'tit', 'tits',
  'boob', 'boobs', 'nude', 'nudes', 'slut', 'rape', 'randi', 'lund', 'lauda', 'bsdk'
]);

// Names that could be mistaken for the site or a moderator.
const RESERVED = new Set([
  'admin', 'administrator', 'moderator', 'mod', 'support', 'official', 'hush', 'system', 'staff'
]);

const LEET: Record<string, string> = {
  '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's', '!': 'i', '|': 'i'
};

function leet(s: string): string {
  return Array.from(s.toLowerCase(), (c) => LEET[c] ?? c).join('');
}

export type NameCheck = { ok: true; name: string } | { ok: false; reason: string };

export function validateName(raw: string): NameCheck {
  const name = raw.replace(/\s+/g, ' ').trim().slice(0, 20);
  if (name.length < 2) return { ok: false, reason: 'Use at least 2 characters.' };
  if (/https?:|www\.|\.(com|in|net|org|io|co)\b|@\S+\.\S+|t\.me|wa\.me/i.test(name)) {
    return { ok: false, reason: 'Names cannot contain links or contact details.' };
  }
  if (/\d{6,}/.test(name.replace(/[\s-]/g, ''))) {
    return { ok: false, reason: 'Names cannot contain phone numbers.' };
  }
  const n = leet(name);
  const tokens = n.split(/[^a-z0-9]+/).filter(Boolean);
  if (tokens.some((t) => RESERVED.has(t))) {
    return { ok: false, reason: 'That name is reserved. Pick another.' };
  }
  const squashed = n.replace(/[^a-z]/g, '');
  if (BAD_SUBSTR.some((w) => squashed.includes(w)) || tokens.some((t) => BAD_TOKENS.has(t))) {
    return { ok: false, reason: 'Please pick a respectful name.' };
  }
  return { ok: true, name };
}

/** Names that arrive from other devices are checked again, so a modified client cannot push a bad one. */
export function safeIncomingName(raw: unknown, seed: string): string {
  if (typeof raw === 'string') {
    const v = validateName(raw);
    if (v.ok) return v.name;
  }
  return 'Guest-' + seed.replace(/[^a-zA-Z0-9]/g, '').slice(0, 2).toUpperCase();
}
