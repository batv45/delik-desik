// Tüm 3D modeller kodla üretilir: basit şekiller birleştirilip tek geometriye
// (vertex renkli) dönüştürülür. Böylece her nesne tek draw call olur.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const _c = new THREE.Color();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

class Builder {
  constructor() { this.parts = []; }

  _push(geo, color, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    geo.deleteAttribute('uv');
    _e.set(rx, ry, rz);
    _q.setFromEuler(_e);
    _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
    geo.applyMatrix4(_m);
    _c.set(color);
    const n = geo.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b; }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.parts.push(geo);
    return this;
  }
  // y = kutunun tabanı (merkez değil) — yerleştirmeyi kolaylaştırır
  box(w, h, d, color, x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0) {
    return this._push(new THREE.BoxGeometry(w, h, d), color, x, y + h / 2, z, rx, ry, rz);
  }
  boxC(w, h, d, color, x, y, z, rx = 0, ry = 0, rz = 0) {
    return this._push(new THREE.BoxGeometry(w, h, d), color, x, y, z, rx, ry, rz);
  }
  cyl(rt, rb, h, color, x = 0, y = 0, z = 0, seg = 8, rx = 0, ry = 0, rz = 0) {
    return this._push(new THREE.CylinderGeometry(rt, rb, h, seg), color, x, y + h / 2, z, rx, ry, rz);
  }
  cylC(rt, rb, h, color, x, y, z, seg = 8, rx = 0, ry = 0, rz = 0) {
    return this._push(new THREE.CylinderGeometry(rt, rb, h, seg), color, x, y, z, rx, ry, rz);
  }
  sphere(r, color, x = 0, y = 0, z = 0, seg = 8, sx = 1, sy = 1, sz = 1) {
    return this._push(new THREE.SphereGeometry(r, seg, Math.max(4, seg * 0.75 | 0)), color, x, y, z, 0, 0, 0, sx, sy, sz);
  }
  dome(r, color, x, y, z, seg = 14) {
    return this._push(new THREE.SphereGeometry(r, seg, seg / 2 | 0, 0, Math.PI * 2, 0, Math.PI / 2), color, x, y, z);
  }
  cone(r, h, color, x = 0, y = 0, z = 0, seg = 8, ry = 0, sx = 1, sz = 1) {
    return this._push(new THREE.ConeGeometry(r, h, seg), color, x, y + h / 2, z, 0, ry, 0, sx, 1, sz);
  }
  torus(r, t, color, x, y, z, rx = Math.PI / 2) {
    return this._push(new THREE.TorusGeometry(r, t, 5, 10), color, x, y, z, rx);
  }
  build(scale = 1) {
    const g = mergeGeometries(this.parts, false);
    this.parts.forEach(p => p.dispose());
    if (scale !== 1) g.scale(scale, scale, scale);
    g.computeBoundingSphere();
    return g;
  }
}

const pick = (rng, arr) => arr[(rng() * arr.length) | 0];

const SKIN = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac];
const SHIRT = [0xe63946, 0x457b9d, 0x2a9d8f, 0xf4a261, 0x6a4c93, 0xffffff, 0x1d3557, 0xffb703, 0x8ecae6];
const PANTS = [0x22223b, 0x3d405b, 0x4a4e69, 0x264653, 0x5c4033];
const HAIR = [0x2b1b0e, 0x4a3018, 0x111111, 0x8a6a3a, 0xbbbbbb];
const CAR = [0xd62828, 0x1d4ed8, 0xf8f9fa, 0x222222, 0x6b7280, 0x16a34a, 0xf97316, 0x7c3aed, 0x0ea5e9];
const WALL = [0xf2e8cf, 0xe9c46a, 0xf4a261, 0xdde5b6, 0xbde0fe, 0xffc8dd, 0xe5e5e5, 0xd4a373, 0xfaedcd];
const APT = [0xe8e2d0, 0xd9d4c7, 0xc9ada7, 0xa8dadc, 0xf1dca7, 0xcdb4db, 0xe0e0e0];

