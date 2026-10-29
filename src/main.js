import * as THREE from 'three';
import { Models, SHARED } from './models.js';
import { generate, drawGround, sidewalkPoint, mulberry32, HALF, ROADS, ROAD_HW } from './world.js';
import { Sfx } from './audio.js';

const REGROW_MIN = 45; // süresiz modda yutulan sabit nesneler bu kadar sn sonra yeniden çıkar
const LIMIT = HALF - 2;
const BOT_NAMES = ['Simitçi Rıza', 'Dolmuşçu Cemal', 'Tekir', 'Muhtar', 'Bakkal Ahmet', 'Kara Delik', 'Çaycı Hüseyin', 'Hacı Kadri', 'Pazarcı Nuri'];
const COLORS = ['#ff3d6e', '#3d8bff', '#22c55e', '#f59e0b', '#a855f7', '#06b6d4', '#ef4444', '#ec4899'];
const POWERS = {
  magnet: { name: 'Mıknatıs', icon: '🧲', color: 0xff3b3b, dur: 8 },
  turbo: { name: 'Turbo', icon: '⚡', color: 0x22d3ee, dur: 6 },
  giant: { name: 'Dev Delik', icon: '🌀', color: 0xa855f7, dur: 8 },
};
// Zorluk: bot hızı, bot büyüme hızı, oyuncuyu kovalarlar mı, seni yutmak için ne kadar büyük olmaları gerekir,
// yutulunca kaybettiğin puan oranı
const DIFFS = {
  kolay: { speed: 0.72, growth: 0.6, hunt: false, ratio: 1.6, loss: 0.2 },
  normal: { speed: 0.85, growth: 0.85, hunt: true, ratio: 1.35, loss: 0.35 },
  zor: { speed: 1.0, growth: 1.1, hunt: true, ratio: 1.2, loss: 0.5 },
};
const GOLD_TYPES = new Set(['person', 'cat', 'simit', 'cone', 'trash', 'bench', 'car', 'cay']);

const $ = id => document.getElementById(id);
const isTouch = matchMedia('(pointer: coarse)').matches;

// ---------- Renderer / sahne ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, stencil: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, isTouch ? 1.5 : 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xa7d8ff);
scene.fog = new THREE.Fog(0xa7d8ff, 80, 220);
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.5, 600);

scene.add(new THREE.HemisphereLight(0xeaf6ff, 0x6b7d5a, 1.7));
const sun = new THREE.DirectionalLight(0xfff1d6, 2.2);
sun.castShadow = true;
sun.shadow.mapSize.set(isTouch ? 1024 : 2048, isTouch ? 1024 : 2048);
sun.shadow.bias = -0.0008;
sun.shadow.normalBias = 0.04;
scene.add(sun, sun.target);

// Delik maskesi: zemine stencil ile "gerçek" bir boşluk açar
const maskMat = new THREE.MeshBasicMaterial({
  colorWrite: false, depthWrite: false,
  stencilWrite: true, stencilRef: 1, stencilFunc: THREE.AlwaysStencilFunc, stencilZPass: THREE.ReplaceStencilOp,
});
const groundStencil = { stencilWrite: true, stencilRef: 1, stencilFunc: THREE.NotEqualStencilFunc };

const groundTex = new THREE.CanvasTexture(document.createElement('canvas'));
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(HALF * 2, HALF * 2).rotateX(-Math.PI / 2),
  new THREE.MeshLambertMaterial({ map: groundTex, ...groundStencil })
);
ground.receiveShadow = true;
ground.renderOrder = -5;
scene.add(ground);
const outer = new THREE.Mesh(
  new THREE.PlaneGeometry(1200, 1200).rotateX(-Math.PI / 2),
  new THREE.MeshLambertMaterial({ color: 0x5f8f55, ...groundStencil })
);
outer.position.y = -0.02;
outer.renderOrder = -5;
scene.add(outer);

const holeGeo = {
  mask: new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2),
  rim: new THREE.RingGeometry(1, 1.08, 48).rotateX(-Math.PI / 2),
  wall: (() => {
    const g = new THREE.CylinderGeometry(1, 1, 3, 48, 4, true);
    const pos = g.attributes.position, col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const t = (pos.getY(i) + 1.5) / 3; // 1 = üst
      const v = 0.02 + t * t * 0.16;
      col[i * 3] = v; col[i * 3 + 1] = v; col[i * 3 + 2] = v * 1.15;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.translate(0, -1.5, 0);
    return g;
  })(),
  bottom: new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2).translate(0, -3, 0),
};
const wallMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide });
const bottomMat = new THREE.MeshBasicMaterial({ color: 0x020203 });

// ---------- Uzamsal ızgara ----------
const CELL = 8, GN = Math.ceil((HALF * 2) / CELL) + 1;
let cells = [];
const cellOf = (x, z) => {
  const cx = Math.max(0, Math.min(GN - 1, ((x + HALF) / CELL) | 0));
  const cz = Math.max(0, Math.min(GN - 1, ((z + HALF) / CELL) | 0));
  return cz * GN + cx;
};
function gridAdd(o) { o.cell = cellOf(o.x, o.z); cells[o.cell].add(o); }
function gridRemove(o) { if (o.cell >= 0) cells[o.cell].delete(o); o.cell = -1; }
function gridMove(o) { const c = cellOf(o.x, o.z); if (c !== o.cell) { cells[o.cell].delete(o); o.cell = c; cells[c].add(o); } }
function query(x, z, rad, cb) {
  const a0 = Math.max(0, ((x - rad + HALF) / CELL) | 0), a1 = Math.min(GN - 1, ((x + rad + HALF) / CELL) | 0);
  const b0 = Math.max(0, ((z - rad + HALF) / CELL) | 0), b1 = Math.min(GN - 1, ((z + rad + HALF) / CELL) | 0);
  for (let b = b0; b <= b1; b++) for (let a = a0; a <= a1; a++) for (const o of cells[b * GN + a]) cb(o);
}

