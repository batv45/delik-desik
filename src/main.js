// Çizim, arayüz ve oyun akışı. Oyun mantığı sim.js'de; burası yalnızca bir "kaynağı" çizer:
//   - Tek kişilik / menü: tarayıcıda çalışan Sim
//   - Online: sunucudan beslenen Online (net.js)
import * as THREE from 'three';
import { Models, SHARED } from './models.js';
import { drawGround, mulberry32, HALF } from './world.js';
import { Sim, COLORS, LIMIT, holeR, holeSpeed } from './sim.js';
import { Online } from './net.js';
import { Sfx } from './audio.js';

const POWERS = {
  magnet: { name: 'Mıknatıs', icon: '🧲', color: 0xff3b3b },
  turbo: { name: 'Turbo', icon: '⚡', color: 0x22d3ee },
  giant: { name: 'Dev Delik', icon: '🌀', color: 0xa855f7 },
};
const hex = c => '#' + c.toString(16).padStart(6, '0');
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
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.5, 700);

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
  new THREE.PlaneGeometry(1400, 1400).rotateX(-Math.PI / 2),
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
const pwRingGeo = new THREE.RingGeometry(0.9, 1.3, 32).rotateX(-Math.PI / 2);

// ---------- Model önbelleği: (tür, varyant) → geometri; aynı varyant her yerde aynı görünür ----------
const geoCache = new Map();
const strHash = s => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7);
function geoFor(o) {
  if (o.type === 'house' || o.type === 'apartment') return Models[o.type](mulberry32(o.v), o.w, o.d, o.floors).geo;
  const key = o.type + ':' + o.v;
  let g = geoCache.get(key);
  if (!g) { g = Models[o.type](mulberry32(strHash(key))).geo; geoCache.set(key, g); }
  return g;
}

// ---------- Görünüm durumu ----------
let src = null;       // Sim ya da Online
let mode = 'menu';    // 'menu' | 'solo' | 'online'
let meId = 0;
let ended = false;
const views = new Map();   // nesne id → { o, mesh, ... }
const hviews = new Map();  // delik id → { group, rimMat, label, x, z, vx, vz }
const pviews = new Map();  // kristal id → { mesh, gem, ring, kind }
const falling = [];
const fadeSet = new Set();
let t = 0;

function clearScene() {
  for (const v of views.values()) { scene.remove(v.mesh); if (v.unique) v.mesh.geometry.dispose(); v.fadeMat?.dispose(); }
  for (const f of falling) { scene.remove(f.mesh); if (f.unique) f.mesh.geometry.dispose(); }
  for (const h of hviews.values()) { scene.remove(h.group); h.label.remove(); }
  for (const p of pviews.values()) scene.remove(p.mesh);
  views.clear(); hviews.clear(); pviews.clear(); falling.length = 0; fadeSet.clear();
}

let groundSeed = null;
let snapCam = false; // yeni dünyada kamera ilk karede doğrudan deliğe gider
function attach(source, me) {
  clearScene();
  src = source; meId = me; ended = false; snapCam = true;
  const key = source.blocks.map(b => b.kind[0]).join('');
  if (key !== groundSeed) {
    groundSeed = key;
    const cv = drawGround(source.blocks, isTouch ? 2048 : 3072);
    groundTex.image = cv;
    groundTex.colorSpace = THREE.SRGBColorSpace;
    groundTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    groundTex.needsUpdate = true;
    drawMinimapBase(cv);
  }
  for (const o of source.objs.values()) addView(o);
  for (const p of source.powerups) addPw(p);
  if (source.drain) source.drain();
}

function addView(o, grow = false) {
  if (views.has(o.id)) return;
  const unique = o.type === 'house' || o.type === 'apartment';
  const geo = geoFor(o);
  const mesh = new THREE.Mesh(geo, o.gold ? SHARED.gold : SHARED.mat);
  mesh.position.set(o.x, 0, o.z);
  mesh.rotation.y = o.ry;
  mesh.castShadow = true;
  if (grow) mesh.scale.setScalar(0.01);
  scene.add(mesh);
  const bs = geo.boundingSphere;
  views.set(o.id, { o, mesh, unique, top: bs.center.y + bs.radius, phase: Math.random() * 10, grow: grow ? 0 : undefined });
}

