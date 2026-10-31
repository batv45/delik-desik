// Oyun simülasyonu — grafikten bağımsız saf mantık.
// Tek kişilik modda tarayıcıda, online modda sunucuda (Node) çalışır.
import { generate, sidewalkPoint, HALF, ROADS } from './world.js';

export const LIMIT = HALF - 2;
export const COLORS = ['#ff3d6e', '#3d8bff', '#22c55e', '#f59e0b', '#a855f7', '#06b6d4', '#ef4444', '#ec4899'];
export const BOT_NAMES = ['Simitçi Rıza', 'Dolmuşçu Cemal', 'Tekir', 'Muhtar', 'Bakkal Ahmet', 'Kara Delik', 'Çaycı Hüseyin', 'Hacı Kadri', 'Pazarcı Nuri', 'Boncuk', 'Berber Şükrü'];
export const POWER_DUR = { magnet: 8, turbo: 6, giant: 8 };
const POWER_KINDS = Object.keys(POWER_DUR);
// Zorluk: bot hızı, bot büyüme hızı, insanı kovalarlar mı, insanı yutmak için kaç kat büyük olmalılar,
// insan yutulunca kaybettiği puan oranı
export const DIFFS = {
  kolay: { speed: 0.72, growth: 0.6, hunt: false, ratio: 1.6, loss: 0.2 },
  normal: { speed: 0.85, growth: 0.85, hunt: true, ratio: 1.35, loss: 0.35 },
  zor: { speed: 1.0, growth: 1.1, hunt: true, ratio: 1.2, loss: 0.5 },
};
export const VARIANTS = { person: 24, cat: 6, tree: 9, bush: 6, car: 12, kiosk: 4 };
const GOLD_TYPES = new Set(['person', 'cat', 'simit', 'cone', 'trash', 'bench', 'car', 'cay']);
const REGROW_MIN = 45; // süresiz modda yutulan sabit nesneler bu kadar sn sonra yeniden çıkar

// [taban yarıçapı, puan] — delik bir nesneyi ancak yarıçapı bundan büyükse yutar
const META = {
  person: [0.35, 1], cat: [0.3, 2], cone: [0.25, 1], trash: [0.32, 1], bench: [0.8, 2], lamp: [0.3, 2],
  flag: [0.3, 4], tree: [0.9, 4], bush: [0.6, 2], simit: [0.85, 6], cay: [0.85, 3], kiosk: [1.45, 9],
  car: [1.7, 12], taxi: [1.7, 14], dolmus: [2.4, 22], bus: [4.5, 45], fountain: [2.4, 30], clocktower: [8, 600],
};
export function objMeta(type, s = {}) {
  if (type === 'house' || type === 'apartment') {
    const size = Math.hypot(s.w, s.d) / 2 * 0.85;
    const pts = type === 'house' ? size * size * 3 * (0.7 + s.floors * 0.3) : size * size * 2.2 * (0.6 + s.floors * 0.15);
    return { size, pts: Math.round(pts) };
  }
  const m = META[type];
  return { size: m[0], pts: m[1] };
}
export const holeR = h => h.dispR * (h.power.giant > 0 ? 1.4 : 1);
export const baseR = points => 1.1 + 0.16 * Math.sqrt(points);
export const holeSpeed = h => (7.2 + holeR(h) * 0.35) * (h.power.turbo > 0 ? 1.7 : 1);

const r1 = v => Math.round(v * 10) / 10;
const r2 = v => Math.round(v * 100) / 100;
// Ağ üzerinden gönderilen nesne tanımı (istemci modeli bundan üretir)
export function desc(o) {
  const d = { id: o.id, type: o.type, x: r1(o.x), z: r1(o.z), ry: r2(o.ry), v: o.v };
  if (o.gold) d.gold = 1;
  if (o.w) { d.w = r2(o.w); d.d = r2(o.d); d.f = o.floors; }
  if (o.walker) d.k = 'w'; else if (o.car) d.k = 'c';
  return d;
}
export function fromDesc(d) {
  const o = { id: d.id, type: d.type, x: d.x, z: d.z, ry: d.ry, v: d.v, gold: !!d.gold, walker: d.k === 'w', car: d.k === 'c' };
  if (d.w) { o.w = d.w; o.d = d.d; o.floors = d.f; }
  const m = objMeta(o.type, o);
  o.size = m.size; o.pts = m.pts * (o.gold ? 5 : 1);
  return o;
}