// ---------- Model önbelleği ----------
const cache = {};
const VARIANTS = { person: 24, cat: 6, tree: 9, bush: 6, car: 12, kiosk: 4 };
function getModel(type, rng, spec) {
  if (type === 'house') return { ...Models.house(rng, spec.w, spec.d, spec.floors), unique: true };
  if (type === 'apartment') return { ...Models.apartment(rng, spec.w, spec.d, spec.floors), unique: true };
  const list = (cache[type] ??= []);
  const n = VARIANTS[type] ?? 1;
  if (list.length < n) { const m = Models[type](rng); list.push(m); return m; }
  return list[(rng() * list.length) | 0];
}

// ---------- Oyun durumu ----------
const G = {
  state: 'menu', diff: DIFFS.normal, botCount: 6, time: 120, endless: false, regrow: [], objs: [], holes: [], powerups: [], falling: [],
  player: null, rng: Math.random, blocks: [], spawnT: 0, t: 0, counts: {},
  targets: { person: 0, cat: 0, car: 0 },
};

function clearWorld() {
  for (const o of G.objs) { scene.remove(o.mesh); if (o.unique) o.mesh.geometry.dispose(); }
  for (const h of G.holes) { scene.remove(h.group); h.label.remove(); }
  for (const p of G.powerups) scene.remove(p.mesh);
  for (const o of fadeSet) o.fadeMat?.dispose();
  fadeSet.clear();
  G.objs = []; G.holes = []; G.powerups = []; G.falling = []; G.regrow = [];
  cells = Array.from({ length: GN * GN }, () => new Set());
}

function buildWorld(seed) {
  clearWorld();
  G.gen = (G.gen || 0) + 1;
  const { blocks, specs, rng } = generate(seed);
  G.rng = rng; G.blocks = blocks;
  const cv = drawGround(blocks, isTouch ? 2048 : 3072);
  groundTex.image = cv;
  groundTex.colorSpace = THREE.SRGBColorSpace;
  groundTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  groundTex.needsUpdate = true;
  drawMinimapBase(cv);

  for (const s of specs) spawnObj(s.type, s.x, s.z, s.ry, s);
  // yayalar ve kediler
  for (const b of blocks) {
    const open = b.kind === 'park' || b.kind === 'carsi' || b.kind === 'meydan';
    for (let k = 0; k < (open ? 9 : 3); k++) spawnWalker('person', b);
    if (rng() < 0.7) spawnWalker('cat', b);
  }
  // trafik
  for (const c of ROADS) for (const axis of ['x', 'z']) for (const dir of [1, -1]) {
    for (let k = 0; k < 3; k++) {
      const r = rng();
      const type = r < 0.08 ? 'bus' : r < 0.2 ? 'dolmus' : r < 0.32 ? 'taxi' : 'car';
      spawnCar(type, axis, c, dir, -HALF + rng() * HALF * 2);
    }
  }
  G.targets = { person: count('person'), cat: count('cat'), car: G.objs.filter(o => o.car).length };
  spawnPowerups(14);
}
const count = t => G.objs.reduce((n, o) => n + (o.type === t && !o.dead ? 1 : 0), 0);

function spawnObj(type, x, z, ry, spec = {}) {
  const m = getModel(type, G.rng, spec);
  const gold = GOLD_TYPES.has(type) && !spec.noGold && G.rng() < 0.05;
  const mesh = new THREE.Mesh(m.geo, gold ? SHARED.gold : SHARED.mat);
  mesh.position.set(x, 0, z);
  mesh.rotation.y = ry;
  mesh.castShadow = true;
  scene.add(mesh);
  const o = { type, mesh, x, z, size: m.size, pts: m.pts * (gold ? 5 : 1), gold, unique: !!m.unique, cell: -1, spec: { ...spec, type, x, z, ry } };
  gridAdd(o);
  G.objs.push(o);
  return o;
}

function randomTarget(o) {
  const b = o.block;
  if (o.area) {
    o.tx = b.x0 + 3 + G.rng() * (b.x1 - b.x0 - 6);
    o.tz = b.z0 + 3 + G.rng() * (b.z1 - b.z0 - 6);
  } else {
    const side = (G.rng() * 4) | 0;
    const p = sidewalkPoint(b, side, b.x0 + G.rng() * 35, b.z0 + G.rng() * 35, 1.3);
    o.tx = p.x; o.tz = p.z;
  }
}
function spawnWalker(type, b, farFrom) {
  const open = b.kind === 'park' || b.kind === 'carsi' || b.kind === 'meydan';
  const area = open && G.rng() < 0.6;
  const tmp = { block: b, area };
  randomTarget(tmp);
  if (farFrom && Math.hypot(tmp.tx - farFrom.x, tmp.tz - farFrom.z) < 25) return null;
  const o = spawnObj(type, tmp.tx, tmp.tz, G.rng() * 6.28);
  Object.assign(o, { walker: true, block: b, area, speed: type === 'cat' ? 1.1 : 1.3, run: type === 'cat' ? 5.2 : 3.6, phase: G.rng() * 10 });
  randomTarget(o);
  return o;
}
function spawnCar(type, axis, line, dir, pos) {
  const lane = line + dir * 2.2 * (axis === 'z' ? -1 : 1);
  const x = axis === 'z' ? lane : pos, z = axis === 'z' ? pos : lane;
  const ry = axis === 'z' ? (dir > 0 ? 0 : Math.PI) : (dir > 0 ? Math.PI / 2 : -Math.PI / 2);
  const o = spawnObj(type, x, z, ry);
  const base = type === 'bus' ? 3.2 : type === 'dolmus' ? 4.2 : 3.5 + G.rng() * 1.8; // küçük delik turbosuz yetişebilsin
  Object.assign(o, { car: true, axis, dir, speed: base });
  return o;
}