function addPw(p) {
  if (pviews.has(p.id)) return;
  const P = POWERS[p.kind];
  const grp = new THREE.Group();
  const gem = new THREE.Mesh((P.geo ??= Models.powerup(P.color)),
    (P.mat ??= new THREE.MeshLambertMaterial({ vertexColors: true, emissive: P.color, emissiveIntensity: 0.6, flatShading: true })));
  gem.position.y = 1.4; gem.castShadow = true;
  const ring = new THREE.Mesh(pwRingGeo, new THREE.MeshBasicMaterial({ color: P.color, transparent: true, opacity: 0.55, depthWrite: false }));
  ring.position.y = 0.04;
  grp.add(gem, ring);
  grp.position.set(p.x, 0, p.z);
  scene.add(grp);
  pviews.set(p.id, { mesh: grp, gem, ring, kind: p.kind, x: p.x, z: p.z });
}
function removePw(id) {
  const v = pviews.get(id);
  if (!v) return;
  scene.remove(v.mesh); v.ring.material.dispose(); pviews.delete(id);
}

function holeView(h) {
  let v = hviews.get(h.id);
  if (v) return v;
  const group = new THREE.Group();
  const mask = new THREE.Mesh(holeGeo.mask, maskMat); mask.position.y = 0.012; mask.renderOrder = -10;
  const rimMat = new THREE.MeshBasicMaterial({ color: h.color });
  const rim = new THREE.Mesh(holeGeo.rim, rimMat); rim.position.y = 0.03;
  group.add(mask, rim, new THREE.Mesh(holeGeo.wall, wallMat), new THREE.Mesh(holeGeo.bottom, bottomMat));
  scene.add(group);
  const label = document.createElement('div');
  label.className = 'tag' + (h.id === meId ? ' me' : '');
  label.textContent = h.name;
  label.style.setProperty('--c', h.color);
  $('labels').appendChild(label);
  v = { group, rimMat, label, x: h.x, z: h.z, vx: 0, vz: 0, R: holeR(h) };
  hviews.set(h.id, v);
  return v;
}
const me = () => src?.holes.find(h => h.id === meId);
const nameOf = id => src?.holes.find(h => h.id === id)?.name ?? '?';

// ---------- Girdi ----------
const input = { x: 0, z: 0, keys: new Set(), touchId: null, ox: 0, oy: 0 };
const playing = () => mode !== 'menu' && !ended;
addEventListener('mousemove', e => {
  if (!playing()) return;
  const s = Math.min(innerWidth, innerHeight) * 0.22;
  let dx = (e.clientX - innerWidth / 2) / s, dz = (e.clientY - innerHeight / 2) / s;
  const l = Math.hypot(dx, dz); if (l > 1) { dx /= l; dz /= l; }
  input.x = dx; input.z = dz;
});
const joy = $('joy'), knob = $('knob');
addEventListener('touchstart', e => {
  if (!playing() || input.touchId !== null || e.target.closest('button')) return;
  const tc = e.changedTouches[0];
  input.touchId = tc.identifier; input.ox = tc.clientX; input.oy = tc.clientY;
  joy.style.left = tc.clientX + 'px'; joy.style.top = tc.clientY + 'px'; joy.style.display = 'block';
  knob.style.transform = 'translate(-50%,-50%)';
}, { passive: true });
addEventListener('touchmove', e => {
  for (const tc of e.changedTouches) if (tc.identifier === input.touchId) {
    let dx = (tc.clientX - input.ox) / 55, dz = (tc.clientY - input.oy) / 55;
    const l = Math.hypot(dx, dz); if (l > 1) { dx /= l; dz /= l; }
    input.x = dx; input.z = dz;
    knob.style.transform = `translate(calc(-50% + ${dx * 45}px), calc(-50% + ${dz * 45}px))`;
  }
}, { passive: true });
const endTouch = e => {
  for (const tc of e.changedTouches) if (tc.identifier === input.touchId) {
    input.touchId = null; input.x = 0; input.z = 0; joy.style.display = 'none';
  }
};
addEventListener('touchend', endTouch); addEventListener('touchcancel', endTouch);
addEventListener('keydown', e => { if (e.target.tagName === 'INPUT') return; input.keys.add(e.key.toLowerCase()); if (e.key === 'm') $('mute').click(); });
addEventListener('keyup', e => input.keys.delete(e.key.toLowerCase()));
function readInput() {
  if (!playing()) return { x: 0, z: 0 };
  const k = input.keys;
  const x = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0);
  const z = (k.has('s') || k.has('arrowdown') ? 1 : 0) - (k.has('w') || k.has('arrowup') ? 1 : 0);
  if (x || z) { const l = Math.hypot(x, z); return { x: x / l, z: z / l }; }
  return { x: input.x, z: input.z };
}

