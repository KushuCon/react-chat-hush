export const APP_ID = 'hush-room-v2';
export const LOBBY_ID = 'lobby-v2';

export const SESSION_MS = 30 * 60 * 1000;
export const EXTEND_MS = 15 * 60 * 1000;
export const MAX_EXTENSIONS = 3;
export const MAX_MEMBERS = 10;

// No 0/O/1/I so codes are easy to read out loud.
export const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

export const REPORT_REASONS = [
  'Spam',
  'Harassment or abuse',
  'Sexual content',
  'Something else'
] as const;

export const EMOJIS = Array.from(
  '😀😃😄😁😆😅😂🤣🙂😉😊😍🥰😘😋😎🤩🥳😏🤔🤨😐😴🥱😮😢😭😤😡🤯😱🥶🥵🤗🫡🙄😬🤝👍👎👏🙌🙏💪👀🔥✨💯🎉🎂❤️🧡💛💚💙💜🖤💔🌹🌞🌙⭐☕🍕🍔🍟🍿🍩🍫🍻🥂✈️🏖️🚗📍📸🎵🎶🎮⚽🏏💼💸📌✅❌⚠️😇🤭🤫🥺😜😝🤪🫶'
);