function spawnPowerups(n) {
  for (let i = 0; i < n; i++) {
    const keys = Object.keys(POWERS);
    const kind = keys[(G.rng() * keys.length) | 0];
    const c = ROADS[1 + ((G.rng() * (ROADS.length - 2)) | 0)];
    const along = -HALF + 10 + G.rng() * (HALF * 2 - 20);
    const horiz = G.rng() < 0.5;
    const x = horiz ? along : c, z = horiz ? c : along;
    const grp = new THREE.Group();
    const cache = (POWERS[kind].geo ??= Models.powerup(POWERS[kind].color));
    const gem = new THREE.Mesh(cache, new THREE.MeshLambertMaterial({ vertexColors: true, emissive: POWERS[kind].color, emissiveIntensity: 0.6, flatShading: true }));
    gem.position.y = 1.4; gem.castShadow = true;
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.3, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: POWERS[kind].color, transparent: true, opacity: 0.55, depthWrite: false }));
    ring.position.y = 0.04;
    grp.add(gem, ring);
    grp.position.set(x, 0, z);
    scene.add(grp);
    G.powerups.push({ kind, x, z, mesh: grp, gem, ring });
  }
}

// ---------- Delik ----------
class Hole {
  constructor(name, color, isPlayer, x, z) {
    Object.assign(this, { name, color, isPlayer, x, z, vx: 0, vz: 0, points: 0, dispR: 1.1, alive: true, respawn: 0,
      shield: 2, combo: 0, lastEat: -9, power: { magnet: 0, turbo: 0, giant: 0 }, skill: 1, think: 0, tx: x, tz: z, eatenBy: null });
    this.group = new THREE.Group();
    const mask = new THREE.Mesh(holeGeo.mask, maskMat); mask.position.y = 0.012; mask.renderOrder = -10;
    this.rimMat = new THREE.MeshBasicMaterial({ color });
    const rim = new THREE.Mesh(holeGeo.rim, this.rimMat); rim.position.y = 0.03;
    this.group.add(mask, rim, new THREE.Mesh(holeGeo.wall, wallMat), new THREE.Mesh(holeGeo.bottom, bottomMat));
    scene.add(this.group);
    this.label = document.createElement('div');
    this.label.className = 'tag' + (isPlayer ? ' me' : '');
    this.label.textContent = name;
    this.label.style.setProperty('--c', color);
    $('labels').appendChild(this.label);
  }
  get baseR() { return 1.1 + 0.16 * Math.sqrt(this.points); }
  get R() { return this.dispR * (this.power.giant > 0 ? 1.4 : 1); }
  addPoints(p) { this.points += this.isPlayer ? p : Math.max(1, Math.round(p * G.diff.growth)); }
}

function placeFree() {
  for (let tries = 0; tries < 40; tries++) {
    const c = ROADS[1 + ((G.rng() * (ROADS.length - 2)) | 0)]; // dış çevre yollarında doğma
    const along = -HALF + 25 + G.rng() * (HALF * 2 - 50);
    const p = G.rng() < 0.5 ? { x: c, z: along } : { x: along, z: c };
    if (Math.abs(p.x) > LIMIT || Math.abs(p.z) > LIMIT) continue;
    if (G.holes.every(h => !h.alive || Math.hypot(h.x - p.x, h.z - p.z) > h.R + 20)) return p;
  }
  return { x: 0, z: 30 };
}

function addBots(n) {
  const names = [...BOT_NAMES].sort(() => G.rng() - 0.5);
  const cols = COLORS.filter(c => c !== G.player?.color).sort(() => G.rng() - 0.5);
  for (let i = 0; i < n; i++) {
    const p = placeFree();
    const h = new Hole(names[i], cols[i % cols.length], false, p.x, p.z);
    h.skill = G.diff.speed * (0.9 + G.rng() * 0.1);
    G.holes.push(h);
  }
}

