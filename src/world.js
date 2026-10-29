// Mahalle haritası üretimi: yollar, adalar (bloklar), zemin dokusu ve nesne yerleşimi.

export const N_BLOCKS = 7;           // harita N x N adadan oluşur (tek sayı: ortada meydan)
export const ROADS = Array.from({ length: N_BLOCKS + 1 }, (_, i) => (i - N_BLOCKS / 2) * 44);
export const HALF = ROADS[ROADS.length - 1] + 5; // harita yarı genişliği
export const ROAD_HW = 4.5;         // yol yarı genişliği
export const WALK = 2.5;            // kaldırım genişliği

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rr = (rng, a, b) => a + rng() * (b - a);

export function generate(seed) {
  const rng = mulberry32(seed);
  const blocks = [];
  const mid = N_BLOCKS >> 1;
  for (let i = 0; i < N_BLOCKS; i++) for (let j = 0; j < N_BLOCKS; j++) {
    const x0 = ROADS[i] + ROAD_HW, x1 = ROADS[i + 1] - ROAD_HW;
    const z0 = ROADS[j] + ROAD_HW, z1 = ROADS[j + 1] - ROAD_HW;
    let kind;
    if (i === mid && j === mid) kind = 'meydan';
    else {
      const r = rng();
      kind = r < 0.36 ? 'ev' : r < 0.62 ? 'apartman' : r < 0.82 ? 'park' : 'carsi';
    }
    blocks.push({ i, j, x0, x1, z0, z1, kind });
  }
  // her türden en az bir tane olsun
  const need = ['park', 'carsi', 'apartman', 'ev'];
  for (const k of need) if (!blocks.some(b => b.kind === k)) {
    const cands = blocks.filter(b => b.kind !== 'meydan');
    cands[(rng() * cands.length) | 0].kind = k;
  }

  const specs = [];
  const add = (type, x, z, ry = rng() * Math.PI * 2, extra = {}) => specs.push({ type, x, z, ry, ...extra });

  for (const b of blocks) {
    const ix0 = b.x0 + WALK, ix1 = b.x1 - WALK, iz0 = b.z0 + WALK, iz1 = b.z1 - WALK;
    const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
    // kaldırım: lamba, çöp, ağaç
    for (const side of [0, 1, 2, 3]) {
      for (let t = 6; t < 33; t += 12) {
        const p = sidewalkPoint(b, side, b.x0 + t, b.z0 + t, 0.5);
        add('lamp', p.x, p.z, p.ry);
        if (rng() < 0.35) { const q = sidewalkPoint(b, side, b.x0 + t + 2.5, b.z0 + t + 2.5, 0.8); add('trash', q.x, q.z); }
        if (rng() < 0.3) { const q = sidewalkPoint(b, side, b.x0 + t + 4.5, b.z0 + t + 4.5, 0.9); add('tree', q.x, q.z); }
      }
    }
    if (b.kind === 'ev') {
      const n = 4, cell = (ix1 - ix0) / n;
      for (let a = 0; a < n; a++) for (let c = 0; c < n; c++) {
        const x = ix0 + (a + 0.5) * cell, z = iz0 + (c + 0.5) * cell;
        const r = rng();
        if (r < 0.62) {
          const w = rr(rng, 4.2, 6.2), d = rr(rng, 4.2, 6.2), f = 1 + ((rng() * 3) | 0);
          const ry = [0, Math.PI / 2, Math.PI, -Math.PI / 2][(rng() * 4) | 0];
          add('house', x, z, ry, { w, d, floors: f });
          if (rng() < 0.5) add('bush', x + rr(rng, -3, 3), z + rr(rng, -3.5, -3));
        } else if (r < 0.85) {
          add('tree', x + rr(rng, -1.5, 1.5), z + rr(rng, -1.5, 1.5));
          if (rng() < 0.6) add('tree', x + rr(rng, -2.5, 2.5), z + rr(rng, -2.5, 2.5));
          add('bush', x + rr(rng, -3, 3), z + rr(rng, -3, 3));
        } else {
          add('car', x, z, rng() < 0.5 ? 0 : Math.PI / 2, { parked: true });
        }
      }
    } else if (b.kind === 'apartman') {
      const n = 2, cell = (ix1 - ix0) / n;
      for (let a = 0; a < n; a++) for (let c = 0; c < n; c++) {
        const x = ix0 + (a + 0.5) * cell, z = iz0 + (c + 0.5) * cell;
        if (rng() < 0.85) {
          const w = rr(rng, 8.5, 12), d = rr(rng, 8.5, 12), f = 4 + ((rng() * 5) | 0);
          add('apartment', x, z, [0, Math.PI / 2][(rng() * 2) | 0], { w, d, floors: f });
        } else {
          add('car', x - 2, z, 0, { parked: true });
          add('car', x + 2, z, 0, { parked: true });
          add('car', x + 6, z, 0, { parked: true });
        }
      }
      for (let k = 0; k < 6; k++) add('bush', rr(rng, ix0, ix1), rng() < 0.5 ? iz0 + 0.5 : iz1 - 0.5);
    } else if (b.kind === 'park') {
      add('fountain', cx, cz, 0);
      for (let k = 0; k < 22; k++) {
        const x = rr(rng, ix0 + 1, ix1 - 1), z = rr(rng, iz0 + 1, iz1 - 1);
        if (Math.hypot(x - cx, z - cz) < 5 || Math.abs(x - cx) < 1.8 || Math.abs(z - cz) < 1.8) continue;
        add(rng() < 0.75 ? 'tree' : 'bush', x, z);
      }
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        add('bench', cx + Math.cos(a) * 6, cz + Math.sin(a) * 6, -a - Math.PI / 2);
      }
      for (let k = 0; k < 3; k++) add('cay', rr(rng, ix0 + 2, ix1 - 2), rr(rng, iz0 + 2, iz1 - 2));
      add('flag', ix0 + 1.5, iz0 + 1.5, 0);
    } else if (b.kind === 'carsi') {
      for (let k = 0; k < 6; k++) add('kiosk', ix0 + 3 + (k % 3) * 11, k < 3 ? iz0 + 3 : iz1 - 3, k < 3 ? 0 : Math.PI);
      for (let k = 0; k < 5; k++) add('simit', rr(rng, ix0 + 3, ix1 - 3), rr(rng, cz - 6, cz + 6));
      for (let k = 0; k < 8; k++) add('cay', rr(rng, ix0 + 2, ix1 - 2), rr(rng, cz - 8, cz + 8));
      for (let k = 0; k < 6; k++) add('cone', rr(rng, ix0, ix1), rr(rng, iz0, iz1));
      add('flag', cx, cz, 0);
    } else if (b.kind === 'meydan') {
      add('clocktower', cx, cz - 2, 0);
      add('fountain', cx, cz + 10.5, 0);
      for (let k = 0; k < 10; k++) {
        const s = k < 5 ? -1 : 1;
        add('tree', cx + s * 13.5, iz0 + 2 + (k % 5) * 7);
      }
      for (let k = 0; k < 6; k++) add('bench', cx + (k - 2.5) * 4.5, iz1 - 1.2, Math.PI);
      add('flag', cx - 8, cz + 11, 0);
      add('flag', cx + 8, cz + 11, 0);
      for (let k = 0; k < 2; k++) add('simit', cx + rr(rng, -10, 10), cz + rr(rng, 9, 15));
    }
  }

  // yol işaretleri: kavşaklarda koniler
  for (const x of ROADS) for (const z of ROADS) if (rng() < 0.18) {
    for (let k = 0; k < 3; k++) add('cone', x + ROAD_HW + 0.2, z - 2 + k * 2);
  }

  return { blocks, specs, rng };
}

