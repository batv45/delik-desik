// Online mod istemcisi: sunucudan gelen durumu yerelde tutar.
// Arayüz Sim ile aynıdır (objs, holes, powerups, blocks, time, drain()), böylece çizim kodu iki modda da aynı çalışır.
import { Sim, fromDesc } from './sim.js';

export class Online {
  constructor({ name, color, onClose }) {
    Object.assign(this, { name, color, onClose, objs: new Map(), holes: [], powerups: [], blocks: [], time: 0, endless: false,
      meId: 0, meta: new Map(), events: [], sinceSnap: 0, rtt: 0.1, ready: false, lastIn: { x: 9, z: 9, t: 0 } });
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws.onopen = () => {
      this.send({ t: 'join', name, color });
      this.pingIv = setInterval(() => this.send({ t: 'ping', c: performance.now() }), 2000);
    };
    this.ws.onmessage = e => this.handle(JSON.parse(e.data));
    this.ws.onclose = () => { clearInterval(this.pingIv); if (!this.closed) onClose?.(this.ready ? 'Bağlantı koptu' : 'Sunucuya bağlanılamadı'); };
  }
  send(m) { if (this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }
  close() { this.closed = true; clearInterval(this.pingIv); this.ws.close(); }
  drain() { const e = this.events; this.events = []; return e; }

  // Girdi: değiştiğinde ya da yarım saniyede bir gönderilir (en fazla 20/sn)
  sendInput(x, z) {
    const now = performance.now(), l = this.lastIn;
    if (now - l.t < 50) return;
    if (Math.abs(x - l.x) < 0.03 && Math.abs(z - l.z) < 0.03 && now - l.t < 500) return;
    this.lastIn = { x, z, t: now };
    this.send({ t: 'i', x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100 });
  }

  tick(dt) {
    this.sinceSnap += dt;
    this.time = Math.max(0, this.time - dt);
  }

  handle(m) {
    if (m.t === 'welcome') {
      // Haritayı aynı tohumla yerelde üret, sonra sunucudaki farkları uygula
      const sim = new Sim({ seed: m.seed });
      this.blocks = sim.blocks;
      this.objs = new Map();
      for (const o of sim.objs.values()) this.objs.set(o.id, fromDesc({ ...o, k: o.walker ? 'w' : o.car ? 'c' : undefined, f: o.floors }));
      for (const id of m.removed) this.objs.delete(id);
      for (const d of m.spawned) this.objs.set(d.id, fromDesc(d));
      for (const a of m.dyn) this.applyDyn(a, true);
      this.powerups = m.pw;
      this.meId = m.you;
      this.time = m.time;
      this.total = m.total;
      this.room = m.room;
      this.setMeta(m.holes);
      this.holes = [];
      this.ready = true;
      this.events = [{ e: 'reset', ended: m.ended }];
    } else if (m.t === 'hl') {
      this.setMeta(m.holes);
    } else if (m.t === 's') {
      this.sinceSnap = 0;
      this.time = m.tm;
      const byId = new Map(this.holes.map(h => [h.id, h]));
      this.holes = [];
      for (const a of m.h) {
        const meta = this.meta.get(a[0]);
        if (!meta) continue;
        const h = byId.get(a[0]) || { id: a[0], power: {} };
        Object.assign(h, meta, {
          x: a[1], z: a[2], dispR: a[3], alive: !!a[4], shield: a[5], points: a[9], combo: a[10], sinceEat: a[11],
          respawn: a[12], vx: a[13], vz: a[14],
        });
        h.power.magnet = a[6]; h.power.turbo = a[7]; h.power.giant = a[8];
        this.holes.push(h);
      }
      for (const a of m.d) this.applyDyn(a);
      for (const ev of m.ev) {
        if (ev.e === 'end') continue; // tur sonu ayrı 'end' mesajıyla (sıralamayla) gelir
        if (ev.e === 'spawn') { if (this.objs.has(ev.o.id)) continue; this.objs.set(ev.o.id, fromDesc(ev.o)); }
        else if (ev.e === 'eat') { if (!this.objs.has(ev.id)) continue; this.objs.delete(ev.id); }
        else if (ev.e === 'pw+') { if (this.powerups.some(p => p.id === ev.p.id)) continue; this.powerups.push(ev.p); }
        else if (ev.e === 'pw-') { const i = this.powerups.findIndex(p => p.id === ev.id); if (i < 0) continue; this.powerups.splice(i, 1); }
        this.events.push(ev);
      }
    } else if (m.t === 'end') {
      this.events.push({ e: 'end', rank: m.rank, next: m.next });
    } else if (m.t === 'pong') {
      this.rtt = this.rtt * 0.7 + ((performance.now() - m.c) / 1000) * 0.3;
    }
  }
  // Hareketli nesne güncellemesi. Bir süredir güncellenmeyen (görüş alanı dışında kalmış) nesne
  // ekranda eski yerinden kaymasın, yeni yerine doğrudan geçsin.
  applyDyn([id, x, z, dir], fresh = false) {
    const o = this.objs.get(id);
    if (!o) return;
    const now = performance.now();
    if (fresh || now - (o.seen ?? 0) > 300) o.snap = true;
    o.seen = now;
    o.x = x; o.z = z; o.dyn = true;
    if (dir !== undefined) o.ry = dir * Math.PI / 2;
  }
  setMeta(list) {
    this.meta = new Map(list.map(([id, name, color, human]) => [id, { name, color, human: !!human }]));
  }
}