// ---------- Girdi ----------
const input = { x: 0, z: 0, mouse: false, keys: new Set(), touchId: null, ox: 0, oy: 0 };
addEventListener('mousemove', e => {
  if (G.state !== 'play') return;
  const s = Math.min(innerWidth, innerHeight) * 0.22;
  let dx = (e.clientX - innerWidth / 2) / s, dz = (e.clientY - innerHeight / 2) / s;
  const l = Math.hypot(dx, dz); if (l > 1) { dx /= l; dz /= l; }
  input.x = dx; input.z = dz; input.mouse = true;
});
const joy = $('joy'), knob = $('knob');
addEventListener('touchstart', e => {
  if (G.state !== 'play' || input.touchId !== null) return;
  const t = e.changedTouches[0];
  input.touchId = t.identifier; input.ox = t.clientX; input.oy = t.clientY;
  joy.style.left = t.clientX + 'px'; joy.style.top = t.clientY + 'px'; joy.style.display = 'block';
  knob.style.transform = 'translate(-50%,-50%)';
}, { passive: true });
addEventListener('touchmove', e => {
  for (const t of e.changedTouches) if (t.identifier === input.touchId) {
    let dx = (t.clientX - input.ox) / 55, dz = (t.clientY - input.oy) / 55;
    const l = Math.hypot(dx, dz); if (l > 1) { dx /= l; dz /= l; }
    input.x = dx; input.z = dz;
    knob.style.transform = `translate(calc(-50% + ${dx * 45}px), calc(-50% + ${dz * 45}px))`;
  }
}, { passive: true });
const endTouch = e => {
  for (const t of e.changedTouches) if (t.identifier === input.touchId) {
    input.touchId = null; input.x = 0; input.z = 0; joy.style.display = 'none';
  }
};
addEventListener('touchend', endTouch); addEventListener('touchcancel', endTouch);
addEventListener('keydown', e => { input.keys.add(e.key.toLowerCase()); if (e.key === 'm') $('mute').click(); });
addEventListener('keyup', e => input.keys.delete(e.key.toLowerCase()));
function readInput() {
  const k = input.keys;
  let x = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0);
  let z = (k.has('s') || k.has('arrowdown') ? 1 : 0) - (k.has('w') || k.has('arrowup') ? 1 : 0);
  if (x || z) { const l = Math.hypot(x, z); return { x: x / l, z: z / l }; }
  return { x: input.x, z: input.z };
}

// ---------- Bot zekası ----------
function botThink(h) {
  h.think = 0.3 + G.rng() * 0.2;
  const R = h.R;
  let fx = 0, fz = 0, danger = false;
  for (const o of G.holes) {
    if (o === h || !o.alive) continue;
    const d = Math.hypot(o.x - h.x, o.z - h.z);
    if (o.R > R * eatRatio(o, h) && d < o.R + 14) { fx += (h.x - o.x) / d; fz += (h.z - o.z) / d; danger = true; }
  }
  if (danger) { h.tx = h.x + fx * 20; h.tz = h.z + fz * 20; return; }
  let best = null, bestS = 0;
  for (const o of G.holes) {
    if (o === h || !o.alive || o.shield > 0 || (o.isPlayer && !G.diff.hunt)) continue;
    const d = Math.hypot(o.x - h.x, o.z - h.z);
    if (R > o.R * eatRatio(h, o) * 1.05 && d < 30) { const s = (o.points + 20) / (d + 4) * 1.5; if (s > bestS) { bestS = s; best = o; } }
  }
  for (const p of G.powerups) {
    const d = Math.hypot(p.x - h.x, p.z - h.z);
    if (d < 30) { const s = 30 / (d + 4); if (s > bestS) { bestS = s; best = p; } }
  }
  const rad = 18 + R * 1.5;
  query(h.x, h.z, rad, o => {
    if (o.size >= R * 0.92) return;
    const d = Math.hypot(o.x - h.x, o.z - h.z);
    const s = o.pts / (d + 5);
    if (s > bestS) { bestS = s; best = o; }
  });
  if (best) { h.tx = best.x; h.tz = best.z; }
  else if (Math.hypot(h.tx - h.x, h.tz - h.z) < 3) {
    h.tx = (G.rng() - 0.5) * HALF * 1.6; h.tz = (G.rng() - 0.5) * HALF * 1.6;
  }
}

// ---------- Yutma ----------
function eat(o, h) {
  gridRemove(o);
  o.dead = true;
  o.fall = { h, vy: 0, ax: 0, az: 0 };
  const dx = h.x - o.x, dz = h.z - o.z, l = Math.hypot(dx, dz) || 1;
  o.fall.axis = new THREE.Vector3(dz / l, 0, -dx / l);
  G.falling.push(o);
  const now = G.t;
  h.combo = now - h.lastEat < 1.3 ? h.combo + 1 : 1;
  h.lastEat = now;
  const mult = 1 + Math.min(h.combo - 1, 20) * 0.1;
  const gained = Math.max(1, Math.round(o.pts * mult));
  h.addPoints(gained);
  if (h.isPlayer) {
    Sfx.pop(o.size, h.combo);
    if (o.gold) { Sfx.gold(); floatText(o.x, o.z, `ALTIN! +${gained}`, 'gold'); }
    else if (o.pts >= 30) { Sfx.big(); floatText(o.x, o.z, `+${gained}`, 'big'); }
    else if (o.pts >= 3) floatText(o.x, o.z, `+${gained}`);
    if (o.type === 'clocktower') toast('Saat kulesini yuttun! 🕰️');
  }
}

// a deliği b'yi yutabilmek için b'den kaç kat büyük olmalı
const eatRatio = (a, b) => (b.isPlayer && !a.isPlayer ? G.diff.ratio : 1.2);

function eatHole(big, small) {
  small.alive = false;
  small.respawn = 3;
  small.eatenBy = big;
  const gain = Math.max(15, Math.round(small.points * 0.4));
  big.addPoints(gain);
  small.points = Math.round(small.points * (1 - (small.isPlayer ? G.diff.loss : 0.5)));
  small.combo = 0;
  for (const k in small.power) small.power[k] = 0;
  if (big.isPlayer) { Sfx.gulp(); floatText(small.x, small.z, `${small.name} yutuldu! +${gain}`, 'big'); }
  if (small.isPlayer) { Sfx.lose(); toast(`${big.name} seni yuttu! 😵`); }
}

