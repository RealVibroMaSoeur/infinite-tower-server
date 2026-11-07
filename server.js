'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require('ws');
const WebSocketServer = WebSocket.WebSocketServer || WebSocket.Server;
const Core = require('./InfiniteTowerCore');

const PORT = Number(process.env.PORT || 8080);
const DATA_DIR = process.env.DATA_DIR || (fs.existsSync('/var/data') ? '/var/data' : path.join(__dirname, 'data'));
const DATA_FILE = process.env.SOCIAL_DATA_FILE || path.join(DATA_DIR, 'social.json');
const ROOMS_FILE = process.env.ACTIVE_ROOMS_FILE || path.join(DATA_DIR, 'active_rooms.json');
const REWARDS_FILE = process.env.REWARDS_FILE || path.join(DATA_DIR, 'rewards.json');
const MAX_MESSAGE_BYTES = 16 * 1024;
const HEARTBEAT_MS = 25000;
const RECONNECT_GRACE_MS = Number(process.env.RECONNECT_GRACE_MS || 45000);
const ROOM_IDLE_MS = 30 * 60 * 1000;
const SNAPSHOT_MS = 100;
const TICK_MS = 50;
const MAX_PLAYERS = 4;

const UPS = Core.UPGRADES;
const TYPES = Core.TYPES;
const DIFF_MULT = Core.DIFF_MULT;
const cost = Core.cost;

function ensureDir(file) { fs.mkdirSync(path.dirname(file), { recursive: true }); }

function atomicWriteFileSync(filePath, content) {
  ensureDir(filePath);
  const dir = path.dirname(filePath);
  const tmpFile = path.join(dir, `.${path.basename(filePath)}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 7)}`);
  const bakFile = `${filePath}.bak`;
  const fd = fs.openSync(tmpFile, 'w');
  try {
    fs.writeFileSync(fd, content, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }

  try {
    if (fs.existsSync(filePath)) {
      try { fs.copyFileSync(filePath, bakFile); } catch (_) {}
    }
    fs.renameSync(tmpFile, filePath);
  } catch (err) {
    if (process.platform === 'win32') {
      try { fs.unlinkSync(filePath); } catch (_) {}
      fs.renameSync(tmpFile, filePath);
    } else {
      throw err;
    }
  }
}

function loadJSONSafe(filePath, fallback = {}) {
  try {
    ensureDir(filePath);
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf8').trim();
      if (data) return JSON.parse(data);
    }
  } catch (e) {
    try {
      const bakFile = `${filePath}.bak`;
      if (fs.existsSync(bakFile)) {
        const bakData = fs.readFileSync(bakFile, 'utf8').trim();
        if (bakData) return JSON.parse(bakData);
      }
    } catch (_) {}
  }
  return fallback;
}

// Registre et cache des clés publiques Firebase (Google X.509 et clés de test)
let cachedGoogleCerts = null;
let certCacheExpiresAt = 0;
const testPublicKeys = {};

function registerTestPublicKey(kid, publicKeyPem) {
  testPublicKeys[kid] = publicKeyPem;
}

async function fetchGooglePublicCerts() {
  const now = Date.now();
  if (cachedGoogleCerts && now < certCacheExpiresAt) {
    return cachedGoogleCerts;
  }
  try {
    const res = await fetch('https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com');
    if (!res.ok) throw new Error(`Google certs HTTP ${res.status}`);
    const data = await res.json();
    let maxAgeSec = 3600;
    const cc = res.headers.get('cache-control');
    if (cc) {
      const m = cc.match(/max-age=(\d+)/);
      if (m) maxAgeSec = parseInt(m[1], 10);
    }
    cachedGoogleCerts = data;
    certCacheExpiresAt = now + Math.max(60, maxAgeSec) * 1000;
    return cachedGoogleCerts;
  } catch (err) {
    if (cachedGoogleCerts) return cachedGoogleCerts;
    return {};
  }
}

// Vérification cryptographique rigoureuse des jetons Firebase Authentication (RS256)
async function verifyFirebaseAuthToken(idToken) {
  if (!idToken || typeof idToken !== 'string') return null;
  const trimmed = idToken.trim();

  // Mode test / mock réservé aux environnements hors production
  if (process.env.NODE_ENV !== 'production' && (trimmed.startsWith('mock-uid-') || trimmed.startsWith('test-token-'))) {
    const uid = trimmed.replace(/^(mock-uid-|test-token-)/, '');
    return { uid, email: `${uid}@test.infinitetower.com`, authTime: Date.now() };
  }

  try {
    const parts = trimmed.split('.');
    if (parts.length !== 3) return null;

    let header, payload;
    try {
      header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
      payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    } catch (_) {
      return null;
    }

    if (!header || header.alg !== 'RS256' || !header.kid) return null;

    const projectId = process.env.FIREBASE_PROJECT_ID || 'infinite-tower-d456f';
    const nowSec = Math.floor(Date.now() / 1000);

    // 1. Validation de l'émetteur
    if (payload.iss !== `https://securetoken.google.com/${projectId}`) return null;
    // 2. Validation de l'audience
    if (payload.aud !== projectId) return null;
    // 3. Validation de l'identité (sub/uid)
    if (!payload.sub || typeof payload.sub !== 'string' || payload.sub.trim().length === 0) return null;
    // 4. Validation de la date d'expiration
    if (!payload.exp || payload.exp <= nowSec) return null;
    // 5. Tolérance de skew horaire (5 minutes max)
    if (payload.iat && payload.iat > nowSec + 300) return null;
    if (payload.auth_time && payload.auth_time > nowSec + 300) return null;

    // 6. Récupération de la clé publique correspondante (test ou certificat officiel Google)
    let keyOrCert = testPublicKeys[header.kid];
    if (!keyOrCert) {
      const googleCerts = await fetchGooglePublicCerts();
      keyOrCert = googleCerts[header.kid];
    }
    if (!keyOrCert) return null;

    // 7. Vérification de la signature cryptographique RS256
    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(`${parts[0]}.${parts[1]}`);
    const signature = Buffer.from(parts[2], 'base64url');
    const isValid = verifier.verify(keyOrCert, signature);
    if (!isValid) return null;

    return {
      uid: String(payload.sub),
      email: payload.email || null,
      authTime: payload.auth_time || payload.iat || nowSec
    };
  } catch (err) {
    return null;
  }
}

function loadDB() {
  const parsed = loadJSONSafe(DATA_FILE, { accounts: {}, rewards: {} });
  if (parsed && typeof parsed.accounts === 'object') {
    if (!parsed.rewards || typeof parsed.rewards !== 'object') parsed.rewards = {};
    return parsed;
  }
  return { accounts: {}, rewards: {} };
}
const db = loadDB();
let saveTimer = null;
function saveDB(sync = false) {
  clearTimeout(saveTimer);
  const write = () => {
    try { atomicWriteFileSync(DATA_FILE, JSON.stringify(db, null, 2)); } catch (e) {}
    if (firestoreClient) syncSocialToFirestore(sync).catch(() => {});
  };
  if (sync) write();
  else saveTimer = setTimeout(write, 150);
}

function loadRewards() {
  const parsed = loadJSONSafe(REWARDS_FILE, {});
  return (parsed && typeof parsed === 'object') ? parsed : {};
}
const rewardsDb = loadRewards();
// Synchroniser au démarrage entre db.rewards et rewardsDb pour persistance maximale
for (const [rid, rec] of Object.entries(db.rewards || {})) {
  if (!rewardsDb[rid]) rewardsDb[rid] = rec;
}
for (const [rid, rec] of Object.entries(rewardsDb)) {
  if (!db.rewards[rid]) db.rewards[rid] = rec;
}

let rewardsSaveTimer = null;
function saveRewards(sync = false) {
  clearTimeout(rewardsSaveTimer);
  const write = () => {
    try { atomicWriteFileSync(REWARDS_FILE, JSON.stringify(rewardsDb, null, 2)); } catch (e) {}
  };
  if (sync) write();
  else rewardsSaveTimer = setTimeout(write, 100);
}

const socketsByPlayer = new Map();
const rooms = new Map();

// Intégration Firestore Cloud Externe & Transactions Atomiques
let firestoreClient = null;
function setFirestoreInstance(instance) {
  firestoreClient = instance;
  if (firestoreClient) loadSocialFromFirestore().catch(() => {});
}
let lastFirestoreSocialSync = 0;
async function syncSocialToFirestore(force = false) {
  if (!firestoreClient) return;
  const now = Date.now();
  if (!force && (now - lastFirestoreSocialSync < 5000)) return;
  lastFirestoreSocialSync = now;
  try {
    const docRef = firestoreClient.collection('coop_social').doc('accounts');
    await docRef.set({ accounts: db.accounts || {}, updatedAt: now }, { merge: true });
  } catch (_) {}
}

async function loadSocialFromFirestore() {
  if (!firestoreClient) return false;
  try {
    const docSnap = await firestoreClient.collection('coop_social').doc('accounts').get();
    if (docSnap && docSnap.exists) {
      const data = typeof docSnap.data === 'function' ? docSnap.data() : docSnap.data;
      if (data && typeof data.accounts === 'object') {
        db.accounts = { ...(db.accounts || {}), ...data.accounts };
        try { atomicWriteFileSync(DATA_FILE, JSON.stringify(db, null, 2)); } catch (_) {}
        return true;
      }
    }
  } catch (_) {}
  return false;
}

function getFirestoreInstance() {
  return firestoreClient;
}

/**
 * Transaction atomique Firestore garantissant l'attribution unique des récompenses CO-OP.
 * Vérifie l'état de la réclamation dans Firestore et met à jour le profil du joueur dans la même transaction.
 */