// ---------- Olaylar ----------
function handleEvents() {
  for (const ev of src.drain()) {
    if (ev.e === 'spawn') {
      const o = src.objs.get(ev.o.id);
      if (o) addView(o, !!ev.grow);
    } else if (ev.e === 'eat') {
      const v = views.get(ev.id);
      if (!v) continue;
      views.delete(ev.id);
      if (v.fadeMat) { v.mesh.material = v.o.gold ? SHARED.gold : SHARED.mat; v.fadeMat.dispose(); fadeSet.delete(v); }
      const hv = hviews.get(ev.h);
      const hx = hv?.x ?? v.mesh.position.x, hz = hv?.z ?? v.mesh.position.z;
      const dx = hx - v.mesh.position.x, dz = hz - v.mesh.position.z, l = Math.hypot(dx, dz) || 1;
      falling.push({ mesh: v.mesh, unique: v.unique, hid: ev.h, vy: 0, size: v.o.size, axis: new THREE.Vector3(dz / l, 0, -dx / l) });
      if (ev.h === meId) {
        const o = v.o, x = v.mesh.position.x, z = v.mesh.position.z;
        Sfx.pop(o.size, ev.c);
        if (o.gold) { Sfx.gold(); floatText(x, z, `ALTIN! +${ev.g}`, 'gold'); }
        else if (o.pts >= 30) { Sfx.big(); floatText(x, z, `+${ev.g}`, 'big'); }
        else if (o.pts >= 3) floatText(x, z, `+${ev.g}`);
        if (o.type === 'clocktower') toast('Saat kulesini yuttun! 🕰️');
      }
    } else if (ev.e === 'pw+') addPw(ev.p);
    else if (ev.e === 'pw-') {
      removePw(ev.id);
      if (ev.h === meId) { const P = POWERS[ev.kind]; Sfx.power(); toast(`${P.icon} ${P.name}!`); }
    } else if (ev.e === 'gulp') {
      const hv = hviews.get(ev.b);
      if (ev.a === meId) { Sfx.gulp(); if (hv) floatText(hv.x, hv.z, `${nameOf(ev.b)} yutuldu! +${ev.g}`, 'big'); }
      if (ev.b === meId) { Sfx.lose(); toast(`${nameOf(ev.a)} seni yuttu! 😵`); }
    } else if (ev.e === 'end') {
      if (mode === 'solo') showEndSolo();
      else if (mode === 'online') showEndOnline(ev.rank, ev.next);
    } else if (ev.e === 'reset') {
      attach(src, src.meId);
      $('end').classList.add('hidden');
      document.body.classList.add('playing');
      if (ev.ended) { ended = true; toast('Yeni tur birazdan başlıyor...'); }
      else toast(`Oda ${src.room}: mahalleyi yut! 🕳️`);
    }
  }
}