const ROAD_MIN = ROADS[0], ROAD_MAX = ROADS[ROADS.length - 1];
const LANE = 2.2; // şerit, yol ortasından uzaklık (sağdan akış)
const carRy = (axis, dir) => (axis === 'z' ? (dir > 0 ? 0 : Math.PI) : (dir > 0 ? Math.PI / 2 : -Math.PI / 2));

const CELL = 8, GN = Math.ceil((HALF * 2) / CELL) + 1;

export class Sim {
  constructor({ seed, diff = 'normal', endless = false, time = 120, powerups = true }) {
    const { blocks, specs, rng } = generate(seed);
    Object.assign(this, {
      seed, rng, blocks, diff: DIFFS[diff] || DIFFS.normal, endless, time: endless ? 0 : time, t: 0, ended: false,
      objs: new Map(), nextId: 1, holes: [], nextHoleId: 1, powerups: [], nextPwId: 1,
      events: [], regrow: [], pwQueue: [], spawnT: 0, counts: { person: 0, cat: 0, car: 0 },
      cells: Array.from({ length: GN * GN }, () => new Set()),
    });
    for (const s of specs) this.spawn(s.type, s.x, s.z, s.ry, s);
    for (const b of blocks) {
      const open = b.kind === 'park' || b.kind === 'carsi' || b.kind === 'meydan';
      for (let k = 0; k < (open ? 9 : 3); k++) this.spawnWalker('person', b);
      if (rng() < 0.7) this.spawnWalker('cat', b);
    }
    for (const c of ROADS) for (const axis of ['x', 'z']) for (const dir of [1, -1]) {
      for (let k = 0; k < 3; k++) {
        const r = rng();
        const type = r < 0.08 ? 'bus' : r < 0.2 ? 'dolmus' : r < 0.32 ? 'taxi' : 'car';
        this.spawnCar(type, axis, c, dir, ROAD_MIN + rng() * (ROAD_MAX - ROAD_MIN));
      }
    }
    this.targets = { ...this.counts };
    if (powerups) this.spawnPowerups(14); // online'da güç kristalleri kapalı
    this.events.length = 0; // başlangıç dünyası olay sayılmaz
  }

  // ---- ızgara ----
  cellOf(x, z) {
    const cx = Math.max(0, Math.min(GN - 1, ((x + HALF) / CELL) | 0));
    const cz = Math.max(0, Math.min(GN - 1, ((z + HALF) / CELL) | 0));
    return cz * GN + cx;
  }
  gridAdd(o) { o.cell = this.cellOf(o.x, o.z); this.cells[o.cell].add(o); }
  gridRemove(o) { if (o.cell >= 0) this.cells[o.cell].delete(o); o.cell = -1; }
  gridMove(o) { const c = this.cellOf(o.x, o.z); if (c !== o.cell) { this.cells[o.cell].delete(o); o.cell = c; this.cells[c].add(o); } }
  query(x, z, rad, cb) {
    const a0 = Math.max(0, ((x - rad + HALF) / CELL) | 0), a1 = Math.min(GN - 1, ((x + rad + HALF) / CELL) | 0);
    const b0 = Math.max(0, ((z - rad + HALF) / CELL) | 0), b1 = Math.min(GN - 1, ((z + rad + HALF) / CELL) | 0);
    for (let b = b0; b <= b1; b++) for (let a = a0; a <= a1; a++) for (const o of this.cells[b * GN + a]) cb(o);
  }

