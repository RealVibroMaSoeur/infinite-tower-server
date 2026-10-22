'use strict';
// Infinite Tower CO-OP v0.2 — authoritative 2-player combat, no paid services.
// Rooms and runs are in RAM. Render free instance restarts can erase active runs.
const http = require('node:http');
const crypto = require('node:crypto');
const WebSocket = require('ws');
const PORT = Number(process.env.PORT || 3000);
const rooms = new Map();
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TYPES = [
  { name: 'Melee', hp: 1, speed: 1, color: '#7fd3ff' },
  { name: 'Runner', hp: .65, speed: 1.7, color: '#c3f38d' },
  { name: 'Tank', hp: 4, speed: .65, color: '#faad74' },
  { name: 'Ranged', hp: 1.4, speed: .9, color: '#d39bff' },
  { name: 'Boss', hp: 30, speed: .5, color: '#ff607e' }
];
const UPGRADES = [
  { key: 'damage', name: 'Damage', cost: 20, growth: 1.16 },
  { key: 'speed', name: 'Attack Speed', cost: 25, growth: 1.18 },
  { key: 'hp', name: 'Core HP', cost: 20, growth: 1.17 },
  { key: 'regen', name: 'Regeneration', cost: 30, growth: 1.19 },
  { key: 'crit', name: 'Critical Chance', cost: 50, growth: 1.23 },
  { key: 'multi', name: 'Multishot', cost: 300, growth: 3 },
  { key: 'cash', name: 'Cash / Kill', cost: 35, growth: 1.22 },
  { key: 'range', name: 'Range', cost: 40, growth: 1.2 }
];
const MAX_MESSAGE_BYTES = 16 * 1024;
const DISCONNECT_GRACE_MS = 60_000;
const IDLE_ROOM_MS = 15 * 60_000;
const TICK_MS = 50;
const SNAPSHOT_MS = 200;
const clamp = (v, a, b) => Math.max(a, Math.min(b, Number.isFinite(+v) ? +v : a));
const round = (v, p = 1) => Math.round(v * p) / p;
function newCode() {
  let v;
  do { v = Array.from(crypto.randomBytes(6), n => ALPHABET[n % ALPHABET.length]).join(''); }
  while (rooms.has(v));
  return v;
}
function send(ws, msg) { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); }
function broadcast(room, msg) { for (const p of room.players) if (p) send(p.ws, msg); }
function peers(room) { return room.players.map((p, slot) => p ? ({ slot, connected: !!p.ws, ready: !!p.ready, name: p.name }) : null); }
function status(room) { broadcast(room, { type: 'room_state', roomCode: room.code, players: peers(room), started: room.started, ended: room.ended }); }
function error(ws, message) { send(ws, { type: 'error', message }); }
function sanitizeStats(data) {
  const v = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  const d = (key, fallback, low, high) => v[key] == null || v[key] === '' ? fallback : clamp(v[key], low, high);
  return {
    damage: d('damage', 15, 1, 10000),
    hp: d('hp', 100, 1, 100000),
    attackSpeed: d('attackSpeed', 1.1, .1, 50),
    range: d('range', 110, 20, 2000),
    critChance: d('critChance', .05, 0, .95),
    critDamage: d('critDamage', 2, 1.2, 20),
    coinBonus: d('coinBonus', 1, 1, 20),
    xpBonus: d('xpBonus', 1, 1, 20)
  };
}
function roomCreate() {
  const room = { code: newCode(), players: [null, null], started: false, ended: false,
    game: null, lastActive: Date.now(), bothGoneAt: null, lastSnapshot: 0 };
  rooms.set(room.code, room);
  return room;
}
function attach(ws, room, slot) {
  const p = room.players[slot];
  if (p.ws && p.ws !== ws) p.ws.close(4001, 'Reconnected elsewhere');
  p.ws = ws;
  ws.room = room; ws.slot = slot;
  room.bothGoneAt = null;
  room.lastActive = Date.now();
  send(ws, { type: 'joined', roomCode: room.code, slot, reconnectToken: p.token });
  status(room);
  if (room.game) send(ws, { type: room.ended ? 'game_over' : 'game_state',
    ...(room.ended ? room.game.result : snapshot(room.game)) });
}
function createPlayer(ws, data) {
  return { ws: null, token: crypto.randomBytes(24).toString('hex'), ready: false,
    name: String(data.name || 'Player').slice(0, 24),
    stats: sanitizeStats(data.stats), maxSpeed: Math.round(clamp(data.maxSpeed ?? 1, 1, 5)) };
}
function startGame(room, map, diff) {
  const players = room.players;
  const average = {};
  for (const k of Object.keys(players[0].stats)) average[k] = (players[0].stats[k] + players[1].stats[k]) / 2;
  const game = {
    map: Math.round(clamp(map ?? 1, 1, 10)), diff: Math.round(clamp(diff ?? 0, 0, 4)),
    wave: 1, waveTime: 0, elapsed: 0, spawned: 0, kills: 0,
    hp: average.hp, maxhp: average.hp, gold: 0, diamonds: 0, xp: 0,
    speed: 1, stats: average, nextId: 1, enemies: [], bullets: [],
    players: players.map((p, slot) => ({ slot, cash: 80, up: Array(8).fill(0), shot: 0, damage: 0, kills: 0 })),
    lastTime: Date.now(), result: null
  };
  room.started = true; room.ended = false; room.game = game;
  broadcast(room, { type: 'game_started', roomCode: room.code, startedAt: Date.now(), map: game.map, diff: game.diff });
  broadcast(room, { type: 'game_state', ...snapshot(game) });
  status(room);
}
function towerStats(g, p) {
  return {
    dmg: (g.stats.damage + p.up[0] * 5),
    speed: g.stats.attackSpeed + p.up[1] * .16,
    range: g.stats.range * (1 + p.up[7] * .08),
    crit: Math.min(.95, g.stats.critChance + p.up[4] * .025),
    critDamage: g.stats.critDamage,
    multi: 1 + Math.min(5, p.up[5]),
    regen: p.up[3] * .6
  };
}
function spawn(g) {
  const boss = g.wave % 10 === 0 && g.spawned === 0;
  const rand = Math.random();
  const type = boss ? 4 : rand < .1 ? 3 : rand < .28 ? 2 : rand < .52 ? 1 : 0;
  const angle = Math.random() * Math.PI * 2, dist = 310 + Math.random() * 20;
  const hp = (17 + Math.pow(g.wave, 1.42) * 1.8) * Math.pow(1.22, g.map - 1) * Math.pow(2.3, g.diff) * TYPES[type].hp;
  g.enemies.push({ id: g.nextId++, x: Math.cos(angle) * dist, y: Math.sin(angle) * dist,
    hp, max: hp, type, shot: 0, spd: (15 + g.wave * .08) * TYPES[type].speed,
    atk: (3 + g.wave * .16) * Math.pow(1.15, g.map - 1) * Math.pow(1.8, g.diff) });
  g.spawned++;
}
function killEnemy(g, enemy, killerSlot) {
  const idx = g.enemies.indexOf(enemy);
  if (idx < 0) return;
  g.enemies.splice(idx, 1);
  g.kills++;
  g.players[killerSlot].kills++;
  const mult = Math.pow(1.42, g.map - 1) * [1, 3, 9, 27, 81][g.diff];
  const earn = Math.max(1, Math.floor((2 + g.wave * .2) * mult));
  // Full income for both players, not a split. Personal cash upgrades apply individually.
  for (const p of g.players) p.cash += earn * (1 + p.up[6] * .12);
  g.gold += earn;
  g.xp += (2 + g.wave * .15) * Math.pow(1.65, g.map - 1) * Math.pow(3, g.diff) * (enemy.type === 4 ? 30 : 1);
  if (Math.random() < .001 * (enemy.type === 4 ? 20 : 1)) g.diamonds++;
}
function tick(g, dt) {
  dt = Math.min(.15, dt) * g.speed;
  g.elapsed += dt; g.waveTime += dt;
  const targetCount = Math.min(8 + Math.floor(g.wave * .7), 65);
  const spawnInterval = Math.max(.12, .65 - g.wave * .003);
  if (g.spawned < targetCount && g.waveTime > g.spawned * spawnInterval) spawn(g);
  for (const p of g.players) {
    const st = towerStats(g, p), ox = p.slot === 0 ? -25 : 25;
    g.hp = Math.min(g.maxhp, g.hp + st.regen * dt);
    p.shot += dt;
    if (p.shot < 1 / st.speed) continue;
    p.shot = 0;
    const targets = g.enemies.filter(e => e.hp > 0 && Math.hypot(e.x - ox, e.y) < st.range)
      .sort((a, b) => Math.hypot(a.x - ox, a.y) - Math.hypot(b.x - ox, b.y));
    for (const enemy of targets.slice(0, st.multi)) {
      const damage = st.dmg * (Math.random() < st.crit ? st.critDamage : 1);
      enemy.hp -= damage; p.damage += damage;
      g.bullets.push({ x: ox, y: 0, tx: enemy.x, ty: enemy.y, slot: p.slot, life: .22 });
      if (enemy.hp <= 0) killEnemy(g, enemy, p.slot);
    }
  }
  for (const enemy of g.enemies) {
    const dist = Math.hypot(enemy.x, enemy.y) || 1;
    const stop = enemy.type === 3 ? 60 : 17;
    if (dist > stop) {
      enemy.x -= enemy.x / dist * enemy.spd * dt;
      enemy.y -= enemy.y / dist * enemy.spd * dt;
    } else {
      enemy.shot += dt;
      if (enemy.shot >= (enemy.type === 3 ? 1.6 : 1)) {
        enemy.shot = 0;
        g.hp -= enemy.atk;
      }
    }
  }
  g.bullets = g.bullets.filter(b => (b.life -= dt) > 0).slice(-40);
  if (g.hp <= 0) return 'core_destroyed';
  if (g.spawned >= targetCount && !g.enemies.length) {
    g.wave++; g.waveTime = 0; g.spawned = 0;
    for (const p of g.players) p.cash += 5 + g.wave * .4;
    g.xp += 20 + g.wave * 2;
    if (g.wave % 10 === 0) g.diamonds++;
    if (g.wave >= 5000) return 'max_wave';
  }
  return null;
}
function snapshot(g) {
  return {
    map: g.map, diff: g.diff, wave: g.wave, elapsed: round(g.elapsed, 10),
    hp: round(g.hp, 10), maxhp: round(g.maxhp, 10), kills: g.kills,
    gold: round(g.gold, 10), diamonds: g.diamonds, xp: round(g.xp, 10), speed: g.speed,
    players: g.players.map(p => ({ slot: p.slot, cash: round(p.cash, 10), up: p.up,
      damage: round(p.damage, 10), kills: p.kills,
      range: round(towerStats(g, p).range, 10), dmg: round(towerStats(g, p).dmg, 10) })),
    enemies: g.enemies.slice(0, 70).map(e => ({ id: e.id, x: round(e.x, 10), y: round(e.y, 10),
      hp: round(e.hp, 10), max: round(e.max, 10), type: e.type })),
    bullets: g.bullets.slice(-25).map(b => ({ x: b.x, y: b.y, tx: round(b.tx, 10), ty: round(b.ty, 10), slot: b.slot }))
  };
}
function finish(room, reason) {
  if (!room.game || room.ended) return;
  const g = room.game;
  room.ended = true;
  const coinReward = Math.floor((g.gold + g.wave * 3) * Math.pow(1.4, g.map - 1) * [1, 3, 9, 27, 81][g.diff] * g.stats.coinBonus);
  const result = { roomCode: room.code, reason, map: g.map, diff: g.diff, wave: g.wave,
    coins: coinReward, diamonds: g.diamonds, xp: Math.floor(g.xp * g.stats.xpBonus),
    kills: g.kills, resultId: crypto.randomBytes(12).toString('hex') };
  g.result = result;
  broadcast(room, { type: 'game_over', ...result });
  status(room);
}
function upgrade(room, slot, index) {
  const g = room.game, p = g.players[slot], up = UPGRADES[index];
  if (!up) return false;
  const level = p.up[index];
  if (level >= (index === 5 ? 5 : 1000)) return false;
  const cost = Math.ceil(up.cost * Math.pow(up.growth, level));
  if (!Number.isFinite(cost) || p.cash < cost) return false;
  p.cash -= cost; p.up[index]++;
  if (index === 2) { const gain = g.maxhp * .12; g.maxhp += gain; g.hp += gain; }
  return true;
}
function onMessage(ws, msg) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return error(ws, 'Invalid message');
  const type = msg.type;
  if (type === 'ping') return send(ws, { type: 'pong', time: Date.now() });
  if (type === 'create_room') {
    if (ws.room) return error(ws, 'Already in a room');
    const room = roomCreate();
    room.players[0] = createPlayer(ws, msg);
    return attach(ws, room, 0);
  }
  if (type === 'join_room') {
    if (ws.room) return error(ws, 'Already in a room');
    const room = rooms.get(String(msg.roomCode || '').trim().toUpperCase());
    if (!room) return error(ws, 'Room not found');
    if (room.started) return error(ws, 'Room already started');
    if (room.players[1]) return error(ws, 'Room full');
    room.players[1] = createPlayer(ws, msg);
    return attach(ws, room, 1);
  }
  if (type === 'reconnect') {
    if (ws.room) return error(ws, 'Already in a room');
    const room = rooms.get(String(msg.roomCode || '').trim().toUpperCase());
    if (!room) return error(ws, 'Room not found');
    const slot = room.players.findIndex(p => p && p.token === String(msg.reconnectToken || ''));
    if (slot < 0) return error(ws, 'Invalid reconnect token');
    return attach(ws, room, slot);
  }
  const room = ws.room;
  if (!room || room.players[ws.slot]?.ws !== ws) return error(ws, 'Join a room first');
  room.lastActive = Date.now();
  if (type === 'ready') {
    if (room.started) return error(ws, 'Already started');
    room.players[ws.slot].ready = !!msg.ready;
    if (msg.stats) room.players[ws.slot].stats = sanitizeStats(msg.stats);
    return status(room);
  }
  if (type === 'start') {
    if (ws.slot !== 0) return error(ws, 'Only host can start');
    if (room.started) return error(ws, 'Already started');
    if (!room.players.every(p => p?.ws && p.ready)) return error(ws, 'Both players must be connected and ready');
    startGame(room, msg.map, msg.diff);
    return;
  }
  if (type === 'upgrade') {
    if (!room.started || room.ended) return error(ws, 'No active game');
    const index = Number(msg.index);
    if (!Number.isInteger(index) || index < 0 || index >= UPGRADES.length) return error(ws, 'Invalid upgrade');
    if (!upgrade(room, ws.slot, index)) return error(ws, 'Not enough cash or max level');
    broadcast(room, { type: 'game_state', ...snapshot(room.game) });
    return;
  }
  if (type === 'set_speed') {
    if (ws.slot !== 0) return error(ws, 'Only host can set speed');
    if (!room.started || room.ended) return error(ws, 'No active game');
    const maxSpeed = Math.min(...room.players.map(p => p.maxSpeed));
    const speed = Number(msg.speed);
    if (!Number.isInteger(speed) || speed < 1 || speed > maxSpeed) return error(ws, 'Speed not unlocked for both players');
    room.game.speed = speed;
    return broadcast(room, { type: 'game_state', ...snapshot(room.game) });
  }
  if (type === 'end_run') {
    if (!room.started || room.ended) return error(ws, 'No active game');
    if (ws.slot !== 0) return error(ws, 'Only host can end the run');
    return finish(room, 'ended_by_host');
  }
  error(ws, 'Unknown message type');
}
const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.url === '/' || req.url === '/health') {
    res.writeHead(200);
    res.end(JSON.stringify({ ok: true, service: 'infinite-tower-coop', version: '0.2.0', rooms: rooms.size }));
  } else { res.writeHead(404); res.end(JSON.stringify({ error: 'Not found' })); }
});
const wss = new WebSocket.Server({ server, maxPayload: MAX_MESSAGE_BYTES });
wss.on('connection', ws => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); }
    catch { return error(ws, 'Invalid JSON'); }
    try { onMessage(ws, msg); }
    catch (err) { console.error('Message failed', err); error(ws, 'Server error'); }
  });
  ws.on('close', () => {
    const room = ws.room;
    if (!room || room.players[ws.slot]?.ws !== ws) return;
    room.players[ws.slot].ws = null;
    room.lastActive = Date.now();
    if (room.players.every(p => !p?.ws)) room.bothGoneAt = Date.now();
    status(room);
  });
});
setInterval(() => {
  const now = Date.now();
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false; ws.ping();
  }
  for (const [code, room] of rooms) {
    if (room.bothGoneAt && room.started && !room.ended && now - room.bothGoneAt >= DISCONNECT_GRACE_MS) finish(room, 'both_disconnected');
    if (room.bothGoneAt && now - room.bothGoneAt >= IDLE_ROOM_MS) rooms.delete(code);
  }
}, 30_000).unref();
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (!room.started || room.ended) continue;
    const g = room.game;
    const dt = Math.min(.15, (now - g.lastTime) / 1000);
    g.lastTime = now;
    const reason = tick(g, dt);
    if (reason) { finish(room, reason); continue; }
    if (now - room.lastSnapshot >= SNAPSHOT_MS) {
      room.lastSnapshot = now;
      broadcast(room, { type: 'game_state', ...snapshot(g) });
    }
  }
}, TICK_MS).unref();
if (require.main === module) server.listen(PORT, '0.0.0.0', () => console.log(`Infinite Tower CO-OP v0.2 listening on ${PORT}`));
module.exports = { server, rooms, onMessage, tick, startGame, snapshot, upgrade, finish, sanitizeStats };
