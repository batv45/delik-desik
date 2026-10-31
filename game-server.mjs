// Online oyun sunucusu: odalar, botlar, turlar. Simülasyon src/sim.js (tek kişilik modla aynı kod).
import { WebSocketServer } from 'ws';
import { Sim, COLORS, holeR, desc } from './src/sim.js';

const TICK = 1 / 30;            // simülasyon adımı
const SEND_EVERY = 2;           // her 2 adımda bir anlık görüntü (15/sn)
const ROUND_TIME = +process.env.ROUND_TIME || 180; // online tur süresi (sn)
const BREAK_TIME = 8;           // turlar arası bekleme (sn)
const MAX_HUMANS = 10;          // oda başına oyuncu
const r1 = v => Math.round(v * 10) / 10;

class Room {
  constructor(id) {
    this.id = id;
    this.clients = new Set();
    this.tick = 0;
    this.pending = [];
    this.newRound();
    this.timer = setInterval(() => this.update(), TICK * 1000);
  }

  get humans() { return this.clients.size; }
  wantedBots() { return Math.max(2, 7 - this.humans); }
  bots() { return this.sim.holes.filter(h => !h.human); }

  newRound() {
    // online'da botlar yalnızca dolgu: insanları kovalamaz, yavaş büyür; asıl rekabet oyuncular arasında
    this.sim = new Sim({ seed: (Math.random() * 1e9) | 0, diff: 'kolay', time: ROUND_TIME, powerups: false });
    this.initialCount = this.sim.nextId;
    this.breakUntil = 0;
    this.pending = [];
    for (const c of this.clients) c.hole = this.sim.addHole({ name: c.name, color: c.color, human: true });
    this.sim.addBots(this.wantedBots());
    for (const c of this.clients) this.welcome(c);
  }

  holeList() { return this.sim.holes.map(h => [h.id, h.name, h.color, h.human ? 1 : 0]); }
  broadcast(msg) { const s = JSON.stringify(msg); for (const c of this.clients) if (c.ws.readyState === 1) c.ws.send(s); }

  welcome(c) {
    const sim = this.sim, removed = [], spawned = [], dyn = [];
    const alive = new Set();
    for (const o of sim.objs.values()) {
      alive.add(o.id);
      if (o.id >= this.initialCount) spawned.push(desc(o));
      else if (o.walker || o.car || o.moved) dyn.push([o.id, r1(o.x), r1(o.z)]);
    }
    for (let id = 1; id < this.initialCount; id++) if (!alive.has(id)) removed.push(id);
    c.send({
      t: 'welcome', you: c.hole.id, seed: sim.seed, time: sim.time, total: ROUND_TIME, room: this.id,
      removed, spawned, dyn, pw: sim.powerups, holes: this.holeList(), ended: !!this.breakUntil,
    });
  }

  join(c) {
    this.clients.add(c);
    c.room = this;
    c.hole = this.sim.addHole({ name: c.name, color: c.color, human: true });
    const extra = this.bots().length - this.wantedBots();
    if (extra > 0) for (const b of this.bots().sort((a, b) => a.points - b.points).slice(0, extra)) this.sim.removeHole(b.id);
    this.welcome(c);
    this.broadcast({ t: 'hl', holes: this.holeList() });
  }

  leave(c) {
    this.clients.delete(c);
    if (c.hole) this.sim.removeHole(c.hole.id);
    if (!this.clients.size) { clearInterval(this.timer); rooms.delete(this.id); return; }
    const missing = this.wantedBots() - this.bots().length;
    if (missing > 0) this.sim.addBots(missing);
    this.broadcast({ t: 'hl', holes: this.holeList() });
  }

  update() {
    const sim = this.sim;
    if (this.breakUntil) {
      if (Date.now() >= this.breakUntil) this.newRound();
      return;
    }
    sim.step(TICK);
    this.pending.push(...sim.drain());
    if (sim.ended) {
      const rank = [...sim.holes].sort((a, b) => b.points - a.points).map(h => [h.id, h.name, h.color, h.points]);
      this.flush();
      this.broadcast({ t: 'end', rank, next: BREAK_TIME });
      this.breakUntil = Date.now() + BREAK_TIME * 1000;
      return;
    }
    if (++this.tick % SEND_EVERY === 0) this.flush();
  }

  flush() {
    const sim = this.sim;
    const holes = sim.holes.map(h => [h.id, r1(h.x), r1(h.z), Math.round(h.dispR * 100) / 100, h.alive ? 1 : 0, h.shield > 0 ? 1 : 0,
      Math.ceil(h.power.magnet), Math.ceil(h.power.turbo), Math.ceil(h.power.giant), h.points, h.combo, r1(Math.min(h.sinceEat, 9)),
      r1(Math.max(0, h.respawn)), r1(h.vx), r1(h.vz)]);
    const ev = this.pending;
    this.pending = [];
    for (const c of this.clients) {
      if (c.ws.readyState !== 1) continue;
      // yalnızca oyuncunun çevresindeki hareketli nesneleri gönder
      const h = c.hole, d = [];
      if (h) {
        const rad = 50 + holeR(h) * 8;
        sim.query(h.x, h.z, rad, o => { if (o.walker || o.car || o.moved) d.push([o.id, r1(o.x), r1(o.z)]); });
      }
      c.ws.send(JSON.stringify({ t: 's', tm: r1(sim.time), h: holes, d, ev }));
    }
  }
}

const rooms = new Map();
let roomSeq = 1;
function findRoom() {
  for (const r of rooms.values()) if (r.humans < MAX_HUMANS) return r;
  const r = new Room(roomSeq++);
  rooms.set(r.id, r);
  return r;
}

const cleanName = n => String(n ?? '').replace(/[\u0000-\u001f<>&"]/g, '').trim().slice(0, 16) || 'Oyuncu';

export function attach(server) {
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 2048 });
  wss.on('connection', ws => {
    const c = ws.c = { ws, name: 'Oyuncu', color: COLORS[0], room: null, hole: null, alive: true, msgs: 0, sec: 0,
      send: m => ws.readyState === 1 && ws.send(JSON.stringify(m)) };
    ws.on('pong', () => { c.alive = true; });
    ws.on('message', raw => {
      // basit hız sınırı
      const now = Date.now() / 1000 | 0;
      if (now !== c.sec) { c.sec = now; c.msgs = 0; }
      if (++c.msgs > 60) return;
      let m;
      try { m = JSON.parse(raw); } catch { return; }
      if (m.t === 'join' && !c.room) {
        c.name = cleanName(m.name);
        c.color = COLORS.includes(m.color) ? m.color : COLORS[0];
        findRoom().join(c);
      } else if (m.t === 'i' && c.room && c.hole) {
        c.room.sim.setInput(c.hole.id, +m.x || 0, +m.z || 0);
      } else if (m.t === 'ping') {
        c.send({ t: 'pong', c: m.c });
      }
    });
    ws.on('close', () => { c.room?.leave(c); c.room = null; });
  });
  // kopuk bağlantıları temizle
  setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.c.alive) { ws.terminate(); continue; }
      ws.c.alive = false;
      ws.ping();
    }
  }, 20000);
  return { stats: () => ({ rooms: rooms.size, players: [...rooms.values()].reduce((n, r) => n + r.humans, 0) }) };
}