// ---------- Kare güncellemesi ----------
function update(dt) {
  t += dt;
  const smooth = mode === 'online';
  if (mode === 'online') {
    const d = readInput();
    src.sendInput(d.x, d.z);
    src.tick(dt);
  } else if (!ended) {
    if (mode === 'solo') { const d = readInput(); src.setInput(meId, d.x, d.z); }
    src.step(dt);
  }
  handleEvents();

  // delikler
  const seen = new Set();
  for (const h of src.holes) {
    seen.add(h.id);
    const v = holeView(h);
    if (!smooth) { v.x = h.x; v.z = h.z; }
    else {
      const ahead = src.sinceSnap + src.rtt / 2;
      const tx = h.x + (h.alive ? h.vx * ahead : 0), tz = h.z + (h.alive ? h.vz * ahead : 0);
      if (h.id === meId && h.alive && !ended) {
        // kendi deliğimiz: girdiyi hemen uygula (tahmin), sunucu konumuna yavaşça yaklaştır
        const d = readInput(), sp = holeSpeed(h);
        v.vx += (d.x * sp - v.vx) * Math.min(1, dt * 8);
        v.vz += (d.z * sp - v.vz) * Math.min(1, dt * 8);
        v.x = Math.max(-LIMIT, Math.min(LIMIT, v.x + v.vx * dt));
        v.z = Math.max(-LIMIT, Math.min(LIMIT, v.z + v.vz * dt));
        const ex = tx - v.x, ez = tz - v.z;
        if (Math.hypot(ex, ez) > 8) { v.x = tx; v.z = tz; }
        else { v.x += ex * Math.min(1, dt * 3); v.z += ez * Math.min(1, dt * 3); }
      } else {
        const ex = tx - v.x, ez = tz - v.z;
        if (Math.hypot(ex, ez) > 12) { v.x = tx; v.z = tz; }
        else { v.x += ex * Math.min(1, dt * 12); v.z += ez * Math.min(1, dt * 12); }
      }
    }
    const R = holeR(h);
    v.R += (R - v.R) * Math.min(1, dt * (smooth ? 10 : 60));
    v.group.position.set(v.x, 0, v.z);
    v.group.scale.setScalar(Math.max(0.01, v.R));
    v.group.visible = v.R > 0.02;
    const blink = h.shield > 0 && h.alive && Math.floor(t * 8) % 2 === 0;
    v.rimMat.color.set(blink ? '#ffffff' : h.color);
  }
  for (const [id, v] of hviews) if (!seen.has(id)) { scene.remove(v.group); v.label.remove(); hviews.delete(id); }

  // nesneler (yalnızca hareket edenler)
  for (const v of views.values()) {
    const o = v.o, m = v.mesh;
    if (v.grow !== undefined) {
      v.grow = Math.min(1, v.grow + dt * 1.5);
      const k = v.grow - 1;
      m.scale.setScalar(Math.max(0.01, 1 + 2.7 * k * k * k + 1.7 * k * k)); // easeOutBack
      if (v.grow >= 1) { m.scale.setScalar(1); v.grow = undefined; }
    }
    if (!(o.walker || o.car || o.moved || o.dyn)) continue;
    const px = m.position.x, pz = m.position.z;
    let nx = o.x, nz = o.z;
    if (smooth && Math.hypot(nx - px, nz - pz) < 15) { const k = Math.min(1, dt * 10); nx = px + (nx - px) * k; nz = pz + (nz - pz) * k; }
    const mx = nx - px, mz = nz - pz, moved = Math.hypot(mx, mz);
    m.position.x = nx; m.position.z = nz;
    if (o.car && moved > 0.002 && moved < 3) {
      // kavşakta dönerken burnunu yumuşakça yeni yöne çevir
      let da = Math.atan2(mx, mz) - m.rotation.y;
      da = Math.atan2(Math.sin(da), Math.cos(da));
      m.rotation.y += da * Math.min(1, dt * 9);
    }
    if (o.walker) {
      if (moved > 0.002 && moved < 3) { m.rotation.y = Math.atan2(mx, mz); v.phase += moved * 4; }
      m.position.y = Math.abs(Math.sin(v.phase)) * (o.type === 'cat' ? 0.06 : 0.1);
    }
  }

  // düşen nesneler
  for (let i = falling.length - 1; i >= 0; i--) {
    const f = falling[i], m = f.mesh, hv = hviews.get(f.hid);
    if (hv) { const k = Math.min(1, dt * 2.5); m.position.x += (hv.x - m.position.x) * k; m.position.z += (hv.z - m.position.z) * k; }
    f.vy -= 22 * dt;
    m.position.y += f.vy * dt;
    m.rotateOnWorldAxis(f.axis, dt * 2.2);
    if (m.position.y < -(Math.max(hv?.R ?? 1, 1) * 3 + f.size * 2.5 + 3)) {
      scene.remove(m);
      if (f.unique) m.geometry.dispose();
      falling.splice(i, 1);
    }
  }

  // kristaller
  for (const p of pviews.values()) {
    p.gem.rotation.y += dt * 2;
    p.gem.position.y = 1.4 + Math.sin(t * 3 + p.x) * 0.25;
    p.ring.scale.setScalar(1 + (t * 0.8 % 1) * 0.5);
    p.ring.material.opacity = 0.6 * (1 - (t * 0.8 % 1));
  }
}