// ---------- Güncelleme ----------
const tmpV = new THREE.Vector3();
function update(dt) {
  G.t += dt;
  const playing = G.state === 'play';
  if (playing) {
    if (G.endless) G.time += dt;
    else {
      const prev = Math.ceil(G.time);
      G.time -= dt;
      if (Math.ceil(G.time) !== prev && G.time <= 10 && G.time > 0) Sfx.tick();
      if (G.time <= 0) { G.time = 0; endRound(); }
    }
  }

  // delikler
  for (const h of G.holes) {
    for (const k in h.power) if (h.power[k] > 0) h.power[k] -= dt;
    if (h.shield > 0) h.shield -= dt;
    if (!h.alive) {
      // yutulunca büzülme animasyonu
      h.dispR = Math.max(0.01, h.dispR - dt * 4);
      if (h.eatenBy) { h.x += (h.eatenBy.x - h.x) * Math.min(1, dt * 6); h.z += (h.eatenBy.z - h.z) * Math.min(1, dt * 6); }
      h.respawn -= dt;
      if (h.respawn <= 0 && G.state !== 'end') {
        const p = placeFree();
        Object.assign(h, { x: p.x, z: p.z, tx: p.x, tz: p.z, alive: true, shield: 3, dispR: 0.3, eatenBy: null });
      }
    } else {
      h.dispR += (h.baseR - h.dispR) * Math.min(1, dt * 3);
      let dir;
      if (h.isPlayer) dir = readInput();
      else {
        h.think -= dt;
        if (h.think <= 0) botThink(h);
        const dx = h.tx - h.x, dz = h.tz - h.z, l = Math.hypot(dx, dz);
        dir = l > 0.5 ? { x: dx / l * h.skill, z: dz / l * h.skill } : { x: 0, z: 0 };
      }
      const speed = (7.2 + h.R * 0.35) * (h.power.turbo > 0 ? 1.7 : 1);
      h.vx += (dir.x * speed - h.vx) * Math.min(1, dt * 8);
      h.vz += (dir.z * speed - h.vz) * Math.min(1, dt * 8);
      h.x = Math.max(-LIMIT, Math.min(LIMIT, h.x + h.vx * dt));
      h.z = Math.max(-LIMIT, Math.min(LIMIT, h.z + h.vz * dt));
    }
    const R = h.R;
    h.group.position.set(h.x, 0, h.z);
    h.group.scale.setScalar(Math.max(0.01, R));
    h.group.visible = R > 0.02;
    const blink = h.shield > 0 && h.alive && Math.floor(G.t * 8) % 2 === 0;
    h.rimMat.color.set(blink ? '#ffffff' : h.color);

    if (!h.alive) continue;
    // nesneleri yut
    query(h.x, h.z, R, o => {
      if (o.size < R * 0.92 && Math.hypot(o.x - h.x, o.z - h.z) < R - o.size * 0.3) eat(o, h);
    });
    // mıknatıs
    if (h.power.magnet > 0) {
      const mr = R * 3.2 + 4;
      query(h.x, h.z, mr, o => {
        if (o.size >= R * 0.92) return;
        const dx = h.x - o.x, dz = h.z - o.z, d = Math.hypot(dx, dz);
        if (d > mr || d < 0.01) return;
        const s = Math.min(d, (6 + 14 * (1 - d / mr)) * dt);
        o.x += dx / d * s; o.z += dz / d * s;
        o.pulled = 0.3;
        gridMove(o);
        o.mesh.position.x = o.x; o.mesh.position.z = o.z;
      });
    }
    // güç kristalleri
    for (let i = G.powerups.length - 1; i >= 0; i--) {
      const p = G.powerups[i];
      if (Math.hypot(p.x - h.x, p.z - h.z) < R + 0.8) {
        const P = POWERS[p.kind];
        h.power[p.kind] = P.dur;
        scene.remove(p.mesh);
        G.powerups.splice(i, 1);
        const gen = G.gen;
        setTimeout(() => { if (G.gen === gen) spawnPowerups(1); }, 6000);
        if (h.isPlayer) { Sfx.power(); toast(`${P.icon} ${P.name}!`); }
      }
    }
  }
  // delik delik yer
  for (const a of G.holes) for (const b of G.holes) {
    if (a === b || !a.alive || !b.alive || b.shield > 0) continue;
    if (a.R > b.R * eatRatio(a, b) && Math.hypot(a.x - b.x, a.z - b.z) < a.R - b.R * 0.4) eatHole(a, b);
  }

  // yayalar, kediler, araçlar
  for (const o of G.objs) {
    if (o.dead) continue;
    if (o.grow !== undefined) {
      o.grow = Math.min(1, o.grow + dt * 1.5);
      const t = o.grow - 1, k = 1 + 2.7 * t * t * t + 1.7 * t * t; // easeOutBack
      o.mesh.scale.setScalar(Math.max(0.01, k));
      if (o.grow >= 1) { o.mesh.scale.setScalar(1); o.grow = undefined; }
    }
    if (o.pulled > 0) { o.pulled -= dt; continue; }
    if (o.walker) {
      let fx = 0, fz = 0, flee = false;
      for (const h of G.holes) {
        if (!h.alive || h.R < o.size * 1.05) continue;
        const dx = o.x - h.x, dz = o.z - h.z, d = Math.hypot(dx, dz);
        if (d < h.R + 5) { fx += dx / (d + 0.01); fz += dz / (d + 0.01); flee = true; }
      }
      let mx, mz, sp;
      if (flee) { const l = Math.hypot(fx, fz) || 1; mx = fx / l; mz = fz / l; sp = o.run; o.scared = 1.5; }
      else {
        const dx = o.tx - o.x, dz = o.tz - o.z, d = Math.hypot(dx, dz);
        if (d < 0.6) { randomTarget(o); continue; }
        mx = dx / d; mz = dz / d; sp = o.scared > 0 ? o.run * 0.6 : o.speed;
        if (o.scared > 0) { o.scared -= dt; if (o.scared <= 0) randomTarget(o); }
      }
      o.x = Math.max(-LIMIT, Math.min(LIMIT, o.x + mx * sp * dt));
      o.z = Math.max(-LIMIT, Math.min(LIMIT, o.z + mz * sp * dt));
      o.phase += dt * sp * 4;
      o.mesh.position.set(o.x, Math.abs(Math.sin(o.phase)) * (o.type === 'cat' ? 0.06 : 0.1), o.z);
      o.mesh.rotation.y = Math.atan2(mx, mz);
      gridMove(o);
    } else if (o.car) {
      const s = o.speed * o.dir * dt;
      if (o.axis === 'z') { o.z += s; if (o.z > HALF) o.z = -HALF; else if (o.z < -HALF) o.z = HALF; }
      else { o.x += s; if (o.x > HALF) o.x = -HALF; else if (o.x < -HALF) o.x = HALF; }
      o.mesh.position.set(o.x, 0, o.z);
      gridMove(o);
    }
  }

  // düşen nesneler
  for (let i = G.falling.length - 1; i >= 0; i--) {
    const o = G.falling[i], f = o.fall, h = f.h;
    const k = Math.min(1, dt * 2.5);
    o.x += (h.x - o.x) * k; o.z += (h.z - o.z) * k;
    f.vy -= 22 * dt;
    o.mesh.position.set(o.x, o.mesh.position.y + f.vy * dt, o.z);
    o.mesh.rotateOnWorldAxis(f.axis, dt * 2.2);
    if (o.mesh.position.y < -(Math.max(h.R, 1) * 3 + o.size * 2.5 + 3)) {
      scene.remove(o.mesh);
      if (o.unique) o.mesh.geometry.dispose();
      G.falling.splice(i, 1);
      o.gone = true;
      if (G.endless && !o.walker && !o.car) G.regrow.push({ spec: o.spec, at: G.t + REGROW_MIN + G.rng() * 30 });
    }
  }
  if (G.t % 2 < dt) G.objs = G.objs.filter(o => !o.gone);

  // canlı nüfusu tazele (harita boşalmasın)
  G.spawnT -= dt;
  if (G.spawnT <= 0) {
    G.spawnT = 0.7;
    // süresiz mod: yutulan binalar/ağaçlar zamanla yeniden çıkar (etrafta delik yoksa)
    for (let i = G.regrow.length - 1; i >= 0; i--) {
      const r = G.regrow[i];
      if (r.at > G.t) continue;
      const s = r.spec;
      const clear = G.holes.every(h => !h.alive || Math.hypot(h.x - s.x, h.z - s.z) > h.R + 14);
      if (!clear) { r.at = G.t + 3; continue; }
      const o = spawnObj(s.type, s.x, s.z, s.ry, s);
      o.grow = 0; o.mesh.scale.setScalar(0.01);
      G.regrow.splice(i, 1);
    }
    const far = G.player ?? { x: 9999, z: 9999 };
    if (count('person') < G.targets.person * 0.75) spawnWalker('person', G.blocks[(G.rng() * G.blocks.length) | 0], far);
    if (count('cat') < G.targets.cat * 0.75) spawnWalker('cat', G.blocks[(G.rng() * G.blocks.length) | 0], far);
    if (G.objs.reduce((n, o) => n + (o.car && !o.dead ? 1 : 0), 0) < G.targets.car * 0.6) {
      const ax = G.rng() < 0.5 ? 'x' : 'z', dir = G.rng() < 0.5 ? 1 : -1;
      spawnCar(G.rng() < 0.15 ? 'dolmus' : 'car', ax, ROADS[(G.rng() * ROADS.length) | 0], dir, dir > 0 ? -HALF : HALF);
    }
  }

  // güç kristali animasyonu
  for (const p of G.powerups) {
    p.gem.rotation.y += dt * 2;
    p.gem.position.y = 1.4 + Math.sin(G.t * 3 + p.x) * 0.25;
    p.ring.scale.setScalar(1 + (G.t * 0.8 % 1) * 0.5);
    p.ring.material.opacity = 0.6 * (1 - (G.t * 0.8 % 1));
  }
}