// Bir bloğun kaldırımında nokta. side: 0=alt(z0) 1=üst(z1) 2=sol(x0) 3=sağ(x1)
export function sidewalkPoint(b, side, tx, tz, off = 1.2) {
  tx = Math.min(b.x1 - 1, Math.max(b.x0 + 1, tx));
  tz = Math.min(b.z1 - 1, Math.max(b.z0 + 1, tz));
  if (side === 0) return { x: tx, z: b.z0 + off, ry: 0 };
  if (side === 1) return { x: tx, z: b.z1 - off, ry: Math.PI };
  if (side === 2) return { x: b.x0 + off, z: tz, ry: Math.PI / 2 };
  return { x: b.x1 - off, z: tz, ry: -Math.PI / 2 };
}

// Zemin dokusu (canvas)
export function drawGround(blocks, px = 2048) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = px;
  const g = cv.getContext('2d');
  const k = px / (HALF * 2);
  const X = v => (v + HALF) * k;
  const rect = (x0, z0, x1, z1, c) => { g.fillStyle = c; g.fillRect(X(x0), X(z0), (x1 - x0) * k, (z1 - z0) * k); };

  rect(-HALF, -HALF, HALF, HALF, '#7aa86a');
  // yollar
  for (const r of ROADS) {
    rect(r - ROAD_HW, -HALF, r + ROAD_HW, HALF, '#4b4f58');
    rect(-HALF, r - ROAD_HW, HALF, r + ROAD_HW, '#4b4f58');
  }
  // orta şerit kesik çizgi
  g.fillStyle = '#f4f1de';
  for (const r of ROADS) {
    for (let t = -HALF; t < HALF; t += 6) {
      if (ROADS.some(q => Math.abs(t + 1.5 - q) < ROAD_HW + 1)) continue;
      g.fillRect(X(r - 0.12), X(t), 0.24 * k, 3 * k);
      g.fillRect(X(t), X(r - 0.12), 3 * k, 0.24 * k);
    }
  }
  // yaya geçitleri
  g.fillStyle = '#e9e9e9';
  for (const x of ROADS) for (const z of ROADS) {
    for (let s = -ROAD_HW + 0.5; s < ROAD_HW - 0.4; s += 1.1) {
      g.fillRect(X(x + s), X(z + ROAD_HW + 0.3), 0.55 * k, 1.8 * k);
      g.fillRect(X(x + s), X(z - ROAD_HW - 2.1), 0.55 * k, 1.8 * k);
      g.fillRect(X(x + ROAD_HW + 0.3), X(z + s), 1.8 * k, 0.55 * k);
      g.fillRect(X(x - ROAD_HW - 2.1), X(z + s), 1.8 * k, 0.55 * k);
    }
  }
  const fill = { ev: '#93c47d', apartman: '#cfc6b4', park: '#76b960', carsi: '#d8c7a3', meydan: '#e4dccb' };
  for (const b of blocks) {
    rect(b.x0, b.z0, b.x1, b.z1, '#9a9a9a');                       // bordür
    rect(b.x0 + 0.25, b.z0 + 0.25, b.x1 - 0.25, b.z1 - 0.25, '#d9d5cc'); // kaldırım
    rect(b.x0 + WALK, b.z0 + WALK, b.x1 - WALK, b.z1 - WALK, fill[b.kind]);
    const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
    if (b.kind === 'park') {
      g.fillStyle = '#e3d5b0';
      g.fillRect(X(cx - 1.4), X(b.z0 + WALK), 2.8 * k, (b.z1 - b.z0 - 2 * WALK) * k);
      g.fillRect(X(b.x0 + WALK), X(cz - 1.4), (b.x1 - b.x0 - 2 * WALK) * k, 2.8 * k);
      g.beginPath(); g.arc(X(cx), X(cz), 7.5 * k, 0, Math.PI * 2); g.fill();
    } else if (b.kind === 'carsi' || b.kind === 'meydan') {
      g.strokeStyle = 'rgba(0,0,0,0.07)'; g.lineWidth = 1;
      for (let t = b.x0 + WALK; t < b.x1 - WALK; t += 2) { g.beginPath(); g.moveTo(X(t), X(b.z0 + WALK)); g.lineTo(X(t), X(b.z1 - WALK)); g.stroke(); }
      for (let t = b.z0 + WALK; t < b.z1 - WALK; t += 2) { g.beginPath(); g.moveTo(X(b.x0 + WALK), X(t)); g.lineTo(X(b.x1 - WALK), X(t)); g.stroke(); }
    } else if (b.kind === 'ev') {
      g.strokeStyle = 'rgba(80,60,40,0.25)'; g.lineWidth = 2;
      const cell = (b.x1 - b.x0 - 2 * WALK) / 4;
      for (let a = 1; a < 4; a++) {
        g.beginPath(); g.moveTo(X(b.x0 + WALK + a * cell), X(b.z0 + WALK)); g.lineTo(X(b.x0 + WALK + a * cell), X(b.z1 - WALK)); g.stroke();
        g.beginPath(); g.moveTo(X(b.x0 + WALK), X(b.z0 + WALK + a * cell)); g.lineTo(X(b.x1 - WALK), X(b.z0 + WALK + a * cell)); g.stroke();
      }
    }
  }
  // dış sınır
  g.strokeStyle = '#3b3b3b'; g.lineWidth = 6;
  g.strokeRect(3, 3, px - 6, px - 6);
  return cv;
}