// ---------- Kamera ----------
const camPos = new THREE.Vector3(0, 90, 70), camLook = new THREE.Vector3();
let shadowSize = 0;
function updateCamera(dt) {
  // dikey (telefon) ekranda görüş alanı dar kalır: kamerayı biraz geri çek, açıyı genişlet
  const portrait = camera.aspect < 1;
  const far = portrait ? Math.min(1.45, Math.sqrt(0.95 / camera.aspect)) : 1;
  const fov = portrait ? 58 : 50;
  if (camera.fov !== fov) { camera.fov = fov; camera.updateProjectionMatrix(); }
  let tx, tz, h;
  const P = me(), hv = hviews.get(meId);
  if (mode === 'menu' || !P || !hv) {
    const a = t * 0.06;
    tx = Math.cos(a) * 30; tz = Math.sin(a) * 30; h = 62 * far;
    camPos.set(tx, h, tz + h * 0.7);
    camLook.set(tx, 0, tz);
  } else {
    const R = Math.max(1.2, P.alive ? holeR(P) : 1.1 + 0.16 * Math.sqrt(P.points));
    tx = hv.x; tz = hv.z; h = (13 + R * 4.3) * far;
    if (snapCam) { snapCam = false; camPos.set(tx, h, tz + h * 0.62); camLook.set(tx, 0, tz - 1.5); }
    const k = Math.min(1, dt * 4);
    camPos.x += (tx - camPos.x) * k;
    camPos.z += (tz + h * 0.62 - camPos.z) * k;
    camPos.y += (h - camPos.y) * Math.min(1, dt * 2);
    camLook.x += (tx - camLook.x) * k; camLook.z += (tz - 1.5 - camLook.z) * k;
  }
  camera.position.copy(camPos);
  camera.lookAt(camLook);
  scene.fog.near = camPos.y * 1.6; scene.fog.far = camPos.y * 4.2;

  sun.position.set(camLook.x + 30, 70, camLook.z + 25);
  sun.target.position.copy(camLook);
  const want = Math.min(130, Math.ceil(camPos.y * 1.1 / 5) * 5);
  if (want !== shadowSize) {
    shadowSize = want;
    const c = sun.shadow.camera;
    c.left = -want; c.right = want; c.top = want; c.bottom = -want; c.near = 1; c.far = 240;
    c.updateProjectionMatrix();
  }
}

