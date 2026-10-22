'use strict';
const http = require('node:http');
const crypto = require('node:crypto');
const WebSocket = require('ws');

const PORT = Number(process.env.PORT || 3000);
const rooms = new Map();
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const DISCONNECT_GRACE_MS = 60_000;
const ROOM_IDLE_MS = 15 * 60_000;
const MAX_MESSAGE_BYTES = 16 * 1024;

function code() {
  let value;
  do {
    const b = crypto.randomBytes(6);
    value = Array.from(b, x => ROOM_ALPHABET[x % ROOM_ALPHABET.length]).join('');
  } while (rooms.has(value));
  return value;
}
function send(ws, data) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}
function peers(room) {
  return room.players.map((p, slot) => p ? { slot, connected: !!p.ws, ready: !!p.ready } : null);
}
function broadcast(room, data) {
  for (const p of room.players) if (p) send(p.ws, data);
}
function status(room) {
  broadcast(room, { type: 'room_state', roomCode: room.code, players: peers(room), started: room.started });
}
function makeRoom() {
  const room = { code: code(), players: [null, null], started: false, lastActive: Date.now(), bothGoneAt: null };
  rooms.set(room.code, room);
  return room;
}
function attach(ws, room, slot, token) {
  const p = room.players[slot];
  if (p.ws && p.ws !== ws) p.ws.close(4001, 'Replaced by reconnect');
  p.ws = ws;
  p.ready = !!p.ready;
  ws.room = room;
  ws.slot = slot;
  ws.token = token;
  room.lastActive = Date.now();
  room.bothGoneAt = null;
  send(ws, { type: 'joined', roomCode: room.code, slot, reconnectToken: token });
  status(room);
}
function error(ws, message) { send(ws, { type: 'error', message }); }
function onMessage(ws, data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return error(ws, 'Invalid message');
  const type = data.type;
  if (type === 'ping') return send(ws, { type: 'pong', time: Date.now() });
  if (type === 'create_room') {
    if (ws.room) return error(ws, 'Already in a room');
    const room = makeRoom();
    const token = crypto.randomBytes(24).toString('hex');
    room.players[0] = { token, ws: null, ready: false };
    return attach(ws, room, 0, token);
  }
  if (type === 'join_room') {
    if (ws.room) return error(ws, 'Already in a room');
    const room = rooms.get(String(data.roomCode || '').trim().toUpperCase());
    if (!room) return error(ws, 'Room not found');
    if (room.started) return error(ws, 'Room already started');
    if (room.players[1]) return error(ws, 'Room full');
    const token = crypto.randomBytes(24).toString('hex');
    room.players[1] = { token, ws: null, ready: false };
    return attach(ws, room, 1, token);
  }
  if (type === 'reconnect') {
    if (ws.room) return error(ws, 'Already in a room');
    const room = rooms.get(String(data.roomCode || '').trim().toUpperCase());
    if (!room) return error(ws, 'Room not found');
    const token = String(data.reconnectToken || '');
    const slot = room.players.findIndex(p => p && p.token === token);
    if (slot < 0) return error(ws, 'Invalid reconnect token');
    return attach(ws, room, slot, token);
  }
  const room = ws.room;
  if (!room || !room.players[ws.slot] || room.players[ws.slot].ws !== ws) return error(ws, 'Join a room first');
  room.lastActive = Date.now();
  if (type === 'ready') {
    if (room.started) return error(ws, 'Already started');
    room.players[ws.slot].ready = !!data.ready;
    return status(room);
  }
  if (type === 'start') {
    if (ws.slot !== 0) return error(ws, 'Only host can start');
    if (room.started) return error(ws, 'Already started');
    if (!room.players.every(p => p && p.ws && p.ready)) return error(ws, 'Both players must be connected and ready');
    room.started = true;
    broadcast(room, { type: 'game_started', roomCode: room.code, startedAt: Date.now() });
    return status(room);
  }
  if (type === 'game_event') {
    if (!room.started) return error(ws, 'Game not started');
    // Prototype transport only. A future authoritative game engine must validate events.
    const event = data.event;
    if (!event || typeof event !== 'object' || Array.isArray(event)) return error(ws, 'Invalid event');
    for (const p of room.players) if (p && p.ws !== ws) send(p.ws, { type: 'game_event', fromSlot: ws.slot, event });
    return;
  }
  error(ws, 'Unknown message type');
}

const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.url === '/' || req.url === '/health') {
    res.writeHead(200);
    res.end(JSON.stringify({ ok: true, service: 'infinite-tower-coop', rooms: rooms.size }));
  } else {
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
  }
});
const wss = new WebSocket.Server({ server, maxPayload: MAX_MESSAGE_BYTES });
wss.on('connection', ws => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', raw => {
    let data;
    try { data = JSON.parse(raw.toString()); }
    catch { return error(ws, 'Invalid JSON'); }
    try { onMessage(ws, data); }
    catch (err) { console.error(err); error(ws, 'Server error'); }
  });
  ws.on('close', () => {
    const room = ws.room;
    if (!room) return;
    const p = room.players[ws.slot];
    if (!p || p.ws !== ws) return;
    p.ws = null;
    room.lastActive = Date.now();
    if (room.players.every(p => !p || !p.ws)) room.bothGoneAt = Date.now();
    status(room);
  });
});
setInterval(() => {
  const now = Date.now();
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
  for (const [roomCode, room] of rooms) {
    if (room.bothGoneAt && room.started && now - room.bothGoneAt >= DISCONNECT_GRACE_MS) {
      // This is a prototype: report a loss; future versions must persist results.
      broadcast(room, { type: 'game_over', reason: 'both_disconnected' });
      rooms.delete(roomCode);
    } else if (room.bothGoneAt && now - room.bothGoneAt >= ROOM_IDLE_MS) {
      rooms.delete(roomCode);
    }
  }
}, 30_000).unref();
server.listen(PORT, '0.0.0.0', () => console.log(`Infinite Tower CO-OP listening on ${PORT}`));