  // ---- nesneler ----
  spawn(type, x, z, ry, spec = {}, grow = false, extra = null) {
    const r = this.rng;
    const unique = type === 'house' || type === 'apartment';
    const v = spec.v ?? (unique ? (r() * 1e9) | 0 : (r() * (VARIANTS[type] ?? 1)) | 0);
    const gold = GOLD_TYPES.has(type) && r() < 0.05;
    const o = { id: this.nextId++, type, x, z, ry, v, gold, cell: -1 };
    if (unique) { o.w = spec.w; o.d = spec.d; o.floors = spec.floors ?? spec.f; }
    if (extra) Object.assign(o, extra);
    const m = objMeta(type, o);
    o.size = m.size; o.pts = m.pts * (gold ? 5 : 1);
    this.gridAdd(o);
    this.objs.set(o.id, o);
    if (o.walker) this.counts[type]++;
    else if (o.car) this.counts.car++;
    this.events.push({ e: 'spawn', o: desc(o), grow: grow ? 1 : 0 });
    return o;
  }
  randomTarget(o) {
    const b = this.blocks[o.bi], r = this.rng;
    if (o.area) {
      o.tx = b.x0 + 3 + r() * (b.x1 - b.x0 - 6);
      o.tz = b.z0 + 3 + r() * (b.z1 - b.z0 - 6);
    } else {
      const p = sidewalkPoint(b, (r() * 4) | 0, b.x0 + r() * 35, b.z0 + r() * 35, 1.3);
      o.tx = p.x; o.tz = p.z;
    }
  }
  spawnWalker(type, b, farFrom) {
    const open = b.kind === 'park' || b.kind === 'carsi' || b.kind === 'meydan';
    const tmp = { bi: this.blocks.indexOf(b), area: open && this.rng() < 0.6 };
    this.randomTarget(tmp);
    if (farFrom && farFrom.some(h => Math.hypot(tmp.tx - h.x, tmp.tz - h.z) < 25)) return null;
    const o = this.spawn(type, tmp.tx, tmp.tz, this.rng() * 6.28, {}, false, {
      walker: true, bi: tmp.bi, area: tmp.area, speed: type === 'cat' ? 1.1 : 1.3, run: type === 'cat' ? 5.2 : 3.6,
    });
    this.randomTarget(o);
    return o;
  }
  spawnCar(type, axis, line, dir, pos) {
    const lane = line + dir * LANE * (axis === 'z' ? -1 : 1);
    const x = axis === 'z' ? lane : pos, z = axis === 'z' ? pos : lane;
    const speed = type === 'bus' ? 3.2 : type === 'dolmus' ? 4.2 : 3.5 + this.rng() * 1.8; // küçük delik turbosuz yetişebilsin
    return this.spawn(type, x, z, carRy(axis, dir), {}, false, { car: true, axis, dir, line, speed, plan: null });
  }

  // Araçlar yol ağında dolaşır: her kavşaktan önce düz/sağ/sol seçer, dış çevre yolunda mecburen döner.
  // Dönüş, aracın yeni şeridine tam denk gelen noktada yapılır; böylece konum hiç zıplamaz.
  carStep(o, dt) {
    const d = o.dir, key = o.axis;
    const p0 = o[key];
    if (!o.plan) {
      let ahead;
      for (const r of ROADS) if ((r - p0) * d > 0 && (ahead === undefined || Math.abs(r - p0) < Math.abs(ahead - p0))) ahead = r;
      if (ahead === undefined) return this.carUturn(o); // yolun bittiği yerdeyse geri dön
      if ((ahead - p0) * d <= 7) { o.plan = this.carPlan(o, ahead, p0); if (!o.plan) return this.carUturn(o); }
    }
    const p1 = p0 + o.speed * d * dt;
    o[key] = p1;
    const pl = o.plan;
    if (!pl) return;
    if (pl.straight) { if ((p1 - pl.c) * d > LANE + 0.5) o.plan = null; }
    else if ((p1 - pl.t) * d >= 0) {
      o[key] = pl.t;
      o.axis = key === 'z' ? 'x' : 'z';
      o.line = pl.c; o.dir = pl.nd; o.ry = carRy(o.axis, o.dir); o.plan = null;
    }
  }
  carPlan(o, c, p) {
    const d = o.dir, L = o.line, opts = [];
    if (!((d > 0 && c === ROAD_MAX) || (d < 0 && c === ROAD_MIN))) opts.push({ straight: true, c, w: 3 });
    for (const nd of [1, -1]) {
      if ((L === ROAD_MAX && nd > 0) || (L === ROAD_MIN && nd < 0)) continue; // haritanın dışına giden dönüş yok
      const t = o.axis === 'z' ? c + nd * LANE : c - nd * LANE;     // yeni şeridin bu eksendeki konumu
      if ((t - p) * d > 0) opts.push({ c, nd, t, w: 1 });
    }
    if (!opts.length) return null;
    let r = this.rng() * opts.reduce((a, b) => a + b.w, 0);
    for (const x of opts) { r -= x.w; if (r <= 0) return x; }
    return opts[opts.length - 1];
  }
  carUturn(o) {
    o.dir = -o.dir; o.plan = null;
    if (o.axis === 'z') o.x = o.line - o.dir * LANE; else o.z = o.line + o.dir * LANE;
    o.ry = carRy(o.axis, o.dir);
  }
  spawnPowerups(n) {
    const r = this.rng;
    for (let i = 0; i < n; i++) {
      const kind = POWER_KINDS[(r() * POWER_KINDS.length) | 0];
      const c = ROADS[1 + ((r() * (ROADS.length - 2)) | 0)];
      const along = -HALF + 10 + r() * (HALF * 2 - 20);
      const horiz = r() < 0.5;
      const p = { id: this.nextPwId++, kind, x: r1(horiz ? along : c), z: r1(horiz ? c : along) };
      this.powerups.push(p);
      this.events.push({ e: 'pw+', p });
    }
  }