// ---------- Kamera ----------
const camPos = new THREE.Vector3(0, 90, 70), camLook = new THREE.Vector3();
let shadowSize = 0;
function updateCamera(dt) {
  let tx, tz, h;
  if (G.state === 'menu') {
    const a = G.t * 0.06;
    tx = Math.cos(a) * 30; tz = Math.sin(a) * 30; h = 62;
    camPos.set(tx + Math.cos(a + 1.2) * 0, h, tz + h * 0.7);
  } else {
    const p = G.player;
    const R = Math.max(1.2, p.alive ? p.R : p.baseR);
    tx = p.x; tz = p.z; h = 13 + R * 4.3;
    const k = Math.min(1, dt * 4);
    camPos.x += (tx - camPos.x) * k;
    camPos.z += (tz + h * 0.62 - camPos.z) * k;
    camPos.y += (h - camPos.y) * Math.min(1, dt * 2);
  }
  if (G.state === 'menu') camLook.set(tx, 0, tz);
  else { const k = Math.min(1, dt * 4); camLook.x += (tx - camLook.x) * k; camLook.z += (tz - 1.5 - camLook.z) * k; }
  camera.position.copy(camPos);
  camera.lookAt(camLook);
  scene.fog.near = camPos.y * 1.6; scene.fog.far = camPos.y * 4.2;

  sun.position.set(camLook.x + 30, 70, camLook.z + 25);
  sun.target.position.copy(camLook);
  const want = Math.min(110, Math.ceil(camPos.y * 1.1 / 5) * 5);
  if (want !== shadowSize) {
    shadowSize = want;
    const c = sun.shadow.camera;
    c.left = -want; c.right = want; c.top = want; c.bottom = -want; c.near = 1; c.far = 220;
    c.updateProjectionMatrix();
  }
}

