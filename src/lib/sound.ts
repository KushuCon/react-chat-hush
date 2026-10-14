let ctx: AudioContext | null = null;

/** Call from a click or tap so the browser allows sound later. */
export function unlockAudio(): void {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx ??= new AC();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    /* ignore */
  }
}

/** Two short soft tones. */
export function playPing(): void {
  try {
    if (!ctx) return;
    const t0 = ctx.currentTime;
    [660, 990].forEach((freq, i) => {
      const o = ctx!.createOscillator();
      const g = ctx!.createGain();
      o.type = 'sine';
      o.frequency.value = freq;
      const s = t0 + i * 0.11;
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(0.18, s + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.16);
      o.connect(g).connect(ctx!.destination);
      o.start(s);
      o.stop(s + 0.18);
    });
  } catch {
    /* ignore */
  }
}