async function executeFirestoreRewardTransaction(firestore, uid, resultId, reward) {
  if (!firestore || !uid || !resultId || !reward) {
    throw new Error('Paramètres invalides pour la transaction Firestore');
  }

  const claimRef = firestore.collection('users').doc(uid).collection('coop_claims').doc(resultId);
  const saveDocRef = firestore.collection('users').doc(uid).collection('saves').doc('v56');

  return await firestore.runTransaction(async (transaction) => {
    const claimDoc = await transaction.get(claimRef);
    if (claimDoc.exists && claimDoc.data()?.claimed) {
      return {
        ok: true,
        alreadyClaimed: true,
        claimedAt: claimDoc.data().claimedAt,
        reward: claimDoc.data().reward || reward,
        message: 'Récompense déjà attribuée dans Firestore (Idempotent)'
      };
    }

    const saveDoc = await transaction.get(saveDocRef);
    let currentCoins = 0;
    let currentDiamonds = 0;
    let currentXp = 0;
    let saveDataObj = null;

    if (saveDoc.exists && saveDoc.data()?.data) {
      try {
        saveDataObj = typeof saveDoc.data().data === 'string' ? JSON.parse(saveDoc.data().data) : saveDoc.data().data;
        currentCoins = Number(saveDataObj.coins || saveDataObj.gold || 0);
        currentDiamonds = Number(saveDataObj.diamonds || 0);
        currentXp = Number(saveDataObj.xp || 0);
      } catch (_) {}
    }

    const creditedCoins = Number(reward.coins || 0);
    const creditedDiamonds = Number(reward.diamonds || 0);
    const creditedXp = Number(reward.xp || 0);

    const newCoins = currentCoins + creditedCoins;
    const newDiamonds = currentDiamonds + creditedDiamonds;
    const newXp = currentXp + creditedXp;

    if (saveDataObj) {
      saveDataObj.coins = newCoins;
      saveDataObj.gold = newCoins;
      saveDataObj.diamonds = newDiamonds;
      saveDataObj.xp = newXp;
      saveDataObj.updatedAt = Date.now();
      transaction.set(saveDocRef, {
        uid: uid,
        data: JSON.stringify(saveDataObj),
        updatedAt: Date.now(),
        format: 'json',
        version: '2.1.5',
        saveVersion: 'v56'
      }, { merge: true });
    }

    transaction.set(claimRef, {
      resultId: resultId,
      uid: uid,
      claimed: true,
      claimedAt: Date.now(),
      reward: {
        coins: creditedCoins,
        diamonds: creditedDiamonds,
        xp: creditedXp,
        wave: reward.wave || 0,
        kills: reward.kills || 0
      }
    });

    return {
      ok: true,
      alreadyClaimed: false,
      credited: { coins: creditedCoins, diamonds: creditedDiamonds, xp: creditedXp },
      newBalances: { coins: newCoins, diamonds: newDiamonds, xp: newXp },
      reward
    };
  });
}

let lastFirestoreRoomsSync = 0;
async function syncRoomsToFirestore(activeRooms, force = false) {
  if (!firestoreClient) return;
  const now = Date.now();
  // Quota optimization Spark plan : au plus une écriture toutes les 5 secondes sauf force
  if (!force && (now - lastFirestoreRoomsSync < 5000)) return;
  lastFirestoreRoomsSync = now;
  try {
    const batch = firestoreClient.batch();
    for (const [code, r] of Object.entries(activeRooms)) {
      const ref = firestoreClient.collection('coop_active_rooms').doc(code);
      batch.set(ref, { ...r, syncedAt: now }, { merge: true });
    }
    await batch.commit();
  } catch (_) {}
}

async function loadRoomsFromFirestore() {
  if (!firestoreClient) return null;
  try {
    const snap = await firestoreClient.collection('coop_active_rooms').get();
    if (snap.empty) return null;
    const out = {};
    snap.forEach(doc => {
      out[doc.id] = doc.data();
    });
    return out;
  } catch (_) {
    return null;
  }
}

function reconstructRoom(r, now = Date.now()) {
  if (!r || r.ended || (now - (r.lastActive || 0) > ROOM_IDLE_MS)) return null;
  const room = {
    code: r.code,
    map: r.map,
    diff: r.diff,
    speed: r.speed || 1,
    started: r.started,
    ended: false,
    createdAt: r.createdAt || now,
    lastActive: now,
    resultIds: r.resultIds || {},
    players: (r.players || []).map((p, idx) => {
      if (!p) return null;
      const pl = {
        ...p,
        slot: p.slot !== undefined ? p.slot : idx,
        ws: null,
        connected: false,
        disconnectTimer: null
      };
      if (r.started && !pl.forfeited) {
        const discTime = Number(pl.disconnectedAt) || Number(r.lastActive) || now;
        const elapsed = now - discTime;
        const totalGrace = RECONNECT_GRACE_MS + RENDER_DEPLOY_BUFFER_MS;
        const remainingGrace = totalGrace - elapsed;
        if (remainingGrace <= 0) {
          pl.forfeited = true;
          pl.hp = 0;
          pl.shields = 0;
        } else {
          pl.disconnectTimer = setTimeout(() => {
            pl.disconnectTimer = null;
            if (!pl.connected && !room.ended) {
              pl.forfeited = true;
              pl.hp = 0;
              pl.shields = 0;
              if (room.game) {
                room.game.hp = room.players.filter(Boolean).reduce((sum, x) => sum + Math.max(0, x.hp), 0);
                room.game.shields = room.players.filter(Boolean).reduce((sum, x) => sum + (x.shields || 0), 0);
              }
              const stillPlaying = room.players.filter(x => x && !x.forfeited && x.connected);
              if (stillPlaying.length === 0) {
                finish(room, 'disconnect_timeout');
                rooms.delete(room.code);
                saveRooms(true);
              }
            }
          }, remainingGrace);
          if (pl.disconnectTimer && typeof pl.disconnectTimer.unref === 'function') pl.disconnectTimer.unref();
        }
      }
      return pl;
    })
  };

  if (r.game && room.started) {
    room.game = {
      ...r.game,
      room,
      players: room.players.filter(Boolean)
    };
  }
  rooms.set(r.code, room);
  return room;
}

async function restoreRoomsFromFirestore() {
  if (!firestoreClient) return 0;
  try {
    const fromFs = await loadRoomsFromFirestore();
    if (!fromFs || Object.keys(fromFs).length === 0) return 0;
    const now = Date.now();
    let count = 0;
    for (const [code, r] of Object.entries(fromFs)) {
      if (!rooms.has(code) && r && !r.ended) {
        if (reconstructRoom(r, now)) count++;
      }
    }
    return count;
  } catch (err) {
    return 0;
  }
}

const RENDER_DEPLOY_BUFFER_MS = Number(process.env.RENDER_DEPLOY_BUFFER_MS || 60000);

let roomsSaveTimer = null;
function saveRooms(sync = false) {
  clearTimeout(roomsSaveTimer);
  const write = () => {
    try {
      const active = {};
      for (const [code, room] of rooms) {
        if (!room || room.ended) continue;
        active[code] = {
          code: room.code,
          map: room.map,
          diff: room.diff,
          speed: room.speed || (room.game ? room.game.speed : 1),
          started: room.started,
          createdAt: room.createdAt,
          lastActive: room.lastActive,
          resultIds: room.resultIds || {},
          players: room.players.map(p => {
            if (!p) return null;
            return {
              slot: p.slot,
              id: p.id,
              name: p.name,
              firebaseUid: p.firebaseUid || null,
              ready: p.ready,
              connected: false,
              disconnectedAt: p.disconnectedAt || Date.now(),
              forfeited: !!p.forfeited,
              reconnectToken: p.reconnectToken,
              maxSpeed: p.maxSpeed,
              unlocks: p.unlocks,
              stats: p.stats,
              initialUpgrades: p.initialUpgrades,
              permanent: p.permanent,
              startingCash: p.startingCash,
              allowedUpgrades: p.allowedUpgrades,
              targetPriority: p.targetPriority,
              up: p.up,
              purchased: p.purchased,
              cash: p.cash,
              hp: p.hp,
              maxhp: p.maxhp,
              shields: p.shields,
              kills: p.kills,
              earnedGold: p.earnedGold,
              earnedXP: p.earnedXP,
              posLabel: p.posLabel
            };
          }),
          game: room.game ? {
            wave: room.game.wave,
            waveTime: room.game.waveTime,
            elapsed: room.game.elapsed,
            spawned: room.game.spawned,
            kills: room.game.kills,
            gold: room.game.gold,
            diamonds: room.game.diamonds,
            xp: room.game.xp,
            hp: room.game.hp,
            maxhp: room.game.maxhp,
            shields: room.game.shields,
            speed: room.game.speed,
            map: room.game.map,
            diff: room.game.diff,
            enemies: (room.game.enemies || []).map(e => ({ ...e })),
            nextId: room.game.nextId
          } : null
        };
      }
      atomicWriteFileSync(ROOMS_FILE, JSON.stringify(active, null, 2));
      if (firestoreClient) {
        syncRoomsToFirestore(active, sync).catch(() => {});
      }
    } catch (e) {}
  };
  if (sync) write();
  else roomsSaveTimer = setTimeout(write, 100);
}

function loadRooms() {
  try {
    const parsed = loadJSONSafe(ROOMS_FILE, {});
    if (parsed && typeof parsed === 'object') {
      const now = Date.now();
      for (const [code, r] of Object.entries(parsed)) {
        reconstructRoom(r, now);
      }
    }
  } catch (e) {}
}

loadRooms();