// ---------- Saydamlaşma: kamera ile deliğin arasına giren nesneler ----------
const _C = new THREE.Vector3(), _D = new THREE.Vector3();
function updateOcclusion(dt) {
  const P = me(), hv = hviews.get(meId), now = new Set();
  if (P && hv && mode !== 'menu') {
    _C.copy(camera.position);
    const tx = hv.x, ty = 0.3, tz = hv.z;
    _D.set(tx - _C.x, ty - _C.y, tz - _C.z);
    const len = _D.length();
    _D.divideScalar(len);
    const R = P.alive ? hv.R : 1.2;
    const mx = (_C.x + tx) / 2, mz = (_C.z + tz) / 2, qr = Math.hypot(_C.x - tx, _C.z - tz) / 2 + 14;
    for (const v of views.values()) {
      if (v.top < 2.2) continue; // alçak nesneler görüşü kapatmaz
      const o = v.o, ox = v.mesh.position.x, oz = v.mesh.position.z;
      if (Math.abs(ox - mx) > qr || Math.abs(oz - mz) > qr) continue;
      // nesneyi dikey bir silindir say; kamera→delik çizgisi üzerindeki noktalar içine giriyor mu?
      const rad = o.size * 1.05 + R * 0.6;
      for (let i = 1; i <= 16; i++) {
        const s = len * (0.15 + 0.85 * i / 16);
        if (_C.y + _D.y * s > v.top) continue;
        if (Math.hypot(_C.x + _D.x * s - ox, _C.z + _D.z * s - oz) < rad) { now.add(v); fadeSet.add(v); break; }
      }
    }
  }
  for (const v of fadeSet) {
    const target = now.has(v) ? 0.3 : 1;
    if (!v.fadeMat) {
      v.fadeMat = v.mesh.material.clone();
      v.fadeMat.transparent = true;
      v.fadeMat.depthWrite = false;
      v.mesh.material = v.fadeMat;
    }
    v.fadeMat.opacity += (target - v.fadeMat.opacity) * Math.min(1, dt * 8);
    if (target === 1 && v.fadeMat.opacity > 0.97) {
      v.mesh.material = v.o.gold ? SHARED.gold : SHARED.mat;
      v.fadeMat.dispose();
      v.fadeMat = null;
      fadeSet.delete(v);
    }
  }
}

// ---------- HUD ----------
const tmpV = new THREE.Vector3();
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
function toast(msg, dur = 2) { const el = $('toast'); el.textContent = msg; el.classList.add('show'); toastT = dur; }
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const row = (cls, color, i, name, pts) => `<li class="${cls}"><i style="background:${color}"></i><span>${i}. ${esc(name)}</span><b>${pts}</b></li>`;