  // ---- delikler ----
  placeFree() {
    const r = this.rng;
    for (let tries = 0; tries < 40; tries++) {
      const c = ROADS[1 + ((r() * (ROADS.length - 2)) | 0)]; // dış çevre yollarında doğma
      const along = -HALF + 25 + r() * (HALF * 2 - 50);
      const p = r() < 0.5 ? { x: c, z: along } : { x: along, z: c };
      if (this.holes.every(h => !h.alive || Math.hypot(h.x - p.x, h.z - p.z) > holeR(h) + 20)) return p;
    }
    return { x: 0, z: 30 };
  }
  addHole({ name, color, human = false }) {
    const p = this.placeFree();
    const h = {
      id: this.nextHoleId++, name, color, human, x: p.x, z: p.z, vx: 0, vz: 0, points: 0, dispR: 1.1, alive: true,
      respawn: 0, shield: 2, combo: 0, lastEat: -9, sinceEat: 9, power: { magnet: 0, turbo: 0, giant: 0 },
      skill: 1, think: 0, tx: p.x, tz: p.z, eatenBy: 0, inx: 0, inz: 0,
    };
    if (!human) h.skill = this.diff.speed * (0.9 + this.rng() * 0.1);
    this.holes.push(h);
    return h;
  }
  removeHole(id) { this.holes = this.holes.filter(h => h.id !== id); }
  addBots(n) {
    const used = new Set(this.holes.map(h => h.name));
    const names = BOT_NAMES.filter(x => !used.has(x)).sort(() => this.rng() - 0.5);
    const usedC = new Set(this.holes.map(h => h.color));
    const cols = [...COLORS.filter(c => !usedC.has(c)), ...COLORS].slice(0, Math.max(n, 1));
    for (let i = 0; i < n; i++) this.addHole({ name: names[i % names.length] || 'Bot', color: cols[i % cols.length] });
  }
  hole(id) { return this.holes.find(h => h.id === id); }
  setInput(id, x, z) {
    const h = this.hole(id);
    if (!h) return;
    const l = Math.hypot(x, z);
    if (l > 1) { x /= l; z /= l; }
    h.inx = x || 0; h.inz = z || 0;
  }
  addPoints(h, p) { h.points += h.human ? p : Math.max(1, Math.round(p * this.diff.growth)); }
  // a deliği b'yi yutabilmek için b'den kaç kat büyük olmalı
  eatRatio(a, b) { return b.human && !a.human ? this.diff.ratio : 1.2; }

  botThink(h) {
    h.think = 0.3 + this.rng() * 0.2;
    const R = holeR(h);
    let fx = 0, fz = 0, danger = false;
    for (const o of this.holes) {
      if (o === h || !o.alive) continue;
      const d = Math.hypot(o.x - h.x, o.z - h.z) || 0.01;
      if (holeR(o) > R * this.eatRatio(o, h) && d < holeR(o) + 14) { fx += (h.x - o.x) / d; fz += (h.z - o.z) / d; danger = true; }
    }
    if (danger) { h.tx = h.x + fx * 20; h.tz = h.z + fz * 20; return; }
    let best = null, bestS = 0;
    for (const o of this.holes) {
      if (o === h || !o.alive || o.shield > 0 || (o.human && !this.diff.hunt)) continue;
      const d = Math.hypot(o.x - h.x, o.z - h.z);
      if (R > holeR(o) * this.eatRatio(h, o) * 1.05 && d < 30) { const s = (o.points + 20) / (d + 4) * 1.5; if (s > bestS) { bestS = s; best = o; } }
    }
    for (const p of this.powerups) {
      const d = Math.hypot(p.x - h.x, p.z - h.z);
      if (d < 30) { const s = 30 / (d + 4); if (s > bestS) { bestS = s; best = p; } }
    }
    this.query(h.x, h.z, 18 + R * 1.5, o => {
      if (o.size >= R * 0.92) return;
      const s = o.pts / (Math.hypot(o.x - h.x, o.z - h.z) + 5);
      if (s > bestS) { bestS = s; best = o; }
    });
    if (best) { h.tx = best.x; h.tz = best.z; }
    else if (Math.hypot(h.tx - h.x, h.tz - h.z) < 3) {
      h.tx = (this.rng() - 0.5) * HALF * 1.6; h.tz = (this.rng() - 0.5) * HALF * 1.6;
    }
  }