// Model fabrikaları: her biri {geo, size, pts} döndürür.
// size: nesnenin "taban yarıçapı" — deliğin bunu yutabilmesi için r > size olmalı.
export const Models = {
  person(rng) {
    const b = new Builder();
    const shirt = pick(rng, SHIRT), pants = pick(rng, PANTS), skin = pick(rng, SKIN), hair = pick(rng, HAIR);
    b.box(0.12, 0.45, 0.13, pants, -0.08, 0, 0);
    b.box(0.12, 0.45, 0.13, pants, 0.08, 0, 0);
    b.box(0.36, 0.5, 0.22, shirt, 0, 0.45, 0);
    b.box(0.09, 0.45, 0.1, shirt, -0.23, 0.48, 0);
    b.box(0.09, 0.45, 0.1, shirt, 0.23, 0.48, 0);
    b.sphere(0.14, skin, 0, 1.09, 0, 8);
    b.box(0.27, 0.08, 0.27, hair, 0, 1.17, -0.01);
    return { geo: b.build(1.35), size: 0.35, pts: 1, height: 1.7 };
  },
  cat(rng) {
    const b = new Builder();
    const c = pick(rng, [0xe07a1f, 0x333333, 0x9e9e9e, 0xf5f5f5, 0xc08040]);
    b.box(0.2, 0.2, 0.46, c, 0, 0.14, 0);
    b.box(0.2, 0.19, 0.18, c, 0, 0.3, 0.27);
    b.cone(0.05, 0.1, c, -0.06, 0.49, 0.27, 4);
    b.cone(0.05, 0.1, c, 0.06, 0.49, 0.27, 4);
    b.boxC(0.05, 0.05, 0.32, c, 0, 0.42, -0.32, -0.9);
    for (const [x, z] of [[-0.07, 0.17], [0.07, 0.17], [-0.07, -0.17], [0.07, -0.17]]) b.box(0.05, 0.14, 0.05, c, x, 0, z);
    b.box(0.04, 0.03, 0.01, 0x2ecc71, -0.05, 0.34, 0.365);
    b.box(0.04, 0.03, 0.01, 0x2ecc71, 0.05, 0.34, 0.365);
    return { geo: b.build(1.1), size: 0.3, pts: 2 };
  },
  cone() {
    const b = new Builder();
    b.box(0.45, 0.05, 0.45, 0x333333);
    b.cone(0.2, 0.65, 0xff6b00, 0, 0.05, 0, 10);
    b.cylC(0.12, 0.14, 0.1, 0xffffff, 0, 0.36, 0, 10);
    return { geo: b.build(), size: 0.25, pts: 1 };
  },
  trash() {
    const b = new Builder();
    b.cyl(0.28, 0.24, 0.85, 0x2d6a4f, 0, 0, 0, 10);
    b.cyl(0.3, 0.3, 0.06, 0x1b4332, 0, 0.85, 0, 10);
    return { geo: b.build(), size: 0.32, pts: 1 };
  },
  bench() {
    const b = new Builder();
    b.box(1.6, 0.08, 0.5, 0xa0522d, 0, 0.42, 0);
    b.box(1.6, 0.35, 0.07, 0xa0522d, 0, 0.6, -0.24);
    b.box(0.08, 0.42, 0.45, 0x333333, -0.7, 0, 0);
    b.box(0.08, 0.42, 0.45, 0x333333, 0.7, 0, 0);
    return { geo: b.build(), size: 0.8, pts: 2 };
  },
  lamp() {
    const b = new Builder();
    b.cyl(0.07, 0.1, 3.8, 0x3a3a3a, 0, 0, 0, 6);
    b.box(0.08, 0.08, 0.8, 0x3a3a3a, 0, 3.7, 0.35);
    b.box(0.3, 0.15, 0.4, 0xfff3b0, 0, 3.58, 0.7);
    return { geo: b.build(), size: 0.3, pts: 2 };
  },
  flag() {
    const b = new Builder();
    b.cyl(0.06, 0.08, 6.5, 0xf0f0f0, 0, 0, 0, 6);
    b.sphere(0.12, 0xffd700, 0, 6.6, 0, 6);
    b.box(0.03, 1.0, 1.5, 0xe30a17, 0, 5.3, 0.78);
    b.boxC(0.05, 0.35, 0.35, 0xffffff, 0, 5.8, 0.6);
    return { geo: b.build(), size: 0.3, pts: 4 };
  },
  tree(rng) {
    const b = new Builder();
    const v = (rng() * 3) | 0;
    const g = pick(rng, [0x2d6a4f, 0x40916c, 0x52b788, 0x386641]);
    b.cyl(0.15, 0.22, 1.4, 0x7f5539, 0, 0, 0, 6);
    if (v === 0) b.sphere(1.1, g, 0, 2.3, 0, 7);
    else if (v === 1) { b.cone(1.1, 2.0, g, 0, 1.2, 0, 7); b.cone(0.8, 1.6, g, 0, 2.3, 0, 7); }
    else { b.sphere(0.9, g, -0.3, 2.0, 0, 6); b.sphere(0.8, g, 0.4, 2.4, 0.2, 6); b.sphere(0.7, g, 0, 2.8, -0.3, 6); }
    return { geo: b.build(), size: 0.9, pts: 4 };
  },
  bush(rng) {
    const b = new Builder();
    const g = pick(rng, [0x40916c, 0x52b788, 0x74c69d]);
    b.sphere(0.55, g, 0, 0.4, 0, 6, 1, 0.8, 1);
    b.sphere(0.4, g, 0.4, 0.3, 0.1, 6);
    if (rng() < 0.4) b.sphere(0.12, 0xff4d6d, 0.1, 0.8, 0.2, 5);
    return { geo: b.build(), size: 0.6, pts: 2 };
  },
  simit() {
    const b = new Builder();
    b.box(1.3, 0.75, 0.75, 0xc1121f, 0, 0.35, 0);
    b.box(1.2, 0.5, 0.65, 0xd8f3f5, 0, 1.1, 0);
    b.box(1.4, 0.06, 0.85, 0xc1121f, 0, 1.6, 0);
    b.cylC(0.3, 0.3, 0.1, 0x222222, -0.55, 0.3, 0.4, 10, Math.PI / 2);
    b.cylC(0.3, 0.3, 0.1, 0x222222, -0.55, 0.3, -0.4, 10, Math.PI / 2);
    b.box(0.08, 0.35, 0.08, 0x555555, 0.55, 0, 0);
    for (let i = 0; i < 4; i++) b.torus(0.13, 0.05, 0xb5651d, -0.35 + i * 0.23, 1.22, 0);
    b.box(0.1, 0.1, 1.0, 0x555555, 0.75, 0.9, 0, 0, 0, 0.6);
    return { geo: b.build(), size: 0.85, pts: 6 };
  },
  cay() {
    const b = new Builder();
    b.cyl(0.42, 0.42, 0.05, 0xf5f5f5, 0, 0.62, 0, 12);
    b.cyl(0.05, 0.05, 0.62, 0x777777, 0, 0, 0, 6);
    b.cyl(0.18, 0.18, 0.04, 0x777777, 0, 0, 0, 8);
    b.cyl(0.2, 0.2, 0.05, 0x2a9d8f, -0.65, 0.42, 0, 8);
    b.cyl(0.03, 0.03, 0.42, 0x555555, -0.65, 0, 0, 4);
    b.cyl(0.2, 0.2, 0.05, 0x2a9d8f, 0.65, 0.42, 0, 8);
    b.cyl(0.03, 0.03, 0.42, 0x555555, 0.65, 0, 0, 4);
    b.cyl(0.04, 0.035, 0.12, 0xa4161a, -0.12, 0.67, 0.05, 6);
    b.cyl(0.04, 0.035, 0.12, 0xa4161a, 0.15, 0.67, -0.08, 6);
    return { geo: b.build(), size: 0.85, pts: 3 };
  },
  kiosk(rng) {
    const b = new Builder();
    const c = pick(rng, [0x1d4ed8, 0xd62828, 0x16a34a, 0xf59e0b]);
    b.box(2.4, 2.4, 2.2, 0xfafafa, 0, 0, 0);
    b.box(2.2, 1.0, 0.05, 0x9ad1d4, 0, 1.0, 1.11);
    b.box(2.7, 0.12, 1.0, c, 0, 2.2, 1.35, 0, -0.25);
    b.box(2.5, 0.35, 2.3, c, 0, 2.4, 0);
    b.box(1.6, 0.35, 0.05, 0xffffff, 0, 2.4, 1.16);
    return { geo: b.build(), size: 1.45, pts: 9 };
  },
  car(rng, color) {
    const b = new Builder();
    const c = color ?? pick(rng, CAR);
    b.box(1.7, 0.65, 3.8, c, 0, 0.3, 0);
    b.box(1.5, 0.55, 2.0, 0x26323c, 0, 0.95, -0.25);
    b.box(1.52, 0.08, 1.8, c, 0, 1.5, -0.25);
    for (const [x, z] of [[-0.82, 1.2], [0.82, 1.2], [-0.82, -1.2], [0.82, -1.2]])
      b.cylC(0.34, 0.34, 0.25, 0x111111, x, 0.34, z, 10, 0, 0, Math.PI / 2);
    b.box(0.35, 0.15, 0.05, 0xfffbd6, -0.55, 0.65, 1.9);
    b.box(0.35, 0.15, 0.05, 0xfffbd6, 0.55, 0.65, 1.9);
    b.box(0.35, 0.15, 0.05, 0xff2222, -0.55, 0.65, -1.9);
    b.box(0.35, 0.15, 0.05, 0xff2222, 0.55, 0.65, -1.9);
    return { geo: b.build(), size: 1.7, pts: 12 };
  },
  taxi(rng) {
    const m = Models.car(rng, 0xffcc00);
    const b = new Builder();
    b.box(0.7, 0.25, 0.3, 0x111111, 0, 1.58, -0.2);
    b.box(0.6, 0.15, 0.32, 0xffffff, 0, 1.63, -0.2);
    b.box(1.72, 0.12, 0.5, 0x111111, 0, 0.75, 0.3);
    const g = mergeGeometries([m.geo, b.build()], false);
    g.computeBoundingSphere();
    return { geo: g, size: 1.7, pts: 14 };
  },
  dolmus() {
    const b = new Builder();
    const c = 0xffd60a;
    b.box(2.0, 1.9, 5.2, c, 0, 0.35, 0);
    b.box(2.02, 0.6, 3.8, 0x26323c, 0, 1.25, -0.4);
    b.box(1.9, 0.5, 0.05, 0x26323c, 0, 1.3, 2.6);
    b.box(2.02, 0.1, 5.22, 0x111111, 0, 0.8, 0);
    for (const [x, z] of [[-0.95, 1.7], [0.95, 1.7], [-0.95, -1.7], [0.95, -1.7]])
      b.cylC(0.38, 0.38, 0.28, 0x111111, x, 0.38, z, 10, 0, 0, Math.PI / 2);
    b.box(0.5, 0.18, 0.05, 0xfffbd6, -0.6, 0.6, 2.6);
    b.box(0.5, 0.18, 0.05, 0xfffbd6, 0.6, 0.6, 2.6);
    return { geo: b.build(), size: 2.4, pts: 22 };
  },
  bus() {
    const b = new Builder();
    b.box(2.5, 2.6, 10, 0xf1f1f1, 0, 0.45, 0);
    b.box(2.52, 0.9, 9.2, 0x26323c, 0, 1.75, 0.1);
    b.box(2.52, 0.5, 10.02, 0x1d4ed8, 0, 0.5, 0);
    b.box(2.0, 0.3, 4, 0xcccccc, 0, 3.05, -1);
    b.box(2.3, 0.4, 0.05, 0x111111, 0, 2.5, 5.0);
    b.box(1.5, 0.25, 0.06, 0xffa500, 0, 2.55, 5.01);
    for (const z of [3.4, -3.4]) for (const x of [-1.2, 1.2])
      b.cylC(0.5, 0.5, 0.3, 0x111111, x, 0.5, z, 10, 0, 0, Math.PI / 2);
    return { geo: b.build(), size: 4.5, pts: 45 };
  },
  fountain() {
    const b = new Builder();
    b.cyl(2.3, 2.4, 0.6, 0xbfb5a8, 0, 0, 0, 16);
    b.cyl(2.0, 2.0, 0.62, 0x4cc9f0, 0, 0, 0, 16);
    b.cyl(0.25, 0.35, 1.6, 0xbfb5a8, 0, 0, 0, 8);
    b.cyl(0.9, 0.4, 0.3, 0xbfb5a8, 0, 1.6, 0, 12);
    b.cyl(0.7, 0.7, 0.32, 0x90e0ef, 0, 1.62, 0, 12);
    b.cone(0.18, 0.7, 0xcaf0f8, 0, 1.9, 0, 8);
    return { geo: b.build(), size: 2.4, pts: 30 };
  },
  house(rng, w, d, floors) {
    const b = new Builder();
    const wall = pick(rng, WALL);
    const h = floors * 2.8;
    b.box(w, h, d, wall, 0, 0, 0);
    const R = Math.max(w, d) / Math.SQRT2 * 1.12;
    b.cone(R, 1.8, pick(rng, [0xb8432f, 0x9c3a26, 0xc75c3b]), 0, h, 0, 4, Math.PI / 4, w / Math.max(w, d), d / Math.max(w, d));
    // pencereler
    for (let f = 0; f < floors; f++) {
      const y = f * 2.8 + 1.0;
      const nx = Math.max(1, Math.floor(w / 2));
      for (let i = 0; i < nx; i++) {
        const x = -w / 2 + (i + 0.5) * (w / nx);
        if (!(f === 0 && i === (nx >> 1))) b.box(0.8, 1.0, 0.08, 0x3a5a78, x, y, d / 2);
        b.box(0.8, 1.0, 0.08, 0x3a5a78, x, y, -d / 2);
      }
      const nz = Math.max(1, Math.floor(d / 2.2));
      for (let i = 0; i < nz; i++) {
        const z = -d / 2 + (i + 0.5) * (d / nz);
        b.box(0.08, 1.0, 0.8, 0x3a5a78, w / 2, y, z);
        b.box(0.08, 1.0, 0.8, 0x3a5a78, -w / 2, y, z);
      }
    }
    const nx = Math.max(1, Math.floor(w / 2));
    b.box(0.9, 1.9, 0.1, 0x6b3e26, -w / 2 + ((nx >> 1) + 0.5) * (w / nx), 0, d / 2);
    const size = Math.hypot(w, d) / 2 * 0.85;
    return { geo: b.build(), size, pts: Math.round(size * size * 3 * (0.7 + floors * 0.3)) };
  },
  apartment(rng, w, d, floors) {
    const b = new Builder();
    const wall = pick(rng, APT);
    const fh = 3;
    const h = floors * fh + 0.6;
    b.box(w, 0.6, d, 0x8d8d8d, 0, 0, 0);
    b.box(w, h - 0.6, d, wall, 0, 0.6, 0);
    b.box(w + 0.2, 0.5, d + 0.2, 0xaaaaaa, 0, h, 0);
    b.box(w - 0.6, 0.1, d - 0.6, 0x777777, 0, h + 0.35, 0);
    // çatı: su deposu + çanak anten (mahalle klasiği)
    b.cylC(0.6, 0.6, 1.6, 0xdddddd, w / 4, h + 1.0, -d / 4, 10, 0, 0, Math.PI / 2);
    b.sphere(0.45, 0xf0f0f0, -w / 4, h + 1.0, d / 4, 8, 1, 1, 0.3);
    b.box(0.08, 0.6, 0.08, 0x555555, -w / 4, h + 0.4, d / 4);
    for (let f = 0; f < floors; f++) {
      const y = 0.6 + f * fh + 0.9;
      const nx = Math.max(2, Math.floor(w / 2.4));
      for (let i = 0; i < nx; i++) {
        const x = -w / 2 + (i + 0.5) * (w / nx);
        b.box(1.1, 1.3, 0.08, 0x2f4858, x, y, d / 2);
        b.box(1.1, 1.3, 0.08, 0x2f4858, x, y, -d / 2);
        if (f > 0 && i % 2 === 0) b.box(1.6, 0.9, 0.7, 0xb0b0b0, x, y - 0.95, d / 2 + 0.35);
      }
      const nz = Math.max(2, Math.floor(d / 2.4));
      for (let i = 0; i < nz; i++) {
        const z = -d / 2 + (i + 0.5) * (d / nz);
        b.box(0.08, 1.3, 1.1, 0x2f4858, w / 2, y, z);
        b.box(0.08, 1.3, 1.1, 0x2f4858, -w / 2, y, z);
      }
    }
    const size = Math.hypot(w, d) / 2 * 0.85;
    return { geo: b.build(), size, pts: Math.round(size * size * 2.2 * (0.6 + floors * 0.15)) };
  },
  // Meydanın simgesi: saat kulesi (haritanın en büyük ödülü)
  clocktower() {
    const b = new Builder();
    const stone = 0xeadcc0, band = 0xc9a77c, dark = 0x2b2238, roof = 0x8c3b2a;
    b.box(14, 0.5, 14, 0xcfc3aa, 0, 0, 0);
    b.box(11, 0.5, 11, 0xdcd1b8, 0, 0.5, 0);
    b.box(7, 6, 7, stone, 0, 1, 0);
    for (const r of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const sx = Math.sin(r) * 3.52, sz = Math.cos(r) * 3.52;
      b.box(2, 3.4, 0.12, 0x6b3e26, sx, 1, sz, r);          // kapı
      b.box(2.4, 0.5, 0.2, band, sx, 4.4, sz, r);
    }
    b.box(7.6, 0.6, 7.6, band, 0, 7, 0);
    b.box(5, 12, 5, stone, 0, 7.6, 0);
    for (const y of [11, 15]) b.box(5.2, 0.4, 5.2, band, 0, y, 0);
    for (const r of [0, Math.PI / 2, Math.PI, -Math.PI / 2])
      b.box(0.9, 2.2, 0.12, 0x35577a, Math.sin(r) * 2.52, 12.2, Math.cos(r) * 2.52, r);
    b.box(6.2, 5, 6.2, 0xf3ead6, 0, 19.6, 0);
    // dört yüzde saat
    const cy = 22.1;
    for (const r of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const nx = Math.sin(r), nz = Math.cos(r);
      const zf = Math.abs(nz) > 0.5; // kadranı yüzeye dik çevir
      b.cylC(2.15, 2.15, 0.12, band, nx * 3.12, cy, nz * 3.12, 24, zf ? Math.PI / 2 : 0, 0, zf ? 0 : Math.PI / 2);
      b.cylC(1.9, 1.9, 0.12, 0xffffff, nx * 3.2, cy, nz * 3.2, 24, zf ? Math.PI / 2 : 0, 0, zf ? 0 : Math.PI / 2);
      b.boxC(0.22, 1.3, 0.08, dark, nx * 3.3, cy + 0.55, nz * 3.3, 0, r);                 // akrep
      b.boxC(1.6, 0.16, 0.08, dark, nx * 3.3 + Math.cos(r) * 0.7, cy, nz * 3.3 - Math.sin(r) * 0.7, 0, r); // yelkovan
    }
    b.box(7, 0.5, 7, band, 0, 24.6, 0);
    for (const [x, z] of [[2.6, 2.6], [-2.6, 2.6], [2.6, -2.6], [-2.6, -2.6]]) b.box(0.8, 3, 0.8, stone, x, 25.1, z);
    b.box(6.4, 0.4, 6.4, band, 0, 28.1, 0);
    b.cone(4.7, 5.5, roof, 0, 28.5, 0, 4, Math.PI / 4);
    b.sphere(0.45, 0xffd700, 0, 34.3, 0, 8);
    b.cyl(0.06, 0.06, 2.2, 0xdddddd, 0, 34.6, 0, 4);
    b.box(0.03, 0.8, 1.2, 0xe30a17, 0, 35.9, 0.62);
    return { geo: b.build(), size: 8, pts: 600 };
  },
  // Güç nesneleri (kristal)
  powerup(color) {
    const b = new Builder();
    b._push(new THREE.OctahedronGeometry(0.7, 0), color, 0, 0, 0, 0, 0, 0, 1, 1.4, 1);
    return b.build();
  },
};

export const SHARED = {
  mat: new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
  gold: new THREE.MeshLambertMaterial({ color: 0xffcf33, emissive: 0x6b4a00, flatShading: true }),
};
