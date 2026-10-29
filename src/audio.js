// Ses efektleri — dosya yok, hepsi WebAudio ile anlık üretilir.
let ctx = null, master = null, lastPop = 0;
export const Sfx = {
  muted: localStorage.getItem('dd_muted') === '1',
  unlock() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = this.muted ? 0 : 0.5;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
  },
  toggle() {
    this.muted = !this.muted;
    localStorage.setItem('dd_muted', this.muted ? '1' : '0');
    if (master) master.gain.value = this.muted ? 0 : 0.5;
    return this.muted;
  },
  _tone(type, f0, f1, dur, vol = 0.3, delay = 0) {
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  },
  pop(size, combo) {
    if (!ctx) return;
    const now = performance.now();
    if (now - lastPop < 45) return;
    lastPop = now;
    const f = 900 / (1 + size * 0.6) + Math.min(combo, 30) * 18;
    this._tone('triangle', f, f * 0.45, 0.12 + Math.min(size, 6) * 0.04, 0.22 + Math.min(size, 6) * 0.03);
  },
  gold() {
    [880, 1175, 1568].forEach((f, i) => this._tone('square', f, f, 0.09, 0.08, i * 0.06));
  },
  power() {
    [523, 659, 784, 1046].forEach((f, i) => this._tone('triangle', f, f * 1.01, 0.12, 0.2, i * 0.07));
  },
  big() { this._tone('sawtooth', 160, 40, 0.6, 0.25); },
  gulp() { this._tone('sine', 300, 50, 0.5, 0.4); this._tone('square', 120, 30, 0.4, 0.1, 0.05); },
  lose() { [392, 330, 262].forEach((f, i) => this._tone('triangle', f, f * 0.9, 0.22, 0.25, i * 0.18)); },
  end() { [523, 659, 784, 659, 1046].forEach((f, i) => this._tone('triangle', f, f, 0.18, 0.22, i * 0.12)); },
  tick() { this._tone('square', 1200, 1200, 0.05, 0.06); },
};