// ---------- Saydamlaşma: kamera ile delik arasına giren nesneler ----------
const fadeSet = new Set();
const _C = new THREE.Vector3(), _D = new THREE.Vector3();
function updateOcclusion(dt) {
  const P = G.player, now = new Set();
  if (P && G.state !== 'menu') {
    _C.copy(camera.position);
    const tx = P.x, ty = 0.3, tz = P.z;
    _D.set(tx - _C.x, ty - _C.y, tz - _C.z);
    const len = _D.length();
    _D.divideScalar(len);
    const R = P.alive ? P.R : 1.2;
    const mx = (_C.x + tx) / 2, mz = (_C.z + tz) / 2;
    query(mx, mz, Math.hypot(_C.x - tx, _C.z - tz) / 2 + 14, o => {
      const bs = o.mesh.geometry.boundingSphere;
      const top = bs.center.y + bs.radius;
      if (top < 2.2) return; // alçak nesneler görüşü kapatmaz
      // nesneyi dikey bir silindir say; kamera→delik çizgisi üzerindeki noktalar içine giriyor mu?
      const rad = o.size * 1.05 + R * 0.6;
      for (let i = 1; i <= 16; i++) {
        const t = len * (0.15 + 0.85 * i / 16);
        const py = _C.y + _D.y * t;
        if (py > top) continue;
        if (Math.hypot(_C.x + _D.x * t - o.x, _C.z + _D.z * t - o.z) < rad) { now.add(o); fadeSet.add(o); return; }
      }
    });
  }
  for (const o of fadeSet) {
    const target = now.has(o) && !o.dead ? 0.3 : 1;
    if (!o.fadeMat) {
      o.fadeMat = o.mesh.material.clone();
      o.fadeMat.transparent = true;
      o.fadeMat.depthWrite = false;
      o.mesh.material = o.fadeMat;
    }
    o.fadeMat.opacity += (target - o.fadeMat.opacity) * Math.min(1, dt * 8);
    if (target === 1 && o.fadeMat.opacity > 0.97) {
      o.mesh.material = o.gold ? SHARED.gold : SHARED.mat;
      o.fadeMat.dispose();
      o.fadeMat = null;
      fadeSet.delete(o);
    }
  }
}

// ---------- HUD ----------
function project(x, y, z) {
  tmpV.set(x, y, z).project(camera);
  return { x: (tmpV.x * 0.5 + 0.5) * innerWidth, y: (-tmpV.y * 0.5 + 0.5) * innerHeight, vis: tmpV.z < 1 };
}
const floats = [];
function floatText(x, z, text, cls = '') {
  const el = document.createElement('div');
  el.className = 'float ' + cls;
  el.textContent = text;
  $('labels').appendChild(el);
  floats.push({ el, x, z, t: 0 });
  if (floats.length > 14) floats.shift().el.remove();
}
let toastT = 0;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); toastT = 2; }