function id(prefix = 'IT') { return prefix + '-' + crypto.randomBytes(4).toString('hex').toUpperCase(); }
function token() { return crypto.randomBytes(24).toString('hex'); }
function roomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let tries = 0; tries < 100; tries++) {
    let code = '';
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    if (!rooms.has(code)) return code;
  }
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}
function cleanName(v) {
  const s = String(v || 'Player').replace(/[^\w \-'.]/g, '').trim().slice(0, 20);
  return s || 'Player';
}
function clampInt(v, min, max, d = min) {
  const n = Number(v);
  return Number.isInteger(n) ? Math.max(min, Math.min(max, n)) : d;
}
function clampNum(v, min, max, d = min) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : d;
}
function safeStats(raw = {}) {
  const b = raw.boosterBonuses && typeof raw.boosterBonuses === 'object' ? raw.boosterBonuses : {};
  const bf = (k, max = 0.5) => clampNum(b[k], 0, max, 0);
  return {
    damage: clampNum(raw.damage, 1, 1e9, 15) * (1 + bf('dmg')),
    hp: clampNum(raw.hp, 20, 1e9, 100) * (1 + bf('hp')),
    attackSpeed: clampNum(raw.attackSpeed, 0.2, 50, 1.1) * (1 + bf('speed')),
    critChance: Math.min(1, clampNum(raw.critChance, 0, 1, 0) + bf('crit', 0.25)),
    critDamage: clampNum(raw.critDamage, 1, 100, 2) + bf('critDamage', 1),
    range: clampNum(raw.range, 60, 10000, 110) * (1 + bf('range')),
    coinBonus: clampNum(raw.coinBonus, 1, 1e6, 1) * (1 + bf('coin')),
    xpBonus: clampNum(raw.xpBonus, 1, 1e6, 1) * (1 + bf('xp')),
    extraMulti: clampInt(raw.extraMulti, 0, 10, 0),
    boosterRegen: bf('regen'),
    boosterDefense: bf('defense'),
    boosterDamageReduction: bf('damageReduction', 0.4),
    boosterInterest: bf('interest'),
    boosterProjectileSpeed: bf('projectileSpeed'),
    boosterShield: bf('shield'),
    boosterSlow: bf('slow', 0.4),
    boosterCash: bf('cash'),
    projectileSpeed: clampNum(raw.projectileSpeed, 200, 2500, 450),
    burstChanceBonus: clampNum(raw.burstChanceBonus, 0, 1, 0),
    multishotChance: clampNum(raw.multishotChance, 0, 1, 0),
    bounceChance: clampNum(raw.bounceChance, 0, 1, 0),
    rapidFireChance: clampNum(raw.rapidFireChance, 0, 1, 0),
    rapidFireMultiplier: clampNum(raw.rapidFireMultiplier, 1, 5, 1),
    bounceCount: clampInt(raw.bounceCount, 0, 6, 0),
    waveEndHeal: clampNum(raw.waveEndHeal, 0, 0.5, 0)
  };
}
function safeUnlocks(raw = {}) {
  const maxMap = clampInt(raw.maxMap, 1, 10, 1);
  const maxDiff = clampInt(raw.maxDiff, 0, DIFF_MULT.length - 1, 0);
  const byMap = {};
  if (raw.byMap && typeof raw.byMap === 'object') {
    for (let m = 1; m <= 10; m++) {
      const list = Array.isArray(raw.byMap[m]) ? raw.byMap[m] : [];
      const clean = [...new Set(list.map(x => clampInt(x, 0, DIFF_MULT.length - 1, -1)).filter(x => x >= 0))];
      if (clean.length) byMap[m] = clean;
    }
  }
  if (!Object.keys(byMap).length) {
    for (let m = 1; m <= maxMap; m++) {
      byMap[m] = [];
      for (let d = 0; d <= (m === maxMap ? maxDiff : DIFF_MULT.length - 1); d++) byMap[m].push(d);
    }
  }
  return { maxMap, maxDiff, byMap };
}
function safeInitialUpgrades(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  return UPS.map((u, i) => clampInt(arr[i], 0, u.max, 0));
}
function safeProfile(raw = {}, fallbackInitialUpgrades = []) {
  const p = raw && typeof raw === 'object' ? raw : {};
  const wl = Array.isArray(p.workshopLevels) ? p.workshopLevels : fallbackInitialUpgrades;
  const ll = Array.isArray(p.workshopLabLevels) ? p.workshopLabLevels : [];
  const workshopLevels = UPS.map((u, i) => clampInt(wl[i], 0, Core.workshopCap(i), 0));
  const workshopLabLevels = UPS.map((u, i) => clampInt(ll[i], 0, Core.labCap(i), 0));
  const bon = p.bonuses && typeof p.bonuses === 'object' ? p.bonuses : {};
  const mod = p.modifiers && typeof p.modifiers === 'object' ? p.modifiers : {};
  const bst = p.boosters && typeof p.boosters === 'object'
    ? p.boosters
    : (p.boosterProfile ? Core.computeBoosterBonuses(p.boosterProfile) : {});
  const eff = p.effects && typeof p.effects === 'object' ? p.effects : {};
  const labs = p.labs && typeof p.labs === 'object' ? p.labs : {};
  return {
    workshopLevels,
    workshopLabLevels,
    bonuses: {
      hp: clampNum(bon.hp, 0, 1e6, 0),
      dmg: clampNum(bon.dmg, 0, 1e6, 0),
      speed: clampNum(bon.speed, 0, 1e6, 0),
      coin: clampNum(bon.coin, 0, 1e6, 0),
      xp: clampNum(bon.xp, 0, 1e6, 0),
      range: clampNum(bon.range, 0, 1e6, 0),
      crit: clampNum(bon.crit, 0, 100, 0),
      critDamage: clampNum(bon.critDamage, 0, 1e6, 0),
      multi: clampInt(bon.multi, 0, 20, 0),
      extra: clampInt(bon.extra, 0, 20, 0)
    },
    modifiers: {
      regen: clampNum(mod.regen, 0, 100, 0),
      defense: clampNum(mod.defense, 0, 100, 0),
      damageReduction: clampNum(mod.damageReduction, 0, 0.8, 0),
      bossResist: clampNum(mod.bossResist, 0, 0.8, 0),
      missingHpDamage: clampNum(mod.missingHpDamage, 0, 100, 0),
      enemyDamage: clampNum(mod.enemyDamage, 0, 100, 0),
      bossDamage: clampNum(mod.bossDamage, 0, 100, 0),
      eliteDamage: clampNum(mod.eliteDamage, 0, 100, 0),
      enemyFragility: clampNum(mod.enemyFragility, 0, 100, 0),
      cash: clampNum(mod.cash, 0, 100, 0),
      gold: clampNum(mod.gold, 0, 100, 0),
      diamonds: clampNum(mod.diamonds, 0, 100, 0)
    },
    boosters: {
      dmg: clampNum(bst.dmg, 0, 0.5, 0),
      speed: clampNum(bst.speed, 0, 0.5, 0),
      range: clampNum(bst.range, 0, 0.5, 0),
      hp: clampNum(bst.hp, 0, 0.5, 0),
      regen: clampNum(bst.regen, 0, 0.5, 0),
      defense: clampNum(bst.defense, 0, 0.5, 0),
      cash: clampNum(bst.cash, 0, 0.5, 0),
      coin: clampNum(bst.coin, 0, 0.5, 0),
      crit: clampNum(bst.crit, 0, 0.05, 0),
      critDamage: clampNum(bst.critDamage, 0, 0.5, 0),
      damageReduction: clampNum(bst.damageReduction, 0, 0.4, 0),
      interest: clampNum(bst.interest, 0, 0.5, 0),
      projectileSpeed: clampNum(bst.projectileSpeed, 0, 0.5, 0),
      shield: clampNum(bst.shield, 0, 0.5, 0),
      xp: clampNum(bst.xp, 0, 0.5, 0),
      slow: clampNum(bst.slow, 0, 0.4, 0)
    },
    effects: {
      projectileSpeed: clampNum(eff.projectileSpeed, 200, 2500, Math.min(2500, Math.max(450, 450 + 8 * ((workshopLevels[1] || 0) + (workshopLabLevels[1] || 0))))),
      burstChance: clampNum(eff.burstChance, 0, 1, Math.min(1, ((workshopLevels[24] || 0) + (workshopLabLevels[24] || 0) + (workshopLevels[34] || 0)) * 0.025)),
      multishotChance: clampNum(eff.multishotChance, 0, 1, Math.min(1, ((workshopLevels[35] || 0) + (workshopLabLevels[35] || 0)) * 0.025)),
      bounceChance: clampNum(eff.bounceChance, 0, 1, Math.min(1, ((workshopLevels[36] || 0) + (workshopLabLevels[36] || 0)) * 0.025)),
      rapidFireChance: clampNum(eff.rapidFireChance, 0, 1, workshopLevels[37] * 0.01),
      rapidFireMultiplier: clampNum(eff.rapidFireMultiplier, 1, 5, 1),
      bounceCount: clampInt(eff.bounceCount, 0, 6, 0),
      lifeOnWaveEnd: clampNum(eff.lifeOnWaveEnd, 0, 0.5, workshopLevels[38] * 0.005),
      startupCash: clampInt(eff.startupCash, 0, 1e9, workshopLevels[39] * 10 + workshopLevels[28] * 10)
    },
    labs: {
      freeUpgrade: Array.isArray(labs.freeUpgrade) ? labs.freeUpgrade.slice(0, 4).map(x => clampInt(x, 0, 200, 0)) : [0, 0, 0, 0],
      xpPerWave: clampInt(labs.xpPerWave, 0, 200, 0),
      startupCash: clampInt(labs.startupCash, 0, 200, 0)
    },
    overcrit: !!p.overcrit
  };
}
function safeAllowedUpgrades(raw) {
  if (!Array.isArray(raw)) return UPS.map((_, i) => i).filter(i => i !== 26 && i !== 28);
  return [...new Set(raw.map(x => clampInt(x, 0, UPS.length - 1, -1)).filter(i => i >= 0 && i !== 26 && i !== 28))];
}
function roomUnlockedForAll(room, map, diff) {
  const players = room.players.filter(Boolean);
  if (!players.length) return map === 1 && diff === 0;
  return players.every(p => Array.isArray(p.unlocks?.byMap?.[map]) && p.unlocks.byMap[map].includes(diff));
}
function clampRoomStageToPlayers(room) {
  if (roomUnlockedForAll(room, room.map, room.diff)) return;
  for (let m = Math.min(room.map, 10); m >= 1; m--) {
    for (let d = DIFF_MULT.length - 1; d >= 0; d--) {
      if (roomUnlockedForAll(room, m, d)) { room.map = m; room.diff = d; return; }
    }
  }
  room.map = 1;
  room.diff = 0;
}
function send(ws, obj) {
  if (ws && ws.readyState === 1) {
    try { ws.send(JSON.stringify(obj)); } catch (e) {}
  }
}
function broadcast(room, obj) {
  for (const p of room.players) if (p && p.ws) send(p.ws, obj);
}

function publicProfile(acc) {
  return { id: acc.id, name: acc.name };
}
function friendStatus(id) {
  const acc = db.accounts[id];
  if (!acc) return null;
  const ws = socketsByPlayer.get(id);
  return { id: acc.id, name: acc.name, status: ws ? (ws.roomCode ? 'In CO-OP' : 'Online') : 'Offline' };
}
function sendFriends(acc, ws) {
  const friends = (acc.friends || []).map(friendStatus).filter(Boolean);
  const requests = (acc.requests || []).map(rid => db.accounts[rid]).filter(Boolean).map(publicProfile);
  send(ws, { type: 'friends', friends, requests });
}
function notifyFriends(acc) {
  const status = friendStatus(acc.id);
  for (const fid of acc.friends || []) {
    const fws = socketsByPlayer.get(fid);
    if (fws) send(fws, { type: 'friend_status', friend: status });
  }
}

function permanentLevel(p, index) {
  const u = UPS[index];
  if (!u) return 0;
  if (p?.permanent?.workshopLevels) {
    return clampInt((p.permanent.workshopLevels[index] || 0) + (p.permanent.workshopLabLevels?.[index] || 0), 0, u.max, 0);
  }
  return clampInt(p?.initialUpgrades?.[index], 0, u.max, 0);
}
function totalLevel(p, index) {
  const u = UPS[index];
  if (!u) return 0;
  return clampInt(permanentLevel(p, index) + clampInt(p?.up?.[index], 0, u.max, 0), 0, u.max, 0);
}
function effectiveLevels(p) {
  return UPS.map((_, i) => totalLevel(p, i));
}

function makeRoom(hostWs, msg) {
  const code = roomCode();
  const rToken = token();
  const hostUnlocks = safeUnlocks(msg.unlocks);
  const reqMap = clampInt(msg.map, 1, 10, 1);
  const reqDiff = clampInt(msg.diff, 0, DIFF_MULT.length - 1, 0);
  const initUp = safeInitialUpgrades(msg.initialUpgrades);
  const perm = safeProfile(msg.profile || msg.permanentProfile, initUp);
  const room = {
    code,
    createdAt: Date.now(),
    lastActive: Date.now(),
    map: Array.isArray(hostUnlocks.byMap[reqMap]) && hostUnlocks.byMap[reqMap].includes(reqDiff) ? reqMap : 1,
    diff: Array.isArray(hostUnlocks.byMap[reqMap]) && hostUnlocks.byMap[reqMap].includes(reqDiff) ? reqDiff : 0,
    started: false,
    ended: false,
    players: [
      {
        slot: 0,
        id: hostWs.playerId || id('P'),
        firebaseUid: String(msg.firebaseUid || hostWs.firebaseUid || '').trim() || null,
        name: cleanName(msg.name || hostWs.playerName),
        skin: String(msg.skin || 'Classic').trim().slice(0, 32),
        ready: false,
        connected: true,
        forfeited: false,
        reconnectToken: rToken,
        maxSpeed: clampInt(msg.maxSpeed, 1, 10, 1),
        unlocks: hostUnlocks,
        stats: safeStats(msg.stats),
        initialUpgrades: initUp,
        permanent: perm,
        startingCash: clampInt(msg.startingCash, 0, 1e9, perm.effects.startupCash || 80),
        allowedUpgrades: safeAllowedUpgrades(msg.allowedUpgrades),
        up: Array(UPS.length).fill(0),
        purchased: Array(UPS.length).fill(0),
        cash: clampInt(msg.startingCash, 0, 1e9, perm.effects.startupCash || 80),
        ws: hostWs,
        disconnectTimer: null
      },
      null,
      null,
      null
    ],
    game: null
  };
  hostWs.roomCode = code;
  hostWs.room = room;
  hostWs.slot = 0;
  rooms.set(code, room);
  saveRooms();
  return { room, reconnectToken: rToken };
}

function lobbyState(room) {
  // Note: Speed in CO-OP is NEVER capped to Math.min of players (Section 5).
  // maxSpeed here is informational; each player can activate up to their own maxSpeed.
  const activePlayers = room.players.filter(Boolean);
  return {
    code: room.code,
    map: room.map,
    diff: room.diff,
    started: room.started,
    maxSpeed: activePlayers.reduce((m, p) => Math.max(m, p.maxSpeed || 1), 1),
    players: room.players.map((p, idx) => p ? {
      slot: idx,
      id: p.id,
      name: p.name,
      skin: p.skin || 'Classic',
      ready: !!p.ready,
      connected: !!p.connected,
      forfeited: !!p.forfeited,
      maxSpeed: p.maxSpeed,
      unlocks: p.unlocks,
      pos: Core.TOWER_POSITIONS[idx]
    } : null)
  };
}

function startGame(room, mapOverride, diffOverride, requireReady = false) {
  if (!room) return false;
  if (mapOverride !== undefined) room.map = clampInt(mapOverride, 1, 10, room.map || 1);
  if (diffOverride !== undefined) room.diff = clampInt(diffOverride, 0, DIFF_MULT.length - 1, room.diff || 0);
  if (!room.map) room.map = 1;
  if (room.diff === undefined) room.diff = 0;

  room.players.forEach((p, idx) => {
    if (!p) return;
    if (p.slot === undefined) p.slot = idx;
    if (p.connected === undefined) p.connected = true;
    if (!requireReady && p.ready === undefined) p.ready = true;
    if (!p.stats) p.stats = safeStats({});
    if (!p.permanent) p.permanent = safeProfile({}, p.initialUpgrades);
  });

  const players = room.players.filter(Boolean);
  if (room.started || players.length < 2) return false;
  if (requireReady && !players.every(p => p.ready && p.connected)) return false;

  room.started = true;
  for (const p of players) {
    const pos = Core.TOWER_POSITIONS[p.slot] || { x: 0, y: 0, label: 'Nord' };
    p.x = pos.x;
    p.y = pos.y;
    p.posLabel = (pos.label || 'NORD').toUpperCase();
    p.up = Array(UPS.length).fill(0);
    p.purchased = Array(UPS.length).fill(0);
    p.cash = p.startingCash !== undefined ? p.startingCash : 80;
    p.hp = p.stats.hp;
    p.maxhp = p.stats.hp;
    p.shields = Math.round(Core.shieldCapacity(permanentLevel(p, 16)) * (1 + (p.stats.boosterShield || 0)));
    p.shot = 0;
    p.rapidFireRemaining = 0;
    p.rapidFireTriggers = 0;
    p.interestTimer = 0;
    p.burstQueue = [];
    p.kills = 0;
    p.damage = 0;
    p.taken = 0;
    p.earnedGold = 0;
    p.earnedXP = 0;
    p.forfeited = false;
  }

  const totalHp = players.reduce((sum, p) => sum + p.maxhp, 0);
  const totalShields = players.reduce((sum, p) => sum + (p.shields || 0), 0);
  room.game = {
    room,
    wave: 1,
    waveTime: 0,
    elapsed: 0,
    spawned: 0,
    kills: 0,
    gold: 0,
    diamonds: 0,
    xp: 0,
    hp: totalHp,
    maxhp: totalHp,
    shields: totalShields,
    speed: room.speed || 1,
    map: room.map,
    diff: room.diff,
    players,
    enemies: [],
    bullets: [],
    enemyBullets: [],
    nextId: 1
  };
  room.speed = room.game.speed;
  broadcast(room, { type: 'game_started', state: snapshot(room) });
  saveRooms();
  return true;
}

function towerStats(g, p) {
  const effUp = effectiveLevels(p);
  const eff = Core.computeUpgradeEffects(p.permanent?.workshopLevels || p.initialUpgrades, p.up, {});
  const rapidMult = Math.max(1, Number(p.permanent?.effects?.rapidFireMultiplier ?? p.stats?.rapidFireMultiplier) || eff.rapidFireMultiplier || 1);
  const st = Core.towerStats(effUp, { ...(p.stats || {}), maxHp: p.maxhp }, {
    regen: (Number(p.permanent?.modifiers?.regen) || 0) + (p.stats?.boosterRegen || 0) * 10,
    defense: (Number(p.permanent?.modifiers?.defense) || 0) + (p.stats?.boosterDefense || 0)
  });
  st.defense = Math.min(0.95, Math.max(0, st.defense));
  st.speed *= ((Number(p.rapidFireRemaining) || 0) > 0 ? rapidMult : 1);
  return st;
}

function spawnEnemy(g) {
  return Core.spawnWaveBatch(g);
}

function tick(g, dt) {
  if (!g || g.over) return;
  // Step 3B: High-precision sub-stepping at x1, x5, and x10 to guarantee bullet collision precision & zero tunneling
  const totalDt = Math.min(0.5, dt * (g.speed || 1));
  const stepSlice = 0.05;
  let remaining = totalDt;
  const effCache = new WeakMap();
  const getEffUp = p => {
    let v = effCache.get(p);
    if (!v) {
      v = effectiveLevels(p);
      effCache.set(p, v);
    }
    return v;
  };
  while (remaining > 0 && !g.over) {
    const slice = Math.min(stepSlice, remaining);
    remaining -= slice;
    const result = Core.stepCombat(g, slice, {
      getEffectiveUp: getEffUp,
      getTowerStats: (p) => towerStats(g, p),
      onKill: (e, killer) => {
        if (e && e.type) {
          g.pendingKills = g.pendingKills || [];
          g.pendingKills.push(e.type);
        }
      }
    });
    if (result === 'core_destroyed' || result === 'max_wave') {
      g.over = true;
      g.reason = result;
      break;
    }
  }
}

function upgrade(room, slot, index, batch = 1) {
  const g = room.game;
  const p = room.players[slot];
  if (!g || !p || p.forfeited || !Number.isInteger(index) || index < 0 || index >= UPS.length) return false;
  if (p.hp <= 0) return false; // Modif #14: KO players cannot buy upgrades
  if (Array.isArray(p.allowedUpgrades) && !p.allowedUpgrades.includes(index)) return false;

  // Modif #15: Strict all-or-nothing check for batch 10 and 100
  if (batch === 10 || batch === 100) {
    const effUp = effectiveLevels(p);
    const eff = Core.computeUpgradeEffects(p.permanent?.workshopLevels || p.initialUpgrades, p.up, {});
    const st = towerStats(g, p);
    const permanentHeal = Math.min(0.5, (p.stats.waveEndHeal || 0) + (eff.lifeOnWaveEnd || 0));
    const currentHeal = Core.waveEndHealFraction(permanentHeal, (p.up[40] || 0) * 0.005);
    const freeLabBonus = Number(p.permanent?.labs?.freeUpgrade?.[index - 29]) || 0;

    const quote = Core.batchUpgradeQuote({
      index,
      currentLevel: p.up[index] || 0,
      cash: p.cash,
      requestedBatch: batch,
      effectiveUp: effUp,
      stats: st,
      effects: eff,
      waveEndHeal: currentHeal,
      freeUpgradeLabLevel: freeLabBonus
    });
    if (quote.allOrNothingFailed || quote.count < batch || p.cash < quote.totalCost) {
      return false;
    }
  }

  const limit = batch === 'max' ? 1000 : clampInt(batch, 1, 1000, 1);
  let count = 0;

  while (count < limit) {
    const effUp = effectiveLevels(p);
    const eff = Core.computeUpgradeEffects(p.permanent?.workshopLevels || p.initialUpgrades, p.up, {});
    const st = towerStats(g, p);
    const permanentHeal = Math.min(0.5, (p.stats.waveEndHeal || 0) + (eff.lifeOnWaveEnd || 0));
    const currentHeal = Core.waveEndHealFraction(permanentHeal, (p.up[40] || 0) * 0.005);
    const freeLabBonus = Number(p.permanent?.labs?.freeUpgrade?.[index - 29]) || 0;

    if (!Core.canBuyRunUpgrade(index, {
      up: p.up,
      effectiveUp: effUp,
      stats: st,
      effects: eff,
      waveEndHeal: currentHeal,
      freeUpgradeLabLevel: freeLabBonus
    })) break;

    const rawC = cost(index, p.up[index]);
    const c = Core.discountedLevelPrice(rawC, batch);
    if (p.cash < c || !Number.isFinite(c) || c >= Number.MAX_SAFE_INTEGER) break;

    p.cash -= c;
    p.up[index]++;
    if (Array.isArray(p.purchased)) p.purchased[index] = (p.purchased[index] || 0) + 1;
    count++;

    if (index === 2) {
      const nextLv = totalLevel(p, 2);
      const hp = Core.hpUpgrade(p.maxhp, p.hp, nextLv - 1, nextLv);
      p.maxhp = hp.max;
      p.hp = hp.hp;
      g.maxhp = room.players.filter(Boolean).reduce((sum, pl) => sum + pl.maxhp, 0);
      g.hp = room.players.filter(Boolean).reduce((sum, pl) => sum + Math.max(0, pl.hp), 0);
    }
    if (index === 16) {
      p.shields = Math.round(Core.shieldCapacity(totalLevel(p, 16)) * (1 + (p.stats.boosterShield || 0)));
      g.shields = room.players.filter(Boolean).reduce((sum, pl) => sum + (pl.shields || 0), 0);
    }
  }
  if (count > 0) saveRooms();
  return count > 0;
}

function snapshot(roomOrGame) {
  const room = roomOrGame && roomOrGame.room ? roomOrGame.room : roomOrGame;
  const g = room && room.game ? room.game : (roomOrGame && Array.isArray(roomOrGame.players) && roomOrGame.wave ? roomOrGame : null);
  if (!g) return lobbyState(room);
  const rPlayers = room && Array.isArray(room.players) ? room.players : g.players;
  return {
    code: room ? room.code : undefined,
    started: true,
    wave: g.wave,
    waveTime: Number((g.waveTime || 0).toFixed(2)),
    map: room ? room.map : g.map,
    diff: room ? room.diff : g.diff,
    speed: g.speed,
    maxSpeed: rPlayers.filter(Boolean).reduce((m, p) => Math.max(m, p.maxSpeed || 1), 1),
    hp: Math.round(g.hp),
    maxhp: Math.round(g.maxhp),
    shields: Math.round(g.shields || 0),
    kills: g.kills,
    gold: Math.floor(g.gold),
    diamonds: g.diamonds,
    xp: Math.floor(g.xp),
    elapsed: Math.floor(g.elapsed),
    players: rPlayers.map((p, idx) => p ? {
      slot: p.slot ?? idx,
      id: p.id,
      name: p.name,
      skin: p.skin || 'Classic',
      connected: !!p.connected,
      forfeited: !!p.forfeited,
      cash: Math.floor(p.cash),
      hp: Math.round(p.hp),
      maxhp: Math.round(p.maxhp),
      shields: Math.round(p.shields || 0),
      kills: p.kills || 0,
      damage: Math.floor(p.damage || 0),
      up: p.up,
      permanentLevels: UPS.map((_, i) => permanentLevel(p, i)),
      effectiveUp: effectiveLevels(p),
      maxSpeed: p.maxSpeed,
      pos: Core.TOWER_POSITIONS[p.slot ?? idx]
    } : null),
    enemies: (g.enemies || []).slice(0, 80).map(e => [e.id, Math.round(e.x), Math.round(e.y), Math.round(e.hp), Math.round(e.max), e.type, e.isGiant ? (e.giantFactor || 6) : 0]),
    bullets: (g.bullets || []).slice(0, 60).map(b => [Math.round(b.x), Math.round(b.y), Math.round(b.txX ?? b.tx?.x ?? 0), Math.round(b.txY ?? b.tx?.y ?? 0), b.slot, b.overcrit ? 2 : (b.crit ? 1 : 0)]),
    enemyBullets: (g.enemyBullets || []).slice(0, 60).map(b => [Math.round(b.x), Math.round(b.y)]),
    authoritativeKills: (g.pendingKills || []).splice(0)
  };
}

function finish(room, reason) {
  if (!room || room.ended) return;
  room.ended = true;
  const g = room.game;
  if (!room.resultIds) room.resultIds = {};
  if (!db.rewards) db.rewards = {};

  const rawWave = g ? g.wave : 1;
  const creditedWave = (rawWave >= 5000 && (!g || !g.wave5000Cleared) && reason !== 'max_wave' && reason !== 'Wave Complete')
    ? 4999
    : Math.min(5000, rawWave);

  // Modif #20: Shared CO-OP Rewards
  const activePlayers = room.players.filter(pl => pl && !pl.forfeited);
  const avgCoinBonus = activePlayers.length > 0 ? (activePlayers.reduce((sum, pl) => sum + (pl.stats?.coinBonus || 1), 0) / activePlayers.length) : 1;
  const avgXpBonus = activePlayers.length > 0 ? (activePlayers.reduce((sum, pl) => sum + (pl.stats?.xpBonus || 1), 0) / activePlayers.length) : 1;
  const sharedGold = g ? g.gold : 0;
  const sharedXP = g ? g.xp : 0;
  const sharedDiamonds = g ? g.diamonds : 0;
  const commonRewards = Core.calculateRunRewards({
    earnedGold: sharedGold,
    earnedXP: sharedXP,
    wave: creditedWave,
    map: room.map || 1,
    diff: room.diff || 0,
    coinBonus: avgCoinBonus,
    xpBonus: avgXpBonus,
    diamonds: sharedDiamonds
  });

  room.players.forEach((p, idx) => {
    if (!p || p.forfeited) return;
    const slot = p.slot ?? idx;
    if (!room.resultIds[slot]) room.resultIds[slot] = crypto.randomBytes(16).toString('hex');
    const resId = room.resultIds[slot];

    // Registre persistant anti-duplication des récompenses côté serveur
    const rewardRecord = {
      resultId: resId,
      slot,
      playerId: p.id,
      firebaseUid: p.firebaseUid || null,
      roomCode: room.code,
      wave: creditedWave,
      coins: commonRewards.coins,
      diamonds: commonRewards.diamonds,
      xp: commonRewards.xp,
      finishedAt: Date.now(),
      reason,
      claimed: false,
      claimedAt: null,
      claimedByUid: null,
      firestoreSynced: false
    };
    db.rewards[resId] = rewardRecord;
    rewardsDb[resId] = rewardRecord;
    send(p.ws, {
      type: 'game_over',
      reason,
      slot,
      resultId: resId,
      firebaseUid: p.firebaseUid || null,
      wave: creditedWave,
      kills: g ? g.kills : 0,
      playerKills: p.kills || 0,
      coins: commonRewards.coins,
      diamonds: commonRewards.diamonds,
      xp: commonRewards.xp,
      elapsed: g ? Math.floor(g.elapsed || 0) : 0,
      map: room.map || 1,
      diff: room.diff || 0
    });
  });
  saveRewards(true);
  saveDB(true);
  saveRooms(true);
}

function getRoomMaxSpeed(room) {
  if (!room || !Array.isArray(room.players)) return 1;
  const activePlayers = room.players.filter(p => p && !p.forfeited && p.connected !== false);
  if (!activePlayers.length) return 1;
  const limits = activePlayers.map(p => Math.max(1, Math.min(10, Math.floor(Number(p.maxSpeed) || 1))));
  return Math.max(...limits);
}

function syncRoomSpeedCap(room) {
  if (!room) return;
  const commonMax = getRoomMaxSpeed(room);
  const curSpd = room.game ? (room.game.speed || room.speed || 1) : (room.speed || 1);
  if (curSpd > commonMax) {
    if (room.game) room.game.speed = commonMax;
    room.speed = commonMax;
    broadcast(room, { type: 'speed_changed', speed: commonMax, maxSpeed: commonMax, clamped: true });
  }
}

function leaveRoom(ws, reason = 'player_left') {
  const room = rooms.get(ws.roomCode) || ws.room;
  if (!room) return;
  const slot = ws.slot;
  const p = room.players[slot];
  ws.roomCode = null;
  ws.room = null;
  ws.slot = null;
  if (!p) return;

  if (!room.started) {
    room.players[slot] = null;
    const remaining = room.players.filter(Boolean);
    if (!remaining.length) {
      rooms.delete(room.code);
      return;
    }
    // Compact slots if before game start so host is always present
    if (!room.players[0]) {
      const firstIdx = room.players.findIndex(Boolean);
      if (firstIdx > 0) {
        room.players[0] = room.players[firstIdx];
        room.players[firstIdx] = null;
        room.players[0].slot = 0;
        if (room.players[0].ws) room.players[0].ws.slot = 0;
      }
    }
    for (const pl of room.players) if (pl) pl.ready = false;
    clampRoomStageToPlayers(room);
    broadcast(room, { type: 'lobby', state: lobbyState(room) });
    return;
  }

  // Voluntary quit during an active run: player forfeits their tower and leaves,
  // while remaining connected players continue their run!
  p.connected = false;
  p.forfeited = true;
  p.ws = null;
  p.hp = 0;
  p.shields = 0;
  clearTimeout(p.disconnectTimer);

  if (room.game) {
    room.game.hp = room.players.filter(Boolean).reduce((sum, pl) => sum + Math.max(0, pl.hp), 0);
    room.game.maxhp = room.players.filter(Boolean).reduce((sum, pl) => sum + pl.maxhp, 0);
    room.game.shields = room.players.filter(Boolean).reduce((sum, pl) => sum + (pl.shields || 0), 0);
  }

  broadcast(room, {
    type: 'player_status',
    slot,
    connected: false,
    forfeited: true,
    players: lobbyState(room).players
  });

  const activeRemaining = room.players.filter(pl => pl && !pl.forfeited && pl.connected);
  const anyNonForfeited = room.players.filter(pl => pl && !pl.forfeited);
  if (anyNonForfeited.length === 0 || (activeRemaining.length === 0 && !room.players.some(pl => pl && !pl.forfeited && pl.disconnectTimer))) {
    finish(room, reason);
    rooms.delete(room.code);
  } else if (room.game && room.game.hp <= 0) {
    finish(room, 'core_destroyed');
    rooms.delete(room.code);
  } else {
    syncRoomSpeedCap(room);
    broadcast(room, { type: 'state', state: snapshot(room) });
    saveRooms();
  }
}

function handleDisconnect(ws) {
  if (ws.playerId && socketsByPlayer.get(ws.playerId) === ws) {
    socketsByPlayer.delete(ws.playerId);
    const acc = db.accounts[ws.playerId];
    if (acc) notifyFriends(acc);
  }
  const room = rooms.get(ws.roomCode) || ws.room;
  if (!room) return;
  const p = room.players[ws.slot];
  if (!p) return;
  if (!room.started) {
    leaveRoom(ws, 'disconnect');
    return;
  }
  p.connected = false;
  p.ws = null;
  syncRoomSpeedCap(room);
  broadcast(room, { type: 'player_status', slot: p.slot, connected: false, forfeited: !!p.forfeited, players: lobbyState(room).players });
  clearTimeout(p.disconnectTimer);
  p.disconnectTimer = setTimeout(() => {
    p.disconnectTimer = null;
    if (!p.connected && !room.ended) {
      p.forfeited = true;
      p.hp = 0;
      p.shields = 0;
      if (room.game) {
        room.game.hp = room.players.filter(Boolean).reduce((sum, pl) => sum + Math.max(0, pl.hp), 0);
        room.game.shields = room.players.filter(Boolean).reduce((sum, pl) => sum + (pl.shields || 0), 0);
      }
      const stillPlaying = room.players.filter(pl => pl && !pl.forfeited && pl.connected);
      if (stillPlaying.length === 0) {
        finish(room, 'disconnect_timeout');
        rooms.delete(room.code);
      } else if (room.game && room.game.hp <= 0) {
        finish(room, 'core_destroyed');
        rooms.delete(room.code);
      } else {
        broadcast(room, { type: 'player_status', slot: p.slot, connected: false, forfeited: true, players: lobbyState(room).players });
        broadcast(room, { type: 'state', state: snapshot(room) });
      }
    }
  }, RECONNECT_GRACE_MS);
  if (p.disconnectTimer && typeof p.disconnectTimer.unref === 'function') p.disconnectTimer.unref();
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8'
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'Content-Type, Authorization'
    });
    res.end();
    return;
  }

  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    res.end(JSON.stringify({ ok: true, version: Core.VERSION, rooms: rooms.size, uptime: Math.floor(process.uptime()), rewardsCount: Object.keys(rewardsDb).length }));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/claim_reward') {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 64 * 1024) req.destroy();
    });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const rid = String(payload.resultId || '').trim();
        const token = String(payload.idToken || payload.token || '').trim();
        let pid = String(payload.playerId || '').trim();
        let authUser = null;
        if (token) {
          authUser = await verifyFirebaseAuthToken(token);
          if (authUser && authUser.uid) pid = authUser.uid;
        }

        const rec = rewardsDb[rid] || db.rewards[rid];
        if (!rec) {
          res.writeHead(404, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
          res.end(JSON.stringify({ ok: false, error: 'reward_not_found' }));
          return;
        }
        if (rec.firebaseUid && pid && rec.firebaseUid !== pid) {
          res.writeHead(403, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
          res.end(JSON.stringify({ ok: false, error: 'player_mismatch' }));
          return;
        }
        if (pid && rec.playerId && rec.playerId !== pid && (!rec.firebaseUid || rec.firebaseUid !== pid)) {
          res.writeHead(403, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
          res.end(JSON.stringify({ ok: false, error: 'player_mismatch' }));
          return;
        }
        if (rec.claimed) {
          // Idempotence & Résilience réseau : si c'est le même joueur (reconnexion après perte de paquet)
          if (!rec.claimedByUid || rec.claimedByUid === pid || rec.playerId === pid || rec.firebaseUid === pid) {
            res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
            res.end(JSON.stringify({ ok: true, alreadyClaimed: true, reward: rec, message: 'Recovered claimed reward idempotently' }));
            return;
          }
          res.writeHead(409, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
          res.end(JSON.stringify({ ok: false, error: 'already_claimed', claimedAt: rec.claimedAt }));
          return;
        }

        // Exécution de la transaction atomique Firestore si connectée
        let fsCreditResult = null;
        if (firestoreClient) {
          try {
            const fsRes = await executeFirestoreRewardTransaction(firestoreClient, pid || rec.firebaseUid, rid, rec);
            if (fsRes.alreadyClaimed) {
              rec.claimed = true;
              rec.claimedAt = fsRes.claimedAt || Date.now();
              rec.claimedByUid = pid || rec.firebaseUid;
              rec.firestoreSynced = true;
              saveRewards(true);
              res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
              res.end(JSON.stringify({ ok: true, alreadyClaimed: true, reward: rec, message: 'Firestore already claimed' }));
              return;
            }
            fsCreditResult = fsRes;
          } catch (fsErr) {
            console.error('Erreur transaction Firestore:', fsErr.message);
          }
        }

        rec.claimed = true;
        rec.claimedAt = Date.now();
        rec.claimedByUid = pid || rec.playerId;
        rec.firestoreSynced = true;
        db.rewards[rid] = rec;
        saveRewards(true);
        saveDB(true);
        res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
        res.end(JSON.stringify({ ok: true, reward: rec, firestoreTransaction: fsCreditResult }));
      } catch (err) {
        res.writeHead(400, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
        res.end(JSON.stringify({ ok: false, error: 'invalid_json' }));
      }
    });
    return;
  }

  if (req.method === 'GET' && url.pathname.startsWith('/reward/')) {
    const rid = url.pathname.replace('/reward/', '').trim();
    const rec = rewardsDb[rid] || db.rewards[rid];
    if (!rec) {
      res.writeHead(404, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
      res.end(JSON.stringify({ ok: false, error: 'not_found' }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    res.end(JSON.stringify({ ok: true, reward: rec }));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/unclaimed_rewards') {
    const pid = url.searchParams.get('playerId');
    const list = Object.values(rewardsDb).filter(r => !r.claimed && (!pid || r.playerId === pid));
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    res.end(JSON.stringify({ ok: true, count: list.length, rewards: list }));
    return;
  }

  const rel = url.pathname === '/' ? '/combat-core.js' : url.pathname;
  const safePath = path.normalize(rel).replace(/^(\.\.[/\\])+/, '');
  const file = path.join(__dirname, safePath);
  if (file.startsWith(__dirname) && fs.existsSync(file) && fs.statSync(file).isFile()) {
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'text/plain; charset=utf-8' });
    fs.createReadStream(file).pipe(res);
    return;
  }
  res.writeHead(404, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

const wss = new WebSocketServer({ server, maxPayload: MAX_MESSAGE_BYTES });

function onMessage(ws, raw) {
  let msg = raw;
  if (typeof raw === 'string' || Buffer.isBuffer(raw)) {
    if (Buffer.byteLength(raw) > MAX_MESSAGE_BYTES) return;
    try { msg = JSON.parse(String(raw)); } catch (e) { return; }
  }
  if (!msg || typeof msg.type !== 'string') return;

  if (msg.type === 'claim_reward') {
    (async () => {
      const rid = String(msg.resultId || '').trim();
      const token = String(msg.idToken || msg.token || '').trim();
      let pid = String(msg.playerId || ws.playerId || '').trim();
      if (token) {
        const verified = await verifyFirebaseAuthToken(token);
        if (verified && verified.uid) pid = verified.uid;
      }
      const rec = rewardsDb[rid] || db.rewards[rid];
      if (!rec) {
        send(ws, { type: 'reward_claim_result', resultId: rid, ok: false, error: 'reward_not_found' });
        return;
      }
      if (rec.firebaseUid && pid && rec.firebaseUid !== pid) {
        send(ws, { type: 'reward_claim_result', resultId: rid, ok: false, error: 'player_mismatch' });
        return;
      }
      if (pid && rec.playerId && rec.playerId !== pid && (!rec.firebaseUid || rec.firebaseUid !== pid)) {
        send(ws, { type: 'reward_claim_result', resultId: rid, ok: false, error: 'player_mismatch' });
        return;
      }
      if (rec.claimed) {
        if (!rec.claimedByUid || rec.claimedByUid === pid || rec.playerId === pid || rec.firebaseUid === pid) {
          send(ws, {
            type: 'reward_claim_result',
            resultId: rid,
            ok: true,
            alreadyClaimed: true,
            coins: rec.coins,
            diamonds: rec.diamonds,
            xp: rec.xp,
            wave: rec.wave
          });
          return;
        }
        send(ws, { type: 'reward_claim_result', resultId: rid, ok: false, error: 'already_claimed', claimedAt: rec.claimedAt });
        return;
      }

      if (firestoreClient) {
        try {
          const fsRes = await executeFirestoreRewardTransaction(firestoreClient, pid || rec.firebaseUid, rid, rec);
          if (fsRes.alreadyClaimed) {
            rec.claimed = true;
            rec.claimedAt = fsRes.claimedAt || Date.now();
            rec.claimedByUid = pid || rec.firebaseUid;
            rec.firestoreSynced = true;
            saveRewards(true);
            send(ws, {
              type: 'reward_claim_result',
              resultId: rid,
              ok: true,
              alreadyClaimed: true,
              coins: rec.coins,
              diamonds: rec.diamonds,
              xp: rec.xp,
              wave: rec.wave
            });
            return;
          }
        } catch (_) {}
      }

      rec.claimed = true;
      rec.claimedAt = Date.now();
      rec.claimedByUid = pid || rec.playerId;
      rec.firestoreSynced = true;
      db.rewards[rid] = rec;
      saveRewards(true);
      saveDB(true);
      send(ws, {
        type: 'reward_claim_result',
        resultId: rid,
        ok: true,
        coins: rec.coins,
        diamonds: rec.diamonds,
        xp: rec.xp,
        wave: rec.wave
      });
    })().catch(() => {});
    return;
  }

  if (msg.type === 'ping') { send(ws, { type: 'pong', t: msg.t }); return; }

  if (msg.type === 'register') {
    const pid = id('IT');
    const tok = token();
    const acc = { id: pid, token: tok, name: cleanName(msg.name), friends: [], requests: [], createdAt: Date.now() };
    db.accounts[pid] = acc;
    saveDB();
    send(ws, { type: 'registered', id: pid, token: tok, name: acc.name });
    return;
  }

  if (msg.type === 'login') {
    const acc = db.accounts[String(msg.id || '')];
    if (!acc || acc.token !== String(msg.token || '')) {
      send(ws, { type: 'error', message: 'Invalid account credentials' });
      return;
    }
    if (msg.name) acc.name = cleanName(msg.name);
    ws.playerId = acc.id;
    ws.playerName = acc.name;
    socketsByPlayer.set(acc.id, ws);
    saveDB();
    send(ws, {
      type: 'logged_in',
      profile: publicProfile(acc),
      friends: (acc.friends || []).map(friendStatus).filter(Boolean),
      requests: (acc.requests || []).map(rid => db.accounts[rid]).filter(Boolean).map(publicProfile)
    });
    notifyFriends(acc);
    return;
  }

  if (msg.type === 'friends') {
    const acc = db.accounts[ws.playerId];
    if (acc) sendFriends(acc, ws);
    return;
  }

  if (msg.type === 'friend_request') {
    const me = db.accounts[ws.playerId];
    const target = db.accounts[String(msg.friendId || '').trim().toUpperCase()];
    if (!me || !target || me.id === target.id) {
      send(ws, { type: 'error', message: 'Player ID not found' });
      return;
    }
    target.requests = target.requests || [];
    me.friends = me.friends || [];
    if (!me.friends.includes(target.id) && !target.requests.includes(me.id)) {
      target.requests.push(me.id);
      saveDB();
      const tws = socketsByPlayer.get(target.id);
      if (tws) send(tws, { type: 'friend_request', from: publicProfile(me) });
    }
    sendFriends(me, ws);
    return;
  }

  if (msg.type === 'friend_accept') {
    const me = db.accounts[ws.playerId];
    const from = db.accounts[String(msg.friendId || '').trim().toUpperCase()];
    if (!me || !from) return;
    me.requests = (me.requests || []).filter(x => x !== from.id);
    me.friends = me.friends || [];
    from.friends = from.friends || [];
    if (!me.friends.includes(from.id)) me.friends.push(from.id);
    if (!from.friends.includes(me.id)) from.friends.push(me.id);
    saveDB();
    sendFriends(me, ws);
    const fws = socketsByPlayer.get(from.id);
    if (fws) { send(fws, { type: 'friend_accepted', friend: publicProfile(me) }); sendFriends(from, fws); }
    notifyFriends(me);
    notifyFriends(from);
    return;
  }

  if (msg.type === 'invite') {
    const me = db.accounts[ws.playerId];
    const room = rooms.get(ws.roomCode) || ws.room;
    const fws = socketsByPlayer.get(String(msg.friendId || '').trim().toUpperCase());
    if (!me || !room) { send(ws, { type: 'error', message: 'Create a CO-OP room first' }); return; }
    if (fws) send(fws, { type: 'invite', from: publicProfile(me), code: room.code });
    send(ws, { type: 'invite_sent', online: !!fws });
    return;
  }

  if (msg.type === 'host' || msg.type === 'create_room') {
    if (ws.roomCode || ws.room) leaveRoom(ws, 'switch_room');
    const { room, reconnectToken } = makeRoom(ws, msg);
    send(ws, { type: 'created', roomCode: room.code, code: room.code, slot: 0, reconnectToken, state: lobbyState(room) });
    return;
  }

  if (msg.type === 'join' || msg.type === 'join_room') {
    const code = String(msg.code || msg.roomCode || '').trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) { send(ws, { type: 'error', message: 'Room not found' }); return; }
    const emptySlot = room.players.findIndex(p => p === null);
    if (room.started || emptySlot === -1) { send(ws, { type: 'error', message: 'Room is full or already started' }); return; }
    if (ws.roomCode || ws.room) leaveRoom(ws, 'switch_room');
    const rToken = token();
    const initUp = safeInitialUpgrades(msg.initialUpgrades);
    const perm = safeProfile(msg.profile || msg.permanentProfile, initUp);
    room.players[emptySlot] = {
      slot: emptySlot,
      id: ws.playerId || id('P'),
      firebaseUid: String(msg.firebaseUid || ws.firebaseUid || '').trim() || null,
      name: cleanName(msg.name || ws.playerName),
      skin: String(msg.skin || 'Classic').trim().slice(0, 32),
      ready: false,
      connected: true,
      forfeited: false,
      reconnectToken: rToken,
      maxSpeed: clampInt(msg.maxSpeed, 1, 10, 1),
      unlocks: safeUnlocks(msg.unlocks),
      stats: safeStats(msg.stats),
      initialUpgrades: initUp,
      permanent: perm,
      startingCash: clampInt(msg.startingCash, 0, 1e9, perm.effects.startupCash || 80),
      allowedUpgrades: safeAllowedUpgrades(msg.allowedUpgrades),
      up: Array(UPS.length).fill(0),
      purchased: Array(UPS.length).fill(0),
      cash: clampInt(msg.startingCash, 0, 1e9, perm.effects.startupCash || 80),
      ws,
      disconnectTimer: null
    };
    ws.roomCode = room.code;
    ws.room = room;
    ws.slot = emptySlot;
    room.lastActive = Date.now();
    clampRoomStageToPlayers(room);
    send(ws, { type: 'joined', roomCode: room.code, code: room.code, slot: emptySlot, reconnectToken: rToken, state: lobbyState(room) });
    broadcast(room, { type: 'lobby', state: lobbyState(room) });
    saveRooms();
    return;
  }

  if (msg.type === 'reconnect_room') {
    const code = String(msg.code || msg.roomCode || '').trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) { send(ws, { type: 'error', message: 'Room expired' }); return; }
    const reqToken = String(msg.reconnectToken || '').trim();
    if (!reqToken) { send(ws, { type: 'error', message: 'Reconnect token required' }); return; }
    const p = room.players.find(x => x && !x.forfeited && x.reconnectToken === reqToken);
    if (!p) { send(ws, { type: 'error', message: 'Reconnect token invalid' }); return; }
    clearTimeout(p.disconnectTimer);
    p.disconnectTimer = null;
    p.connected = true;
    p.ws = ws;
    ws.roomCode = room.code;
    ws.room = room;
    ws.slot = p.slot;
    room.lastActive = Date.now();
    syncRoomSpeedCap(room);
    send(ws, { type: 'reconnected', roomCode: room.code, code: room.code, slot: p.slot, state: snapshot(room) });
    broadcast(room, { type: 'player_status', slot: p.slot, connected: true, forfeited: false, players: lobbyState(room).players });
    saveRooms();
    return;
  }

  const room = rooms.get(ws.roomCode) || ws.room;
  if (!room) return;
  room.lastActive = Date.now();
  const p = room.players[ws.slot];
  if (!p) return;

  if (msg.type === 'restart_lobby' && room) {
    if (room.ended || (room.game && room.game.reason)) {
      if (room.tickTimer) {
        clearInterval(room.tickTimer);
        room.tickTimer = null;
      }
      room.started = false;
      room.ended = false;
      room.game = null;
      room.resultIds = {};
      room.players.forEach(p => {
        if (!p) return;
        p.ready = false;
        p.hp = 0;
        p.maxhp = 0;
        p.shields = 0;
        p.cash = 0;
        p.up = Array(UPS.length).fill(0);
        p.purchased = Array(UPS.length).fill(0);
        p.kills = 0;
        p.damage = 0;
      });
      room.lastActive = Date.now();
      broadcast(room, { type: 'lobby', state: lobbyState(room), restarted: true });
      saveRooms();
    }
    return;
  }

  if (msg.type === 'ready') {
    p.ready = msg.ready !== undefined ? !!msg.ready : !p.ready;
    if (msg.idToken) {
      verifyFirebaseAuthToken(msg.idToken).then(v => {
        if (v && v.uid) {
          if (p.firebaseUid && p.firebaseUid !== v.uid) {
            send(ws, { type: 'error', code: 'identity_tampering', message: 'Cannot alter verified Firebase UID' });
            return;
          }
          p.firebaseUid = v.uid;
        } else {
          send(ws, { type: 'error', code: 'invalid_token', message: 'Firebase token verification failed' });
        }
      }).catch(() => {});
    } else if (msg.firebaseUid) {
      const candidateUid = String(msg.firebaseUid).trim();
      if (p.firebaseUid && p.firebaseUid !== candidateUid) {
        send(ws, { type: 'error', code: 'identity_tampering', message: 'Cannot alter bound Firebase identity' });
        return;
      }
      if (!p.firebaseUid && process.env.NODE_ENV !== 'production') {
        p.firebaseUid = candidateUid;
      }
    }
    if (msg.skin) p.skin = String(msg.skin).trim().slice(0, 32);
    if (msg.stats) p.stats = safeStats(msg.stats);
    if (msg.initialUpgrades) p.initialUpgrades = safeInitialUpgrades(msg.initialUpgrades);
    if (msg.profile || msg.permanentProfile) p.permanent = safeProfile(msg.profile || msg.permanentProfile, p.initialUpgrades);
    if (msg.startingCash !== undefined) p.startingCash = clampInt(msg.startingCash, 0, 1e9, p.permanent?.effects?.startupCash || 80);
    if (msg.allowedUpgrades) p.allowedUpgrades = safeAllowedUpgrades(msg.allowedUpgrades);
    if (msg.maxSpeed) p.maxSpeed = clampInt(msg.maxSpeed, 1, 10, 1);
    if (msg.unlocks) { p.unlocks = safeUnlocks(msg.unlocks); clampRoomStageToPlayers(room); }
    broadcast(room, { type: 'lobby', state: lobbyState(room) });
    startGame(room, undefined, undefined, true);
    return;
  }

  if (msg.type === 'start') {
    startGame(room, undefined, undefined, true);
    return;
  }

  if (msg.type === 'select_stage' && ws.slot === 0 && !room.started) {
    const nextMap = clampInt(msg.map, 1, 10, room.map);
    const nextDiff = clampInt(msg.diff, 0, DIFF_MULT.length - 1, room.diff);
    if (!roomUnlockedForAll(room, nextMap, nextDiff)) {
      send(ws, { type: 'error', message: 'Stage locked for at least one player' });
      return;
    }
    room.map = nextMap;
    room.diff = nextDiff;
    broadcast(room, { type: 'lobby', state: lobbyState(room) });
    return;
  }

  if (msg.type === 'set_target_priority' && room.started && room.game) {
    if (Core.TARGET_PRIORITY_MODES.includes(msg.priority)) {
      p.targetPriority = msg.priority;
      if (room.game.towers && room.game.towers[ws.slot]) {
        room.game.towers[ws.slot].targetPriority = msg.priority;
      }
      broadcast(room, { type: 'state', state: snapshot(room) });
    }
    return;
  }

  if (msg.type === 'upgrade' && room.started && room.game) {
    const batch = msg.batch === 'max' ? 'max' : clampInt(msg.batch, 1, 1000, 1);
    if (upgrade(room, ws.slot, clampInt(msg.index, -1, UPS.length, -1), batch)) {
      broadcast(room, { type: 'state', state: snapshot(room) });
    }
    return;
  }

  if (msg.type === 'set_speed' && room.started && room.game) {
    const commonMax = getRoomMaxSpeed(room);
    const curSpd = room.game.speed || room.speed || 1;
    let targetSpeed;
    if (msg.action === 'plus') {
      targetSpeed = Math.min(commonMax, curSpd + 1);
    } else if (msg.action === 'minus') {
      targetSpeed = Math.max(1, curSpd - 1);
    } else {
      const parsed = Math.round(Number(msg.speed) || 1);
      if (parsed < 1) {
        send(ws, { type: 'error', message: 'Pause not allowed in CO-OP' });
        return;
      }
      targetSpeed = Math.max(1, Math.min(commonMax, parsed));
    }
    room.game.speed = targetSpeed;
    room.speed = targetSpeed;
    broadcast(room, { type: 'speed_changed', speed: room.game.speed, by: ws.slot, maxSpeed: commonMax });
    broadcast(room, { type: 'state', state: snapshot(room) });
    return;
  }

  if (msg.type === 'leave_room') {
    leaveRoom(ws, 'player_left');
  }
}

wss.on('connection', ws => {
  ws.alive = true;
  ws.on('pong', () => { ws.alive = true; });
  ws.on('close', () => handleDisconnect(ws));
  ws.on('error', () => {});
  ws.on('message', raw => onMessage(ws, raw));
});

let lastTick = Date.now();
let lastSnap = Date.now();
let lastPeriodicSave = Date.now();
const tickTimer = setInterval(() => {
  const now = Date.now();
  const dt = (now - lastTick) / 1000;
  lastTick = now;
  const sendSnap = now - lastSnap >= SNAPSHOT_MS;
  if (sendSnap) lastSnap = now;
  if (now - lastPeriodicSave >= 5000) {
    lastPeriodicSave = now;
    if (rooms.size > 0) saveRooms();
  }

  for (const [code, room] of rooms) {
    if (now - room.lastActive > ROOM_IDLE_MS) {
      finish(room, 'idle_timeout');
      rooms.delete(code);
      saveRooms();
      continue;
    }
    if (!room.started || !room.game || room.ended) continue;
    tick(room.game, dt);
    if (room.game.over) {
      finish(room, room.game.reason);
      rooms.delete(code);
      saveRooms();
    } else {
      if (room.game.wave !== room._lastSavedWave) {
        room._lastSavedWave = room.game.wave;
        saveRooms();
      }
      if (sendSnap) {
        broadcast(room, { type: 'state', state: snapshot(room) });
      }
    }
  }
}, TICK_MS);
if (tickTimer && typeof tickTimer.unref === 'function') tickTimer.unref();

const heartbeatTimer = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.alive === false) { ws.terminate(); continue; }
    ws.alive = false;
    try { ws.ping(); } catch (e) {}
  }
}, HEARTBEAT_MS);
if (heartbeatTimer && typeof heartbeatTimer.unref === 'function') heartbeatTimer.unref();

function gracefulShutdown(signal) {
  console.log(`[SERVER] Received ${signal}. Flushing active rooms, accounts, and rewards to disk...`);
  try { saveRooms(true); } catch (e) {}
  try { saveRewards(true); } catch (e) {}
  try { saveDB(true); } catch (e) {}
  console.log('[SERVER] Persistence flush complete. Exiting gracefully.');
  process.exit(0);
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Infinite Tower CO-OP server (${Core.VERSION}) listening on :${PORT}`);
  });
}

module.exports = {
  server,
  rooms,
  Core,
  tick,
  startGame,
  finish,
  snapshot,
  onMessage,
  onClose: handleDisconnect,
  handleDisconnect,
  saveRooms,
  loadRooms,
  serializeRooms: saveRooms,
  db,
  rewardsDb,
  saveRewards,
  loadRewards,
  verifyFirebaseAuthToken,
  registerTestPublicKey,
  setFirestoreInstance,
  loadSocialFromFirestore,
  syncSocialToFirestore,
  getFirestoreInstance,
  executeFirestoreRewardTransaction,
  syncRoomsToFirestore,
  loadRoomsFromFirestore,
  restoreRoomsFromFirestore,
  reconstructRoom,
  atomicWriteFileSync
};
