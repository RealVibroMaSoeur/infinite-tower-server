'use strict';
// Infinite Tower CO-OP v0.4.0 — authoritative 2-player combat, no paid services.
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
const UPGRADES = [{"name":"Damage","cost":20,"growth":1.16,"cat":"Offense","max":1000},{"name":"Attack Speed","cost":25,"growth":1.18,"cat":"Offense","max":1000},{"name":"Max HP","cost":20,"growth":1.17,"cat":"Defense","max":1000},{"name":"Regeneration","cost":30,"growth":1.19,"cat":"Defense","max":1000},{"name":"Critical Chance","cost":50,"growth":1.23,"cat":"Offense","max":1000},{"name":"Multishot","cost":300,"growth":3.0,"cat":"Offense","max":4},{"name":"Cash / Kill","cost":35,"growth":1.22,"cat":"Economy","max":1000},{"name":"Range","cost":40,"growth":1.2,"cat":"Offense","max":1000},{"name":"Critical Damage","cost":65,"growth":1.2,"cat":"Offense","max":1000},{"name":"Rapid Fire","cost":100,"growth":1.23,"cat":"Offense","max":1000},{"name":"Bounce Shot","cost":400,"growth":1.35,"cat":"Offense","max":5},{"name":"Armor Penetration","cost":650,"growth":1.32,"cat":"Offense","max":5},{"name":"Defense %","cost":55,"growth":1.22,"cat":"Defense","max":1000},{"name":"Absolute Defense","cost":35,"growth":1.18,"cat":"Defense","max":1000},{"name":"Thorns","cost":130,"growth":1.28,"cat":"Defense","max":1},{"name":"Lifesteal","cost":450,"growth":1.32,"cat":"Offense","max":1},{"name":"Energy Shield","cost":900,"growth":1.5,"cat":"Defense","max":1},{"name":"Cash / Wave","cost":70,"growth":1.19,"cat":"Economy","max":1000},{"name":"Coin / Kill","cost":80,"growth":1.22,"cat":"Economy","max":1000},{"name":"Coin / Wave","cost":85,"growth":1.2,"cat":"Economy","max":1000},{"name":"Interest","cost":120,"growth":1.3,"cat":"Economy","max":2},{"name":"XP / Kill","cost":110,"growth":1.25,"cat":"Economy","max":1000},{"name":"Knockback","cost":180,"growth":1.25,"cat":"Defense","max":1000},{"name":"Target Priority","cost":250,"growth":1.35,"cat":"Offense","max":5},{"name":"Burst Chance","cost":300,"growth":1.25,"cat":"Offense","max":1000},{"name":"Burst Count","cost":1200,"growth":1.8,"cat":"Offense","max":4},{"name":"Retired Burst Damage","cost":450,"growth":1.3,"cat":"Retired","max":1000},{"name":"XP / Wave","cost":130,"growth":1.24,"cat":"Economy","max":1000},{"name":"Startup Cash","cost":85,"growth":1.2,"cat":"Economy","max":1000},{"name":"Offense Free Upgrade","cost":250,"growth":1.3,"cat":"Utility","max":1000},{"name":"Defense Free Upgrade","cost":250,"growth":1.3,"cat":"Utility","max":1000},{"name":"Utility Free Upgrade","cost":250,"growth":1.3,"cat":"Utility","max":1000},{"name":"Economy Free Upgrade","cost":250,"growth":1.3,"cat":"Utility","max":1000}];
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
function peers(room) { return room.players.map((p, slot) => p ? ({ slot, connected: !!p.ws, ready: !!p.ready, forfeited:!!p.forfeited, name: p.name, maxMap: p.maxMap, maxDiff: p.maxDiff, voteMap: p.voteMap, voteDiff: p.voteDiff, maxSpeed:p.maxSpeed }) : null); }
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
  if (p.forfeited) return error(ws, 'You voluntarily quit this run; reconnect disabled');
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
    maxMap: Math.round(clamp(data.unlocked?.maxMap ?? 1, 1, 10)),
    maxDiff: Math.round(clamp(data.unlocked?.maxDiff ?? 0, 0, 4)),
    initialUpgrades:Array.isArray(data.initialUpgrades)?data.initialUpgrades.slice(0,UPGRADES.length).map((n,i)=>Math.round(clamp(n,0,UPGRADES[i].max))):Array(UPGRADES.length).fill(0),
    startingCash:clamp(data.startingCash??80,80,1e7),
    unlockByMap:(data.unlocked?.byMap&&typeof data.unlocked.byMap==='object'&&!Array.isArray(data.unlocked.byMap))?data.unlocked.byMap:null,
    forfeited:false, allowedUpgrades:Array.isArray(data.unlocked?.allowedUpgrades)?data.unlocked.allowedUpgrades.filter(i=>Number.isInteger(i)&&i>=0&&i<UPGRADES.length):null,
    voteMap: 1, voteDiff: 0,
    stats: sanitizeStats(data.stats), maxSpeed: Math.round(clamp(data.maxSpeed ?? 1, 1, 10)) };
}
function startGame(room, map, diff) {
  const players = room.players;
  const average = {};
  for (const k of Object.keys(players[0].stats)) average[k] = (players[0].stats[k] + players[1].stats[k]) / 2;
  const initialHp = average.hp * (1 + ((players[0].initialUpgrades[2]||0)+(players[1].initialUpgrades[2]||0))*.12/2);
  const game = {
    map: Math.round(clamp(map ?? 1, 1, 10)), diff: Math.round(clamp(diff ?? 0, 0, 4)),
    wave: 1, waveTime: 0, elapsed: 0, spawned: 0, kills: 0,
    hp: initialHp, maxhp: initialHp, shields:0, gold: 0, diamonds: 0, xp: 0,
    speed: 1, stats: average, nextId: 1, enemies: [], bullets: [],
    players: players.map((p, slot) => ({ slot, cash: p.startingCash, up: [...p.initialUpgrades], shot: 0, damage: 0, kills: 0, shield:0, freeTick:[0,0,0,0] })),
    lastTime: Date.now(), result: null
  };
  game.shields = Math.floor((game.players[0].up[16]+game.players[1].up[16])/5);
  room.started = true; room.ended = false; room.game = game;
  broadcast(room, { type: 'game_started', roomCode: room.code, startedAt: Date.now(), map: game.map, diff: game.diff });
  broadcast(room, { type: 'game_state', ...snapshot(game) });
  status(room);
}
function towerStats(g, p) {
  // Indexed according to the SAME UPS table as the solo game.
  return {
    dmg:g.stats.damage + p.up[0]*5,
    speed:g.stats.attackSpeed+p.up[1]*.16+p.up[9]*.07,
    range:g.stats.range*(1+p.up[7]*.08),
    crit:Math.min(.95,g.stats.critChance+p.up[4]*.025),
    critDamage:g.stats.critDamage+p.up[8]*.15,
    multi:1+Math.min(5,p.up[5]),
    regen:p.up[3]*.6,
    defense:Math.min(.75,p.up[12]*.018),
    absolute:p.up[13]*.35,
    thorns:p.up[14]*.025,
    lifesteal:p.up[15]*.007,
    knockback:p.up[22]*.3,
    burstChance:Math.min(.75,p.up[24]*.02),
    burstCount:Math.min(6,2+p.up[25])
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
  g.gold += earn * (1 + (g.players[0].up[18]+g.players[1].up[18])*.06/2);
  g.xp += (2 + g.wave * .15) * Math.pow(1.65, g.map - 1) * Math.pow(3, g.diff) * (enemy.type === 4 ? 30 : 1) * (1+(g.players[0].up[21]+g.players[1].up[21])*.04/2);
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
      .sort((a, b) => p.up[23]>0 && a.type!==b.type && (a.type===4||b.type===4) ? (b.type===4?1:-1) : Math.hypot(a.x-ox,a.y)-Math.hypot(b.x-ox,b.y));
    for (const enemy of targets.slice(0, st.multi)) {
      const damage = st.dmg * (Math.random() < st.crit ? st.critDamage : 1) * (1+p.up[11]*.03);
      enemy.hp -= damage; p.damage += damage;
      g.hp=Math.min(g.maxhp,g.hp+damage*st.lifesteal);
      if(st.knockback && Math.random()<Math.min(.6,p.up[22]*.04)){const d=Math.hypot(enemy.x,enemy.y)||1;enemy.x+=enemy.x/d*st.knockback;enemy.y+=enemy.y/d*st.knockback;}
      if(Math.random()<st.burstChance){enemy.hp-=damage*Math.max(0,st.burstCount-1)*.35;p.damage+=damage*Math.max(0,st.burstCount-1)*.35;}
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
        const averageDef=(towerStats(g,g.players[0]).defense+towerStats(g,g.players[1]).defense)/2;
        const averageAbs=(towerStats(g,g.players[0]).absolute+towerStats(g,g.players[1]).absolute)/2;
        let damage=Math.max(0,enemy.atk*(1-averageDef)-averageAbs);
        if(g.shields>0 && damage>0){g.shields--;damage=0;}
        g.hp-=damage;
        const thorn=(towerStats(g,g.players[0]).thorns+towerStats(g,g.players[1]).thorns)/2;
        if(thorn>0){enemy.hp-=enemy.max*thorn;if(enemy.hp<=0)killEnemy(g,enemy,0);}
      }
    }
  }
  g.bullets = g.bullets.filter(b => (b.life -= dt) > 0).slice(-40);
  if (g.hp <= 0) return 'core_destroyed';
  if (g.spawned >= targetCount && !g.enemies.length) {
    g.wave++; g.waveTime = 0; g.spawned = 0;
    for(const p of g.players){
      p.cash+=5+g.wave*.4+p.up[17]*.09*(5+g.wave*.4)+p.up[20]*Math.min(1000,p.cash)*.01;
      // Free-upgrade utility: one roll in each category each wave.
      for(const [idx,cat] of [[29,'Offense'],[30,'Defense'],[31,'Utility'],[32,'Economy']]){
        if(Math.random()<Math.min(.75,p.up[idx]*.01)){
          const options=UPGRADES.map((u,i)=>({u,i})).filter(x=>x.u.cat===cat&&x.i!==idx&&x.i!==26&&x.i!==28&&p.up[x.i]<x.u.max);
          if(options.length){const pick=options[Math.floor(Math.random()*options.length)];p.up[pick.i]++;if(pick.i===2){const gain=g.maxhp*.12;g.maxhp+=gain;g.hp+=gain;}}
        }
      }
    }
    g.gold+=2*(g.players[0].up[19]+g.players[1].up[19])/2;
    g.xp+=(20+g.wave*2)*(1+(g.players[0].up[27]+g.players[1].up[27])*.1/2);
    g.shields=Math.floor((g.players[0].up[16]+g.players[1].up[16])/5);
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
function upgrade(room, slot, index, batch=1) {
  const g=room.game,p=g.players[slot],def=UPGRADES[index],owner=room.players[slot];
  if(!def || def.cat==='Retired'||index===28 || (owner.allowedUpgrades && !owner.allowedUpgrades.includes(index)))return false;
  if(![1,10,100,'max'].includes(batch))batch=1;
  const times=batch==='max'?1000:batch;
  let bought=0;
  for(let n=0;n<times;n++){
    if(p.up[index]>=def.max)break;
    const cost=Math.ceil(def.cost*Math.pow(def.growth,p.up[index]));
    if(!Number.isFinite(cost)||p.cash<cost)break;
    p.cash-=cost;p.up[index]++;bought++;
    if(index===2){const gain=g.maxhp*.12;g.maxhp+=gain;g.hp+=gain;}
    if(index===16 && p.up[index]%5===0)g.shields++;
  }
  return bought>0;
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
    if (slot < 0 || room.players[slot]?.forfeited) return error(ws, 'Invalid reconnect token');
    return attach(ws, room, slot);
  }
  const room = ws.room;
  if (!room || room.players[ws.slot]?.ws !== ws) return error(ws, 'Join a room first');
  room.lastActive = Date.now();
  if (type === 'vote') {
    if (room.started) return error(ws, 'Already started');
    const p = room.players[ws.slot];
    const map = Number(msg.map), diff = Number(msg.diff);
    if (!Number.isInteger(map) || !Number.isInteger(diff) || map < 1 || map > p.maxMap || diff < 0 || diff > p.maxDiff || (p.unlockByMap && !Array.isArray(p.unlockByMap[map])) || (p.unlockByMap && !p.unlockByMap[map].includes(diff)))
      return error(ws, 'Stage or difficulty not unlocked');
    p.voteMap = map; p.voteDiff = diff;
    return status(room);
  }
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
    startGame(room, Math.max(...room.players.map(p => p.voteMap)), Math.max(...room.players.map(p => p.voteDiff)));
    return;
  }
  // Replay immediately: no lobby/READY interruption for either player.
  if (type === 'play_again') {
    if (!room.started || !room.ended || !room.game) return error(ws, 'Finish the current run first');
    const { map, diff } = room.game;
    startGame(room, map, diff);
    return;
  }
  // Difficulty change returns both players to the CO-OP lobby to vote again.
  if (type === 'return_to_lobby') {
    if (!room.started || !room.ended || !room.game) return error(ws, 'Finish the current run first');
    room.started = false; room.ended = false; room.game = null;
    for (const player of room.players) if (player) player.ready = false;
    broadcast(room, { type: 'back_to_lobby' });
    status(room);
    return;
  }
  // Backward compatibility with the previous test client.
  if (type === 'rematch') {
    if (!room.started || !room.ended) return error(ws, 'Finish the current run first');
    const p = room.players[ws.slot];
    if (msg.diff !== undefined) {
      const selected = Number(msg.diff);
      if (!Number.isInteger(selected) || selected < 0 || selected > p.maxDiff)
        return error(ws, 'Difficulty not unlocked');
      p.voteDiff = selected;
    }
    const map = room.game.map;
    const diff = room.game.diff;
    room.started = false; room.ended = false; room.game = null;
    for (const player of room.players) if (player) player.ready = false;
    broadcast(room, { type: 'back_to_lobby', map, diff });
    status(room);
    return;
  }
  if(type === 'quit_game') {
    // Voluntary surrender. The quitter's token is permanently revoked.
    const p=room.players[ws.slot];
    p.forfeited=true;p.token=crypto.randomBytes(24).toString('hex');p.ready=false;
    send(ws,{type:'voluntary_quit_confirmed'});
    const slot=ws.slot;
    p.ws=null;ws.room=null;ws.slot=null;
    status(room);
    // The teammate's run and both automatic towers continue normally.
    if(room.players.every(x=>!x?.ws))room.bothGoneAt=Date.now();
    else room.bothGoneAt=null;
    return;
  }
  if(type === 'leave_room') {
    if(room.started&&!room.ended){
      return error(ws,'During a run use quit_game with confirmation');
    }
    if(room.started&&room.ended){
      const p=room.players[ws.slot];p.forfeited=true;p.token=crypto.randomBytes(24).toString('hex');
      send(ws,{type:'voluntary_quit_confirmed'});p.ws=null;ws.room=null;ws.slot=null;
      status(room);return;
    }
    broadcast(room,{type:'room_closed',message:'Lobby closed'});
    for(const p of room.players)if(p?.ws){p.ws.room=null;p.ws.slot=null;}
    rooms.delete(room.code);return;
  }
  if (type === 'upgrade') {
    if (!room.started || room.ended) return error(ws, 'No active game');
    const index = Number(msg.index);
    if (!Number.isInteger(index) || index < 0 || index >= UPGRADES.length) return error(ws, 'Invalid upgrade');
    if (!upgrade(room, ws.slot, index, msg.batch)) return error(ws, 'Not enough cash or max level');
    broadcast(room, { type: 'game_state', ...snapshot(room.game) });
    return;
  }
  if (type === 'set_speed') {
    if (!room.started || room.ended) return error(ws, 'No active game');
    const maxSpeed = Math.min(...room.players.map(p => p.maxSpeed));
    const speed = Number(msg.speed);
    if (!Number.isInteger(speed) || speed < 1 || speed > maxSpeed) return error(ws, 'Speed not unlocked for both players');
    room.game.speed = speed;
    return broadcast(room, { type: 'game_state', ...snapshot(room.game) });
  }
  if (type === 'end_run') {
    if (!room.started || room.ended) return error(ws, 'No active game');
    // Surviving player may end the run if their partner forfeits.
    return finish(room, 'ended_by_host');
  }
  error(ws, 'Unknown message type');
}
const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.url === '/' || req.url === '/health') {
    res.writeHead(200);
    res.end(JSON.stringify({ ok: true, service: 'infinite-tower-coop', version: '0.4.0', rooms: rooms.size }));
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
if (require.main === module) server.listen(PORT, '0.0.0.0', () => console.log(`Infinite Tower CO-OP v0.4 listening on ${PORT}`));
module.exports = { server, rooms, onMessage, tick, startGame, snapshot, upgrade, finish, sanitizeStats };