  eat(o, h) {
    this.gridRemove(o);
    this.objs.delete(o.id);
    o.dead = true;
    if (o.walker) this.counts[o.type]--;
    else if (o.car) this.counts.car--;
    h.combo = this.t - h.lastEat < 1.3 ? h.combo + 1 : 1;
    h.lastEat = this.t;
    const gained = Math.max(1, Math.round(o.pts * (1 + Math.min(h.combo - 1, 20) * 0.1)));
    this.addPoints(h, gained);
    this.events.push({ e: 'eat', id: o.id, h: h.id, g: gained, c: h.combo });
    if (this.endless && !o.walker && !o.car) this.regrow.push({ spec: desc(o), at: this.t + REGROW_MIN + 2 + this.rng() * 30 });
  }
  eatHole(big, small) {
    small.alive = false;
    small.respawn = 3;
    small.eatenBy = big.id;
    const gain = Math.max(15, Math.round(small.points * 0.4));
    this.addPoints(big, gain);
    small.points = Math.round(small.points * (1 - (small.human ? this.diff.loss : 0.5)));
    small.combo = 0;
    for (const k in small.power) small.power[k] = 0;
    this.events.push({ e: 'gulp', a: big.id, b: small.id, g: gain });
  }

  step(dt) {
    if (this.ended) return;
    this.t += dt;
    if (this.endless) this.time += dt;
    else { this.time -= dt; if (this.time <= 0) { this.time = 0; this.ended = true; this.events.push({ e: 'end' }); return; } }

    for (const h of this.holes) {
      for (const k in h.power) if (h.power[k] > 0) h.power[k] = Math.max(0, h.power[k] - dt);
      if (h.shield > 0) h.shield -= dt;
      h.sinceEat = this.t - h.lastEat;
      if (!h.alive) {
        h.dispR = Math.max(0.01, h.dispR - dt * 4);
        const by = this.hole(h.eatenBy);
        if (by) { h.x += (by.x - h.x) * Math.min(1, dt * 6); h.z += (by.z - h.z) * Math.min(1, dt * 6); }
        h.respawn -= dt;
        if (h.respawn <= 0) {
          const p = this.placeFree();
          Object.assign(h, { x: p.x, z: p.z, tx: p.x, tz: p.z, vx: 0, vz: 0, alive: true, shield: 3, dispR: 0.3, eatenBy: 0 });
        }
        continue;
      }
      h.dispR += (baseR(h.points) - h.dispR) * Math.min(1, dt * 3);
      let dx, dz;
      if (h.human) { dx = h.inx; dz = h.inz; }
      else {
        h.think -= dt;
        if (h.think <= 0) this.botThink(h);
        const ex = h.tx - h.x, ez = h.tz - h.z, l = Math.hypot(ex, ez);
        dx = l > 0.5 ? ex / l * h.skill : 0; dz = l > 0.5 ? ez / l * h.skill : 0;
      }
      const speed = holeSpeed(h);
      h.vx += (dx * speed - h.vx) * Math.min(1, dt * 8);
      h.vz += (dz * speed - h.vz) * Math.min(1, dt * 8);
      h.x = Math.max(-LIMIT, Math.min(LIMIT, h.x + h.vx * dt));
      h.z = Math.max(-LIMIT, Math.min(LIMIT, h.z + h.vz * dt));

      const R = holeR(h);
      this.query(h.x, h.z, R, o => {
        if (o.size < R * 0.92 && Math.hypot(o.x - h.x, o.z - h.z) < R - o.size * 0.3) this.eat(o, h);
      });
      if (h.power.magnet > 0) {
        const mr = R * 3.2 + 4;
        this.query(h.x, h.z, mr, o => {
          if (o.size >= R * 0.92) return;
          const ex = h.x - o.x, ez = h.z - o.z, d = Math.hypot(ex, ez);
          if (d > mr || d < 0.01) return;
          const s = Math.min(d, (6 + 14 * (1 - d / mr)) * dt);
          o.x += ex / d * s; o.z += ez / d * s;
          o.pulled = 0.3; o.moved = true;
          this.gridMove(o);
        });
      }
      for (let i = this.powerups.length - 1; i >= 0; i--) {
        const p = this.powerups[i];
        if (Math.hypot(p.x - h.x, p.z - h.z) < R + 0.8) {
          h.power[p.kind] = POWER_DUR[p.kind];
          this.powerups.splice(i, 1);
          this.pwQueue.push(this.t + 6);
          this.events.push({ e: 'pw-', id: p.id, h: h.id, kind: p.kind });
        }
      }
    }
    for (const a of this.holes) for (const b of this.holes) {
      if (a === b || !a.alive || !b.alive || b.shield > 0) continue;
      if (holeR(a) > holeR(b) * this.eatRatio(a, b) && Math.hypot(a.x - b.x, a.z - b.z) < holeR(a) - holeR(b) * 0.4) this.eatHole(a, b);
    }

    // yayalar, kediler, araçlar
    for (const o of this.objs.values()) {
      if (o.pulled > 0) { o.pulled -= dt; continue; }
      if (o.walker) {
        let fx = 0, fz = 0, flee = false;
        for (const h of this.holes) {
          const R = holeR(h);
          if (!h.alive || R < o.size * 1.05) continue;
          const ex = o.x - h.x, ez = o.z - h.z, d = Math.hypot(ex, ez);
          if (d < R + 5) { fx += ex / (d + 0.01); fz += ez / (d + 0.01); flee = true; }
        }
        let mx, mz, sp;
        if (flee) { const l = Math.hypot(fx, fz) || 1; mx = fx / l; mz = fz / l; sp = o.run; o.scared = 1.5; }
        else {
          const ex = o.tx - o.x, ez = o.tz - o.z, d = Math.hypot(ex, ez);
          if (d < 0.6) { this.randomTarget(o); continue; }
          mx = ex / d; mz = ez / d; sp = o.scared > 0 ? o.run * 0.6 : o.speed;
          if (o.scared > 0) { o.scared -= dt; if (o.scared <= 0) this.randomTarget(o); }
        }
        o.x = Math.max(-LIMIT, Math.min(LIMIT, o.x + mx * sp * dt));
        o.z = Math.max(-LIMIT, Math.min(LIMIT, o.z + mz * sp * dt));
        o.ry = Math.atan2(mx, mz);
        this.gridMove(o);
      } else if (o.car) {
        this.carStep(o, dt);
        this.gridMove(o);
      }
    }

    // canlı nüfusu ve kristalleri tazele
    for (let i = this.pwQueue.length - 1; i >= 0; i--) if (this.pwQueue[i] <= this.t) { this.pwQueue.splice(i, 1); this.spawnPowerups(1); }
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = 0.7;
      const r = this.rng;
      for (let i = this.regrow.length - 1; i >= 0; i--) {
        const g = this.regrow[i];
        if (g.at > this.t) continue;
        const s = g.spec;
        if (!this.holes.every(h => !h.alive || Math.hypot(h.x - s.x, h.z - s.z) > holeR(h) + 14)) { g.at = this.t + 3; continue; }
        this.spawn(s.type, s.x, s.z, s.ry, s, true);
        this.regrow.splice(i, 1);
      }
      const far = this.holes.filter(h => h.human);
      const blk = () => this.blocks[(r() * this.blocks.length) | 0];
      if (this.counts.person < this.targets.person * 0.75) this.spawnWalker('person', blk(), far);
      if (this.counts.cat < this.targets.cat * 0.75) this.spawnWalker('cat', blk(), far);
      if (this.counts.car < this.targets.car * 0.6) {
        // yeni araç oyunculardan uzakta, yolun üzerinde belirir
        const ax = r() < 0.5 ? 'x' : 'z', dir = r() < 0.5 ? 1 : -1, line = ROADS[(r() * ROADS.length) | 0];
        const pos = ROAD_MIN + r() * (ROAD_MAX - ROAD_MIN);
        const x = ax === 'z' ? line : pos, z = ax === 'z' ? pos : line;
        if (far.every(h => Math.hypot(h.x - x, h.z - z) > 35)) this.spawnCar(r() < 0.15 ? 'dolmus' : 'car', ax, line, dir, pos);
      }
    }
  }

  drain() { const e = this.events; this.events = []; return e; }
}
