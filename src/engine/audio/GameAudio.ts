/**
 * Small WebAudio sound player. Built-in sounds are synthesised (no files),
 * imported audio assets are decoded on first use and cached. Audio must be
 * unlocked by a user gesture on iOS, which the Play button provides.
 */

export const BUILTIN_SOUNDS = ['beep', 'coin', 'jump', 'hit'] as const;

type Loader = (name: string) => Promise<ArrayBuffer | null>;

export class GameAudio {
  private ctx: AudioContext | null = null;
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private lastPlayed = new Map<string, number>();
  private volume = 0.6;

  constructor(private readonly loadByName: Loader) {}

  /** Call from a user gesture (e.g. pressing Play) so iOS allows audio. */
  unlock(): void {
    try {
      if (!this.ctx) {
        const Ctx = (globalThis.AudioContext ??
          (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) as
          | typeof AudioContext
          | undefined;
        if (!Ctx) return;
        this.ctx = new Ctx();
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
  }

  play(name: string): void {
    const ctx = this.ctx;
    if (!ctx || this.volume === 0) return;
    // Avoid ear-splitting stacks when a script plays the same sound every frame.
    const now = ctx.currentTime;
    if (now - (this.lastPlayed.get(name) ?? -1) < 0.05) return;
    this.lastPlayed.set(name, now);
    if ((BUILTIN_SOUNDS as readonly string[]).includes(name)) {
      this.synth(name);
      return;
    }
    let p = this.buffers.get(name);
    if (!p) {
      p = this.loadByName(name)
        .then((data) => (data ? ctx.decodeAudioData(data.slice(0)) : null))
        .catch(() => null);
      this.buffers.set(name, p);
    }
    void p.then((buffer) => {
      if (!buffer || !this.ctx) return;
      const src = this.ctx.createBufferSource();
      const gain = this.ctx.createGain();
      gain.gain.value = this.volume;
      src.buffer = buffer;
      src.connect(gain).connect(this.ctx.destination);
      src.start();
    });
  }

  private synth(name: string): void {
    const ctx = this.ctx as AudioContext;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain).connect(ctx.destination);
    const v = this.volume * 0.4;
    switch (name) {
      case 'coin':
        osc.type = 'square';
        osc.frequency.setValueAtTime(988, t);
        osc.frequency.setValueAtTime(1319, t + 0.08);
        gain.gain.setValueAtTime(v, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
        osc.start(t);
        osc.stop(t + 0.35);
        break;
      case 'jump':
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(300, t);
        osc.frequency.exponentialRampToValueAtTime(700, t + 0.18);
        gain.gain.setValueAtTime(v, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
        osc.start(t);
        osc.stop(t + 0.25);
        break;
      case 'hit':
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(180, t);
        osc.frequency.exponentialRampToValueAtTime(60, t + 0.15);
        gain.gain.setValueAtTime(v, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
        osc.start(t);
        osc.stop(t + 0.18);
        break;
      default:
        osc.type = 'sine';
        osc.frequency.setValueAtTime(660, t);
        gain.gain.setValueAtTime(v, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
        osc.start(t);
        osc.stop(t + 0.2);
    }
  }

  dispose(): void {
    this.buffers.clear();
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
  }
}