const hudT = {};
function updateHud(dt) {
  for (const h of src.holes) {
    const v = hviews.get(h.id);
    if (!v) continue;
    const p = project(v.x, 0, v.z + v.R + 0.4);
    v.label.style.display = h.alive && p.vis ? '' : 'none';
    v.label.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, 0)`;
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

  const P = me();
  if (mode === 'menu' || !P) return;
  const endless = src.endless;
  const tt = endless ? Math.floor(src.time) : Math.ceil(src.time);
  $('time').textContent = (endless ? '∞ ' : '') + `${Math.floor(tt / 60)}:${String(tt % 60).padStart(2, '0')}`;
  $('time').classList.toggle('hurry', !endless && src.time <= 10 && !ended);
  if (!endless && !ended && src.time <= 10 && Math.ceil(src.time) !== hudT.lastSec) { if (hudT.lastSec !== undefined) Sfx.tick(); }
  hudT.lastSec = Math.ceil(src.time);
  const comboOn = P.combo >= 3 && P.sinceEat < 1.3;
  $('combo').classList.toggle('show', comboOn);
  if (comboOn) $('combo').textContent = `KOMBO x${P.combo}`;
  if (!P.alive && !ended) { $('toast').classList.add('show'); $('toast').textContent = `Yutuldun! ${Math.max(1, Math.ceil(P.respawn))} sn...`; toastT = Math.max(toastT, 0.1); }

  hudT.acc = (hudT.acc ?? 0) - dt;
  if (hudT.acc > 0) return;
  hudT.acc = 0.25;
  $('score').textContent = P.points.toLocaleString('tr-TR');
  $('powers').innerHTML = Object.entries(P.power).filter(([, v]) => v > 0)
    .map(([k, v]) => `<span class="pw" style="--c:${hex(POWERS[k].color)}">${POWERS[k].icon} ${POWERS[k].name} <b>${Math.ceil(v)}</b></span>`).join('');
  const ranked = [...src.holes].sort((a, b) => b.points - a.points);
  const top = ranked.slice(0, innerWidth < 600 ? 4 : 8);
  if (!top.includes(P)) top.push(P);
  $('board').innerHTML = top.map(h => row(h.id === meId ? 'me' : '', h.color, ranked.indexOf(h) + 1, h.name + (mode === 'online' && h.human && h.id !== meId ? ' 🌐' : ''), h.points)).join('');
  drawMinimap();
}

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
  for (const p of pviews.values()) {
    mmx.fillStyle = hex(POWERS[p.kind].color);
    mmx.fillRect((p.x + HALF) * s - 2, (p.z + HALF) * s - 2, 4, 4);
  }
  for (const h of src.holes) {
    const v = hviews.get(h.id);
    if (!h.alive || !v) continue;
    mmx.beginPath();
    mmx.arc((v.x + HALF) * s, (v.z + HALF) * s, Math.max(2.5, v.R * s), 0, Math.PI * 2);
    mmx.fillStyle = h.color; mmx.fill();
    if (h.id === meId) { mmx.lineWidth = 2; mmx.strokeStyle = '#fff'; mmx.stroke(); }
  }
}

// ---------- Menü ----------
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

// seçenekler tarayıcıda hatırlanır
const opt = {
  mode: localStorage.getItem('dd_mode') || 'solo', diff: localStorage.getItem('dd_diff') || 'normal',
  bots: localStorage.getItem('dd_bots') || '6', time: localStorage.getItem('dd_time') || '120',
};
// en iyi skor her mod için ayrı tutulur
const bestKey = () => (opt.mode === 'online' ? 'dd_best_online' : opt.time === '120' ? 'dd_best' : 'dd_best_' + opt.time);
function refreshMenu() {
  $('diffRow').classList.toggle('off', opt.bots === '0');
  document.querySelectorAll('.solo-only').forEach(el => el.classList.toggle('gone', opt.mode !== 'solo'));
  $('onlineInfo').classList.toggle('gone', opt.mode !== 'online');
  $('best').textContent = localStorage.getItem(bestKey()) || '0';
  if (opt.mode === 'online') {
    fetch('/api/stats').then(r => r.json()).then(s => {
      $('onlineCount').textContent = s.players ? `Şu an ${s.players} oyuncu çevrimiçi.` : 'Şu an kimse yok, ilk sen gir!';
    }).catch(() => { $('onlineCount').textContent = 'Sunucuya ulaşılamıyor.'; });
  }
}
for (const seg of document.querySelectorAll('.seg')) {
  const key = seg.dataset.opt;
  for (const b of seg.children) {
    b.classList.toggle('on', b.dataset.v === opt[key]);
    b.onclick = () => {
      opt[key] = b.dataset.v;
      localStorage.setItem('dd_' + key, b.dataset.v);
      for (const x of seg.children) x.classList.toggle('on', x === b);
      refreshMenu();
    };
  }
}
refreshMenu();

function playerName() {
  const name = ($('name').value.trim() || 'Sen').slice(0, 16);
  localStorage.setItem('dd_name', name);
  return name;
}
function enterGame() {
  input.x = input.z = 0;
  $('quit').innerHTML = mode === 'online' ? '🚪<span class="tx"> Çık</span>' : '🏁<span class="tx"> Bitir</span>';
  document.body.classList.add('playing');
  $('menu').classList.add('hidden'); $('end').classList.add('hidden');
}

function startSolo() {
  Sfx.unlock();
  leaveOnline();
  const sim = new Sim({ seed: (Math.random() * 1e9) | 0, diff: opt.diff, endless: opt.time === '0', time: +opt.time || 120 });
  const h = sim.addHole({ name: playerName(), color: chosenColor, human: true });
  sim.addBots(+opt.bots);
  mode = 'solo';
  attach(sim, h.id);
  enterGame();
  toast('Mahalleyi yut! 🕳️');
}

let net = null;
function startOnline() {
  Sfx.unlock();
  leaveOnline();
  toast('Sunucuya bağlanılıyor...', 10);
  $('play').disabled = true;
  net = new Online({
    name: playerName(), color: chosenColor,
    onClose: msg => { net = null; $('play').disabled = false; if (mode === 'online' || !src || src instanceof Online) backToMenu(); toast(msg, 3); },
  });
  const wait = setInterval(() => {
    if (!net) { clearInterval(wait); return; }
    if (net.ready) {
      clearInterval(wait);
      $('play').disabled = false;
      mode = 'online';
      src = net;            // 'reset' olayı sahneyi kurar
      enterGame();
    }
  }, 50);
}
function leaveOnline() { if (net) { const n = net; net = null; n.close(); } }

function saveBest(points) {
  const best = Math.max(+(localStorage.getItem(bestKey()) || 0), points);
  localStorage.setItem(bestKey(), best);
  $('best').textContent = best;
  $('endBest').textContent = best;
}
function showEndSolo() {
  ended = true;
  Sfx.end();
  const P = me();
  const ranked = [...src.holes].sort((a, b) => b.points - a.points);
  const rank = ranked.indexOf(P) + 1;
  saveBest(P.points);
  $('endTitle').textContent = ranked.length === 1 ? `${src.endless ? 'Oyun bitti' : 'Süre bitti'}! ${P.points} puan 🎉`
    : rank === 1 ? 'Mahallenin Kralı! 👑' : rank <= 3 ? `${rank}. oldun, fena değil!` : `${rank}. oldun`;
  $('endList').innerHTML = ranked.map((h, i) => row(h.id === meId ? 'me' : '', h.color, i + 1, h.name, h.points)).join('');
  $('again').classList.remove('gone'); $('nextRound').classList.add('gone');
  setTimeout(() => { $('end').classList.remove('hidden'); document.body.classList.remove('playing'); }, 900);
}
function showEndOnline(rank, next) {
  ended = true;
  Sfx.end();
  const mine = rank.findIndex(r => r[0] === meId);
  if (mine >= 0) saveBest(rank[mine][3]);
  $('endTitle').textContent = mine === 0 ? 'Odanın Kralı! 👑' : mine > 0 ? `${mine + 1}. oldun` : 'Tur bitti';
  $('endList').innerHTML = rank.slice(0, 10).map(([id, name, color, pts], i) => row(id === meId ? 'me' : '', color, i + 1, name, pts)).join('');
  $('again').classList.add('gone'); $('nextRound').classList.remove('gone');
  let left = next;
  $('nextRound').textContent = `Yeni tur ${left} sn sonra`;
  clearInterval(showEndOnline.iv);
  showEndOnline.iv = setInterval(() => {
    left--;
    if (left <= 0 || mode !== 'online') { clearInterval(showEndOnline.iv); $('nextRound').textContent = 'Yeni tur başlıyor...'; return; }
    $('nextRound').textContent = `Yeni tur ${left} sn sonra`;
  }, 1000);
  $('end').classList.remove('hidden');
}

// Menü arka planı: botlar kendi kendine oynar
function startMenuWorld() {
  const sim = new Sim({ seed: 20261028, endless: true });
  sim.addBots(6);
  mode = 'menu';
  attach(sim, 0);
}
function backToMenu() {
  leaveOnline();
  clearInterval(showEndOnline.iv);
  document.body.classList.remove('playing');
  $('end').classList.add('hidden');
  $('menu').classList.remove('hidden');
  $('combo').classList.remove('show');
  startMenuWorld();
  refreshMenu();
}

const start = () => (opt.mode === 'online' ? startOnline() : startSolo());
$('play').onclick = start;
$('again').onclick = start;
$('toMenu').onclick = backToMenu;
$('quit').onclick = () => {
  if (mode === 'solo' && !ended) { src.ended = true; showEndSolo(); }
  else if (mode === 'online') backToMenu();
};
$('name').addEventListener('keydown', e => { if (e.key === 'Enter') start(); });
$('mute').onclick = () => { $('mute').textContent = Sfx.toggle() ? '🔇' : '🔊'; };
$('mute').textContent = Sfx.muted ? '🔇' : '🔊';

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

startMenuWorld();

const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(0.05, clock.getDelta());
  update(dt);
  updateCamera(dt);
  updateOcclusion(dt);
  updateHud(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
frame();
window.__dd = { get src() { return src; }, get meId() { return meId; }, get mode() { return mode; }, views, hviews }; // hata ayıklama için