let hudT = 0;
function updateHud(dt) {
  for (const h of G.holes) {
    const p = project(h.x, 0, h.z + h.R + 0.4);
    h.label.style.display = h.alive && p.vis ? '' : 'none';
    h.label.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, 0)`;
  }
  for (let i = floats.length - 1; i >= 0; i--) {
    const f = floats[i];
    f.t += dt;
    const p = project(f.x, 2 + f.t * 4, f.z);
    f.el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%) scale(${1 + f.t * 0.3})`;
    f.el.style.opacity = String(Math.max(0, 1 - f.t / 1.1));
    if (f.t > 1.1) { f.el.remove(); floats.splice(i, 1); }
  }
  if (toastT > 0) { toastT -= dt; if (toastT <= 0) $('toast').classList.remove('show'); }

  if (G.state !== 'play') return;
  const P = G.player;
  const t = G.endless ? Math.floor(G.time) : Math.ceil(G.time);
  $('time').textContent = (G.endless ? '∞ ' : '') + `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  $('time').classList.toggle('hurry', !G.endless && G.time <= 10);
  const comboOn = P.combo >= 3 && G.t - P.lastEat < 1.3;
  $('combo').classList.toggle('show', comboOn);
  if (comboOn) $('combo').textContent = `KOMBO x${P.combo}`;
  if (!P.alive) toastT = Math.max(toastT, 0.1), $('toast').classList.add('show'), $('toast').textContent = `Yutuldun! ${Math.ceil(P.respawn)} sn...`;

  hudT -= dt;
  if (hudT > 0) return;
  hudT = 0.25;
  $('score').textContent = P.points.toLocaleString('tr-TR');
  $('powers').innerHTML = Object.entries(P.power).filter(([, v]) => v > 0)
    .map(([k, v]) => `<span class="pw" style="--c:#${POWERS[k].color.toString(16).padStart(6, '0')}">${POWERS[k].icon} ${POWERS[k].name} <b>${Math.ceil(v)}</b></span>`).join('');
  const ranked = [...G.holes].sort((a, b) => b.points - a.points);
  $('board').innerHTML = ranked.map((h, i) =>
    `<li class="${h.isPlayer ? 'me' : ''}"><i style="background:${h.color}"></i><span>${i + 1}. ${esc(h.name)}</span><b>${h.points}</b></li>`).join('');
  drawMinimap();
}
const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// mini harita
const mm = $('minimap'), mmx = mm.getContext('2d');
const mmBase = document.createElement('canvas');
function drawMinimapBase(cv) {
  mmBase.width = mmBase.height = mm.width;
  mmBase.getContext('2d').drawImage(cv, 0, 0, mm.width, mm.height);
}
function drawMinimap() {
  const s = mm.width / (HALF * 2);
  mmx.drawImage(mmBase, 0, 0);
  for (const p of G.powerups) {
    mmx.fillStyle = '#' + POWERS[p.kind].color.toString(16).padStart(6, '0');
    mmx.fillRect((p.x + HALF) * s - 2, (p.z + HALF) * s - 2, 4, 4);
  }
  for (const h of G.holes) {
    if (!h.alive) continue;
    mmx.beginPath();
    mmx.arc((h.x + HALF) * s, (h.z + HALF) * s, Math.max(2.5, h.R * s), 0, Math.PI * 2);
    mmx.fillStyle = h.color; mmx.fill();
    if (h.isPlayer) { mmx.lineWidth = 2; mmx.strokeStyle = '#fff'; mmx.stroke(); }
  }
}

// ---------- Akış ----------
let chosenColor = localStorage.getItem('dd_color') || COLORS[0];
const sw = $('swatches');
COLORS.forEach(c => {
  const b = document.createElement('button');
  b.style.background = c;
  b.className = c === chosenColor ? 'on' : '';
  b.onclick = () => { chosenColor = c; localStorage.setItem('dd_color', c); [...sw.children].forEach(x => x.classList.toggle('on', x === b)); };
  sw.appendChild(b);
});
$('name').value = localStorage.getItem('dd_name') || '';

// Menü seçenekleri (zorluk, rakip sayısı) — tarayıcıda hatırlanır
const opt = { diff: localStorage.getItem('dd_diff') || 'normal', bots: localStorage.getItem('dd_bots') || '6', time: localStorage.getItem('dd_time') || '120' };
// en iyi skor her süre modu için ayrı tutulur
const bestKey = () => (opt.time === '120' ? 'dd_best' : 'dd_best_' + opt.time);
const showBest = () => { $('best').textContent = localStorage.getItem(bestKey()) || '0'; };
for (const seg of document.querySelectorAll('.seg')) {
  const key = seg.dataset.opt;
  for (const b of seg.children) {
    b.classList.toggle('on', b.dataset.v === opt[key]);
    b.onclick = () => {
      opt[key] = b.dataset.v;
      localStorage.setItem('dd_' + key, b.dataset.v);
      for (const x of seg.children) x.classList.toggle('on', x === b);
      $('diffRow').classList.toggle('off', opt.bots === '0');
      showBest();
    };
  }
}
$('diffRow').classList.toggle('off', opt.bots === '0');
showBest();

function startRound() {
  Sfx.unlock();
  const name = ($('name').value.trim() || 'Sen').slice(0, 16);
  localStorage.setItem('dd_name', name);
  buildWorld((Math.random() * 1e9) | 0);
  const p = placeFree();
  G.player = new Hole(name, chosenColor, true, p.x, p.z);
  G.holes.push(G.player);
  G.diff = DIFFS[opt.diff];
  addBots(+opt.bots);
  G.endless = opt.time === '0';
  G.time = G.endless ? 0 : +opt.time; G.t = 0;
  G.state = 'play';
  input.x = input.z = 0;
  camPos.set(p.x, 40, p.z + 30); camLook.set(p.x, 0, p.z);
  document.body.classList.add('playing');
  $('menu').classList.add('hidden'); $('end').classList.add('hidden');
  toast('Mahalleyi yut! 🕳️');
}

function endRound() {
  G.state = 'end';
  Sfx.end();
  const ranked = [...G.holes].sort((a, b) => b.points - a.points);
  const rank = ranked.indexOf(G.player) + 1;
  const best = Math.max(+(localStorage.getItem(bestKey()) || 0), G.player.points);
  localStorage.setItem(bestKey(), best);
  $('best').textContent = best;
  $('endTitle').textContent = G.holes.length === 1 ? `${G.endless ? 'Oyun bitti' : 'Süre bitti'}! ${G.player.points} puan 🎉` : rank === 1 ? 'Mahallenin Kralı! 👑' : rank <= 3 ? `${rank}. oldun, fena değil!` : `${rank}. oldun`;
  $('endList').innerHTML = ranked.map((h, i) =>
    `<li class="${h.isPlayer ? 'me' : ''}"><i style="background:${h.color}"></i><span>${i + 1}. ${esc(h.name)}</span><b>${h.points}</b></li>`).join('');
  $('endBest').textContent = best;
  setTimeout(() => { $('end').classList.remove('hidden'); document.body.classList.remove('playing'); }, 900);
}

$('play').onclick = startRound;
$('quit').onclick = () => { if (G.state === 'play') endRound(); };
$('again').onclick = startRound;
$('toMenu').onclick = () => { $('end').classList.add('hidden'); $('menu').classList.remove('hidden'); };
$('name').addEventListener('keydown', e => { if (e.key === 'Enter') startRound(); });
$('mute').onclick = () => { $('mute').textContent = Sfx.toggle() ? '🔇' : '🔊'; };
$('mute').textContent = Sfx.muted ? '🔇' : '🔊';

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

// Menü arka planı: botlar kendi kendine oynar
buildWorld(20261028);
addBots(6);

const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(0.05, clock.getDelta());
  if (G.state !== 'end') update(dt);
  else G.t += dt;
  updateCamera(dt);
  updateOcclusion(dt);
  updateHud(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
frame();
window.__G = G; // hata ayıklama için
