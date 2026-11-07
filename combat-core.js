(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.InfiniteTowerCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this), function() {
  'use strict';

  const VERSION = '2.1.4-unified';

  const STARTER_UPGRADES = [0, 1, 2, 3, 4, 6, 7, 8, 12, 13, 17, 18, 19, 21, 27];
  const STARTER_UPGRADES_SET = new Set(STARTER_UPGRADES);
  const WAVE_100_UPGRADES = [29, 30, 31, 32, 38, 39, 40];
  const WAVE_100_UPGRADES_SET = new Set(WAVE_100_UPGRADES);
  const RETIRED_UPGRADES_SET = new Set([26, 28, 33, 34]);

  const STARTER_RESEARCH_NAMES = [
    'Damage',
    'Max HP',
    'Regeneration',
    'Critical Chance',
    'Critical Damage',
    'Defense %',
    'Absolute Defense',
    'Armor',
    'Cash / Kill',
    'Cash / Wave',
    'Coin / Kill',
    'Coin / Wave',
    'XP / Kill',
    'XP / Wave',
    'XP per Wave',
    'Startup Cash',
    'Attack Speed',
    'Range',
    'Game Speed',
    'Research Slots'
  ];
  const STARTER_RESEARCH_SET = new Set(STARTER_RESEARCH_NAMES);

  const FEATURE_UNLOCKS = [
    { key: 'multishot', name: 'Multishot', cost: 180, reqWave: 100, up: [5, 35], lab: ['Multishot', 'Multishot Chance', 'Multishot Count'], desc: 'Unlocks Multishot Chance & Count in Workshop, Run and Lab.' },
    { key: 'rapid', name: 'Rapid Fire', cost: 220, reqWave: 100, up: [9, 37], lab: ['Rapid Fire', 'Rapid Fire Chance'], desc: 'Unlocks Rapid Fire Chance & Duration in Workshop, Run and Lab.' },
    { key: 'bounce', name: 'Bounce Shot', cost: 260, reqWave: 100, up: [10, 36], lab: ['Bounce Shot', 'Bounce Shot Chance', 'Bounce Chance', 'Bounce Count'], desc: 'Unlocks Bounce Shot Chance & Targets in Workshop, Run and Lab.' },
    { key: 'slow', name: 'Slow Aura', cost: 240, reqWave: 100, up: [], lab: ['Slow Aura', 'Slow Chance', 'Slow Amount', 'Slow Duration'], desc: 'Unlocks Slow in Lab.' },
    { key: 'armorpen', name: 'Armor Penetration', cost: 240, reqWave: 100, up: [11], lab: ['Armor Penetration'], desc: 'Unlocks Armor Penetration in Workshop, Run and Lab.' },
    { key: 'thorns', name: 'Thorns', cost: 260, reqWave: 100, up: [14], lab: ['Thorns'], desc: 'Unlocks Thorns in Workshop, Run and Lab.' },
    { key: 'lifesteal', name: 'Lifesteal', cost: 320, reqWave: 100, up: [15], lab: ['Lifesteal'], desc: 'Unlocks Lifesteal in Workshop, Run and Lab.' },
    { key: 'shield', name: 'Energy Shield', cost: 380, reqWave: 100, up: [16], lab: ['Energy Shield', 'Shield Strength', 'Shield Regeneration'], desc: 'Unlocks Energy Shield in Workshop, Run and Lab.' },
    { key: 'interest', name: 'Interest', cost: 340, reqWave: 100, up: [20], lab: ['Interest'], desc: 'Unlocks Interest in Workshop, Run and Lab.' },
    { key: 'knockback', name: 'Knockback', cost: 300, reqWave: 100, up: [22], lab: ['Knockback', 'Knockback Chance', 'Knockback Force'], desc: 'Unlocks Knockback in Workshop, Run and Lab.' },
    { key: 'priority', name: 'Target Priority', cost: 420, reqWave: 100, up: [23], lab: ['Target Priority', 'Orbs'], desc: 'Unlocks Target Priority in Unique Lab.' },
    { key: 'burst', name: 'Burst Fire', cost: 460, reqWave: 100, up: [24, 25], lab: ['Burst Size', 'Burst Interval', 'Burst Chance', 'Burst Count'], desc: 'Unlocks Burst Chance & Count in Workshop, Run and Lab.' }
  ];

  function getBestWaveFromState(state) {
    if (!state) return 0;
    if (typeof state.bestWave === 'number') return state.bestWave;
    if (typeof state.bestWave === 'function') return Number(state.bestWave()) || 0;
    if (state.records && typeof state.records === 'object') {
      const vals = Object.values(state.records).map(Number).filter(Number.isFinite);
      return vals.length ? Math.max(0, ...vals) : 0;
    }
    return 0;
  }

  function getWorkshopLevelFromState(i, state) {
    if (!state) return 0;
    if (typeof state.workshopLevel === 'function') return Number(state.workshopLevel(i)) || 0;
    const w = state.workshop || state.workshopLevels;
    return w ? (Number(w[i]) || 0) : 0;
  }

  function getWorkshopLabLevelFromState(i, state) {
    if (!state) return 0;
    if (typeof state.workshopLabLevel === 'function') return Number(state.workshopLabLevel(i)) || 0;
    const ll = state.labLevels;
    if (!ll) return 0;
    const k = 'w_' + i;
    if (ll[k] !== undefined) return Number(ll[k]) || 0;
    return 0;
  }

  function featureForUpgrade(i) {
    const idx = Number(i);
    return FEATURE_UNLOCKS.find(f => f.up.includes(idx)) || null;
  }

  function featureForResearch(name) {
    const n = String(name || '');
    return FEATURE_UNLOCKS.find(f => f.lab.includes(n)) || null;
  }

  function featureOwned(fOrKey, state) {
    const f = typeof fOrKey === 'string' ? FEATURE_UNLOCKS.find(x => x.key === fOrKey) : fOrKey;
    if (!f) return true;
    const fu = state && state.featureUnlocks ? state.featureUnlocks : {};
    if (fu[f.key]) return true;
    return f.up.some(u => getWorkshopLevelFromState(u, state) > 0 || getWorkshopLabLevelFromState(u, state) > 0);
  }

  function featureUnlocked(fOrKey, state) {
    const f = typeof fOrKey === 'string' ? FEATURE_UNLOCKS.find(x => x.key === fOrKey) : fOrKey;
    if (!f) return false;
    if (featureOwned(f, state)) return true;
    return getBestWaveFromState(state) >= (f.reqWave || 100);
  }

  function upgradeRequirement(i) {
    const idx = Number(i);
    if (RETIRED_UPGRADES_SET.has(idx) || idx < 0 || idx >= UPS.length) return Infinity;
    if (STARTER_UPGRADES_SET.has(idx)) return 0;
    if (WAVE_100_UPGRADES_SET.has(idx)) return 100;
    const f = featureForUpgrade(idx);
    if (f) return f.reqWave || 100;
    return 100;
  }

  function upgradeVisible(i, state, context) {
    const idx = Number(i);
    if (RETIRED_UPGRADES_SET.has(idx) || idx < 0 || idx >= UPS.length) return false;
    if (idx === 23) return context === 'lab';
    if (context === 'workshop' && idx === 40) return false;
    if (context === 'run' && (idx === 38 || idx === 39)) return false;
    const f = featureForUpgrade(idx);
    if (!f) return true;
    return featureOwned(f, state);
  }

  function upgradeUnlocked(i, state, context) {
    const idx = Number(i);
    if (!upgradeVisible(idx, state, context)) return false;
    if (getWorkshopLevelFromState(idx, state) > 0 || getWorkshopLabLevelFromState(idx, state) > 0) return true;
    const f = featureForUpgrade(idx);
    if (f) return featureOwned(f, state);
    const req = upgradeRequirement(idx);
    return getBestWaveFromState(state) >= req;
  }

  function researchRequirement(m) {
    if (!m) return 100;
    const name = typeof m === 'string' ? m : (m.name || '');
    const kind = typeof m === 'object' ? m.kind : '';
    const cat = typeof m === 'object' ? m.cat : '';
    const id = typeof m === 'object' && typeof m.id === 'number' ? m.id : 999;
    const upIdx = typeof m === 'object' && typeof m.up === 'number' ? m.up : -1;
    if (kind === 'slots' || kind === 'gamespeed' || STARTER_RESEARCH_SET.has(name) || (kind === 'legacy' && id < 6)) return 0;
    if (kind === 'workshop' && (STARTER_UPGRADES_SET.has(upIdx) || upIdx === 39)) return 0;
    if (kind === 'workshop' && featureForUpgrade(upIdx)) return 0;
    if (kind === 'final' && (['Slow Chance', 'Multishot Chance', 'Startup Cash', 'XP per Wave', 'Research Speed', 'Research Cost'].includes(name) || featureForResearch(name))) return 0;
    if (kind === 'final' || kind === 'workshop') return 100;
    if (cat === 'Ultimate Weapons' || cat === 'Automation' || cat === 'Cards & Perks') return 500;
    if (cat === 'Technology' || cat === 'Enemies' || kind === 'modifier') return 250;
    return 100;
  }

  function researchVisible(mOrName, state) {
    if (!mOrName) return false;
    const name = typeof mOrName === 'string' ? mOrName : (mOrName.name || '');
    const displayName = typeof mOrName === 'object' && mOrName.displayName ? mOrName.displayName : name;
    if (name === 'Projectile Speed' || name === 'Projectile Velocity' || displayName === 'Projectile Speed') return false;
    if (typeof mOrName === 'object' && typeof mOrName.up === 'number') {
      if (RETIRED_UPGRADES_SET.has(mOrName.up)) return false;
      const fUp = featureForUpgrade(mOrName.up);
      if (fUp && !featureOwned(fUp, state)) return false;
    }
    const f = featureForResearch(name) || featureForResearch(displayName);
    if (!f) return true;
    return featureOwned(f, state);
  }

  function researchUnlocked(m, state) {
    if (!m) return false;
    if (!researchVisible(m, state)) return false;
    if (typeof m === 'object' && m.key && state && state.labLevels && Number(state.labLevels[m.key]) > 0) return true;
    if (typeof m === 'object' && typeof m.id === 'number' && state && Array.isArray(state.researches) && state.researches.includes(m.id)) return true;
    return getBestWaveFromState(state) >= researchRequirement(m);
  }

  // Percentage scaling: permanent Workshop/Lab levels and per-run levels use these same curves.
  // Levels already stored in saves remain unchanged. Discrete upgrades (extra shots, shields)
  // and intentionally absolute mechanics (absolute defense) are not converted into percentages.
  const SCALING = Object.freeze({
    damage: 0.10,
    attackSpeed: 0.08,
    rapidFire: 0.04,
    maxHp: 0.12,
    regenHpPerSecond: 0.01
  });

  function percentLevels(level, rate) {
    const n = Math.max(0, Number(level) || 0);
    // First 20 levels: meaningful growth. After that, controlled percentage growth
    // avoids astronomical stats in a 5,000-wave game.
    const tail = rate === SCALING.damage ? 0.022
      : rate === SCALING.attackSpeed ? 0.012
      : rate === SCALING.rapidFire ? 0.010
      : rate === SCALING.maxHp ? 0.022
      : rate * 0.15;
    return Math.pow(1 + rate, Math.min(n, 20)) * Math.pow(1 + tail, Math.max(0, n - 20));
  }

  // Shared deterministic state transition for a temporary rapid-fire burst.
  // Call once per normal attack; pass a random roll in [0,1).
  function rapidFireTrigger(state, chance, roll, duration = 1.5) {
    const remaining = Math.max(0, Number(state) || 0);
    const probability = Math.min(1, Math.max(0, Number(chance) || 0));
    const random = Number(roll);
    if (!Number.isFinite(random) || random < 0 || random >= 1) return { remaining, triggered: false };
    const triggered = random < probability;
    return { remaining: triggered ? Math.max(remaining, duration) : remaining, triggered };
  }

  function maxHp(baseHp, level) {
    return Math.max(1, baseHp) * percentLevels(level, SCALING.maxHp);
  }

  function interestRate(level) {
    return Math.min(0.20, Math.max(0, Math.floor(Number(level) || 0)) * 0.01);
  }

  function interestCash(cash, level) {
    return Math.max(0, Number(cash) || 0) * interestRate(level);
  }

  // Official 41 upgrades from SOLO 2.1.3 (with V56 combat caps aligned)
  const UPS = [
    ['Damage', 20, 1.16, 'Offense'],
    ['Attack Speed', 25, 1.18, 'Offense'],
    ['Max HP', 20, 1.17, 'Defense'],
    ['Regeneration', 30, 1.19, 'Defense', 20],
    ['Critical Chance', 50, 1.23, 'Offense', 40],
    ['Multishot', 300, 3, 'Offense', 6],
    ['Cash / Kill', 35, 1.22, 'Economy'],
    ['Range', 40, 1.2, 'Offense'],
    ['Critical Damage', 65, 1.20, 'Offense'],
    ['Rapid Fire', 100, 1.23, 'Offense'],
    ['Bounce Shot', 400, 1.35, 'Offense', 5],
    ['Armor Penetration', 650, 1.32, 'Offense', 100000],
    ['Defense %', 55, 1.22, 'Defense', 20],
    ['Absolute Defense', 35, 1.18, 'Defense'],
    ['Thorns', 130, 1.28, 'Defense', 20],
    ['Lifesteal', 450, 1.32, 'Offense', 72],
    ['Energy Shield', 900, 1.5, 'Defense', 1],
    ['Cash / Wave', 70, 1.19, 'Economy'],
    ['Coin / Kill', 80, 1.22, 'Economy'],
    ['Coin / Wave', 85, 1.20, 'Economy'],
    ['Interest', 120, 1.3, 'Economy', 20],
    ['XP / Kill', 110, 1.25, 'Economy'],
    ['Knockback', 180, 1.25, 'Utility', 30],
    ['Target Priority', 250, 1.35, 'Utility', 1],
    ['Burst Chance', 300, 1.25, 'Offense', 40],
    ['Burst Count', 1200, 1.8, 'Offense', 4],
    ['Retired Burst Damage', 450, 1.3, 'Retired'],
    ['XP / Wave', 130, 1.24, 'Economy'],
    ['Startup Cash', 85, 1.2, 'Economy'],
    ['Offense Free Upgrade', 250, 1.3, 'Utility'],
    ['Defense Free Upgrade', 250, 1.3, 'Utility'],
    ['Utility Free Upgrade', 250, 1.3, 'Utility'],
    ['Economy Free Upgrade', 250, 1.3, 'Utility'],
    ['Projectile Speed', 150, 1.2, 'Offense'],
    ['Burst Chance', 300, 1.25, 'Offense', 25],
    ['Multishot Chance', 300, 1.25, 'Offense', 40],
    ['Bounce Shot Chance', 300, 1.25, 'Offense', 40],
    ['Rapid Fire Chance', 300, 1.25, 'Offense', 50],
    ['Life on Wave End', 350, 1.25, 'Defense', 50],
    ['Startup Cash', 150, 1.25, 'Economy'],
    ['Life on Wave End (Run)', 350, 1.25, 'Defense', 100],
    ['Overcrit Chance', 400, 1.25, 'Offense', 40],
    ['Overcrit Damage', 500, 1.25, 'Offense', 40]
  ];

  const UPGRADES = Object.freeze(UPS.map((u, i) => Object.freeze({
    id: i,
    name: u[0],
    cost: u[1],
    growth: u[2],
    cat: u[3],
    max: u[4] ?? 1000
  })));

  const WORKSHOP_CAPS = Object.freeze({
    0: 5000, 1: 100, 2: 5000, 3: 10, 4: 20, 5: 3, 6: 5000, 7: 100, 8: 500, 9: 100, 10: 5,
    11: 100, 12: 10, 13: 5000, 14: 20, 15: 100, 16: 1, 17: 5000, 18: 5000, 19: 5000, 20: 10,
    21: 5000, 22: 30, 23: 0, 24: 20, 25: 4, 26: 0, 27: 5000, 28: 0,
    29: 50, 30: 50, 31: 50, 32: 50,
    33: 0, 34: 0, 35: 20, 36: 20, 37: 20, 38: 50, 39: 500, 40: 0,
    41: 20, 42: 20
  });

  const LAB_CAPS = Object.freeze({
    0: 5000, 1: 100, 2: 5000, 3: 10, 4: 20, 5: 3, 6: 5000, 7: 100, 8: 500, 9: 100, 10: 5,
    11: 100, 12: 10, 13: 5000, 14: 20, 15: 100, 16: 1, 17: 5000, 18: 5000, 19: 5000, 20: 10,
    21: 5000, 22: 30, 23: 1, 24: 20, 25: 4, 26: 0, 27: 5000, 28: 0,
    29: 50, 30: 50, 31: 50, 32: 50,
    33: 0, 34: 0, 35: 20, 36: 20, 37: 20, 38: 50, 39: 500, 40: 0,
    41: 20, 42: 20
  });

  // Canonical shared Workshop & Lab upgrade definitions per category (excluding Projectile Speed #33 and Lab-only Target Priority #23)
  const UNIFIED_CATEGORY_UPGRADES = Object.freeze({
    Offense: Object.freeze([0, 1, 7, 4, 8, 24, 25, 5, 35, 9, 37, 10, 36, 11, 15, 41, 42]),
    Defense: Object.freeze([2, 3, 12, 13, 14, 16, 38]),
    Utility: Object.freeze([22, 29, 30, 31, 32]),
    Economy: Object.freeze([6, 17, 18, 19, 20, 39, 21, 27])
  });

  // 5th Lab-only category: Unique researches and one-time unlocks
  const LAB_UNIQUE_ITEMS = Object.freeze([
    'Game Speed',
    'Research Slots',
    'Research Speed',
    'Research Cost',
    'Target Priority',
    'Shield Regeneration',
    'Slow Chance',
    'Slow Amount',
    'Slow Duration',
    'Stun Chance',
    'Stun Duration',
    'Knockback Chance'
  ]);

  function maxLevel(i) { return UPGRADES[i]?.max ?? 0; }
  function maxUpgradeLevel(index) { return UPGRADES[index]?.max ?? 0; }
  function workshopCap(i) { return WORKSHOP_CAPS[i] ?? (i === 11 ? 100000 : maxUpgradeLevel(i)); }
  function labCap(i) { return LAB_CAPS[i] ?? (i === 11 ? 100000 : maxUpgradeLevel(i)); }

  function canUpgrade(index, level) {
    if (!Number.isInteger(index) || index < 0 || index >= UPGRADES.length) return false;
    const m = maxUpgradeLevel(index);
    if (m >= 1000) return true;
    return Number(level) < m;
  }

  function cost(i, lv) {
    const u = UPGRADES[i];
    if (!u || !Number.isFinite(lv) || lv < 0 || !Number.isInteger(lv)) return Number.MAX_SAFE_INTEGER;
    const max = maxUpgradeLevel(i);
    if (max >= 1000) {
      const t1 = Math.min(lv, 20);
      const t2 = Math.max(0, Math.min(lv - 20, 180));
      const t3 = Math.max(0, lv - 200);
      const rate1 = Math.log(u.growth);
      const rate2 = rate1 * 0.25;
      const rate3 = rate1 * 0.05;
      const logVal = Math.log(u.cost) + t1 * rate1 + t2 * rate2 + t3 * rate3;
      if (!Number.isFinite(logVal) || logVal >= Math.log(Number.MAX_SAFE_INTEGER)) return Number.MAX_SAFE_INTEGER;
      return Math.min(Number.MAX_SAFE_INTEGER, Math.max(1, Math.ceil(Math.exp(logVal))));
    }
    // Clamp before exponentiation: never create Infinity, NaN, or imprecise unpayable prices.
    const logCost = Math.log(u.cost) + lv * Math.log(u.growth);
    if (!Number.isFinite(logCost) || logCost > Math.log(Number.MAX_SAFE_INTEGER)) return Number.MAX_SAFE_INTEGER;
    return Math.min(Number.MAX_SAFE_INTEGER, Math.max(1, Math.ceil(Math.exp(logCost))));
  }

  const BATCH_DISCOUNT_FACTOR = 0.90;

  function isDiscountedBatchSize(batch) {
    const n = Number(batch);
    return n === 10 || n === 100;
  }

  function discountedLevelPrice(rawPrice, batch) {
    const p = Number(rawPrice);
    if (!Number.isFinite(p) || p >= Number.MAX_SAFE_INTEGER) return Number.MAX_SAFE_INTEGER;
    if (isDiscountedBatchSize(batch)) {
      return Math.max(1, Math.floor(p * BATCH_DISCOUNT_FACTOR));
    }
    return Math.max(1, Math.ceil(p));
  }

  function batchUpgradeQuote(priceFn, startLevel, maxCap, requestedBatch, availableCurrency = Infinity) {
    const discountApplied = isDiscountedBatchSize(requestedBatch);
    const curStart = Math.max(0, Math.floor(Number(startLevel) || 0));
    const cap = Number.isFinite(Number(maxCap)) ? Math.max(0, Math.floor(Number(maxCap))) : 100000;
    const isMultiFixed = (requestedBatch === 10 || requestedBatch === 100 || requestedBatch === '10' || requestedBatch === '100');
    const limit = requestedBatch === 'max'
      ? Math.max(0, cap - curStart)
      : Math.max(1, Math.floor(Number(requestedBatch) || 1));
    const wallet = Number.isFinite(Number(availableCurrency)) ? Math.max(0, Number(availableCurrency)) : Infinity;

    // Règle du tout ou rien pour x10 et x100 (#15) : si les niveaux restants avant cap sont inférieurs au lot demandé
    if (isMultiFixed && (cap - curStart) < limit) {
      return {
        count: 0,
        totalCost: 0,
        rawCost: 0,
        discountApplied: false,
        allOrNothingFailed: true
      };
    }

    let count = 0;
    let totalCost = 0;
    let rawCost = 0;
    let curLv = curStart;

    while (count < limit && curLv < cap) {
      const unitRaw = priceFn(curLv);
      if (!Number.isFinite(unitRaw) || unitRaw >= Number.MAX_SAFE_INTEGER) break;
      const unitPrice = discountedLevelPrice(unitRaw, requestedBatch);
      if (totalCost + unitPrice > wallet) break;
      rawCost += unitRaw;
      totalCost += unitPrice;
      curLv++;
      count++;
    }

    // Règle du tout ou rien pour x10 et x100 (#15) : si le Cash ne permet pas de payer l'intégralité du lot
    if (isMultiFixed && count < limit) {
      return {
        count: 0,
        totalCost: 0,
        rawCost: 0,
        discountApplied: false,
        allOrNothingFailed: true
      };
    }

    return {
      count,
      totalCost,
      rawCost,
      discountApplied: discountApplied && count > 0,
      discountFactor: discountApplied ? BATCH_DISCOUNT_FACTOR : 1,
      nextLevel: curLv
    };
  }

  const TYPES = Object.freeze([
    Object.freeze({ name: 'Melee', color: '#7fd3ff', hp: 1, speed: 1 }),
    Object.freeze({ name: 'Runner', color: '#c3f38d', hp: 0.65, speed: 1.7 }),
    Object.freeze({ name: 'Tank', color: '#faad74', hp: 4, speed: 0.65 }),
    Object.freeze({ name: 'Ranged', color: '#d39bff', hp: 1.4, speed: 0.9 }),
    Object.freeze({ name: 'Boss', color: '#ff607e', hp: 30, speed: 0.5 })
  ]);

  const DIFFS = Object.freeze(['Easy', 'Normal', 'Hard', 'Extreme', 'Impossible']);
  const DIFF_MULT = Object.freeze([1, 3, 9, 27, 81]);

  // Slots 0..3: North, South, East, West
  const TOWER_POSITIONS = Object.freeze([
    Object.freeze({ x: 0, y: -35, dir: 'N', label: 'Nord' }),
    Object.freeze({ x: 0, y: 35, dir: 'S', label: 'Sud' }),
    Object.freeze({ x: 35, y: 0, dir: 'E', label: 'Est' }),
    Object.freeze({ x: -35, y: 0, dir: 'W', label: 'Ouest' })
  ]);

  // Official Booster definitions: 1 copy = 1 star, max 5 copies (5 stars), Crit Chance = +1% per star (max +5%)
  // Card #12 (projectileSpeed) is permanently retired and fused into Card #1 (Attack Speed).
  const MAX_BOOSTER_COPIES = 5;
  const MAX_BOOSTER_STARS = 5;
  const BOOSTER_CARDS = Object.freeze([
    Object.freeze({ id: 0, key: 'dmg', name: 'Dégâts', icon: '⚔', stat: 'ATK +', gain: 0.02 }),
    Object.freeze({ id: 1, key: 'speed', name: 'Vitesse attaque', icon: '⚡', stat: 'ATK & PROJ SPD +', gain: 0.015 }),
    Object.freeze({ id: 2, key: 'range', name: 'Portée', icon: '◎', stat: 'RANGE +', gain: 0.015 }),
    Object.freeze({ id: 3, key: 'hp', name: 'PV', icon: '♥', stat: 'HP +', gain: 0.025 }),
    Object.freeze({ id: 4, key: 'regen', name: 'Régénération', icon: '✚', stat: 'REGEN +', gain: 0.025 }),
    Object.freeze({ id: 5, key: 'defense', name: 'Défense', icon: '⬡', stat: 'DEF +', gain: 0.02 }),
    Object.freeze({ id: 6, key: 'cash', name: 'Argent', icon: '＄', stat: 'CASH +', gain: 0.02 }),
    Object.freeze({ id: 7, key: 'coin', name: 'Pièces', icon: '◉', stat: 'COINS +', gain: 0.02 }),
    Object.freeze({ id: 8, key: 'crit', name: 'Chance critique', icon: '✦', stat: 'CRIT +', gain: 0.01 }),
    Object.freeze({ id: 9, key: 'critDamage', name: 'Dégâts critiques', icon: '✧', stat: 'CRIT DMG +', gain: 0.025 }),
    Object.freeze({ id: 10, key: 'damageReduction', name: 'Réduction dégâts', icon: '▣', stat: 'DMG RED +', gain: 0.01 }),
    Object.freeze({ id: 11, key: 'interest', name: 'Intérêts', icon: '↗', stat: 'INTEREST +', gain: 0.02 }),
    Object.freeze({ id: 12, key: 'projectileSpeed', name: 'Vitesse projectile', icon: '➤', stat: 'RETIRED', gain: 0, retired: true }),
    Object.freeze({ id: 13, key: 'shield', name: 'Bouclier', icon: '◇', stat: 'SHIELD +', gain: 0.02 }),
    Object.freeze({ id: 14, key: 'xp', name: 'XP', icon: '★', stat: 'XP +', gain: 0.02 }),
    Object.freeze({ id: 15, key: 'slow', name: 'Aura lente', icon: '◌', stat: 'SLOW +', gain: 0.01 })
  ]);
  const ACTIVE_BOOSTER_CARD_IDS = Object.freeze(BOOSTER_CARDS.filter(c => !c.retired).map(c => c.id));

  function computeBoosterBonuses(boosterProfile) {
    const p = boosterProfile || {};
    const cards = p.cards || {};
    const active = Array.isArray(p.active) ? p.active : [];
    const out = {};
    const seen = new Set();
    for (const raw of active.slice(0, 5)) {
      const i = Number(raw);
      if (!Number.isInteger(i) || i < 0 || i >= BOOSTER_CARDS.length || i === 12 || seen.has(i)) continue;
      const def = BOOSTER_CARDS[i];
      if (!def || def.retired) continue;
      seen.add(i);
      const owned = Math.max(0, Math.min(MAX_BOOSTER_COPIES, Math.floor(Number(cards[i] ?? cards[String(i)]) || 0)));
      if (!owned) continue;
      const lv = Math.min(MAX_BOOSTER_STARS, owned);
      out[def.key] = (out[def.key] || 0) + def.gain * lv;
    }
    return out;
  }

  const WAVE_DURATION_SECONDS = 10;
  const MAX_WAVE_CAP = 5000;
  const SPAWN_SAFETY_MARGIN = 20;

  // Étape 2: Vagues & Spawn
  // Curve calibrated to milestones: W1=10, W10=36, W30=200, W100=285, W500=395, W1000=400 (cap 400)
  const ENEMY_GROWTH_K = -Math.log(115 / 200) / 70; // ~0.00790647
  function waveTotalEnemies(wave) {
    const w = Math.max(1, Math.min(MAX_WAVE_CAP, Math.floor(Number(wave) || 1)));
    if (w <= 1) return 10;
    if (w <= 30) {
      return Math.round(10 + 1.25 * (w - 1) + 0.183 * Math.pow(w - 1, 2));
    }
    return Math.min(400, Math.round(400 - 200 * Math.exp(-ENEMY_GROWTH_K * (w - 30))));
  }

  // Packets size scaling: W1=1, W10=2, W30=3, W100=5, W500+=8
  function wavePacketSize(wave) {
    const w = Math.max(1, Math.min(MAX_WAVE_CAP, Math.floor(Number(wave) || 1)));
    if (w < 10) return 1;
    if (w < 30) return 2;
    if (w < 100) return 3;
    if (w < 500) return 5;
    return 8;
  }

  // Taille maximale d'un groupe simultané: Math.min(10, totalEnemies)
  function waveGroupSize(wave) {
    return wavePacketSize(wave);
  }

  // Rétrocompatibilité économique : limite le multiplicateur de récompenses par vague à 10 max
  function waveBatchCount(wave) {
    const w = Math.max(1, Math.min(MAX_WAVE_CAP, Math.floor(Number(wave) || 1)));
    return Math.min(10, 1 + Math.floor(w / 10));
  }

  // Décomposition échelonnée et régulière sur les 10 secondes
  function waveGroups(wave) {
    const w = Math.max(1, Math.min(MAX_WAVE_CAP, Math.floor(Number(wave) || 1)));
    const total = waveTotalEnemies(w);
    const first = waveBatchCount(w);
    const pSize = wavePacketSize(w);
    const groups = [first];
    let rem = total - first;
    while (rem > 0) {
      const g = Math.min(pSize, rem);
      groups.push(g);
      rem -= g;
    }
    return {
      wave: w,
      totalEnemies: total,
      groupSize: pSize,
      groups
    };
  }

  // Un groupe de taille 6..10 devient 1 Giant Enemy (pour les vagues >= 50)
  function isGiantGroup(wave, groupSize) {
    const w = Math.max(1, Math.min(MAX_WAVE_CAP, Math.floor(Number(wave) || 1)));
    return w >= 50 && groupSize >= 6 && groupSize <= 10;
  }

  function isGiantWave(wave) {
    const w = Math.max(1, Math.min(MAX_WAVE_CAP, Math.floor(Number(wave) || 1)));
    return w >= 50 && waveBatchCount(w) >= 6;
  }

  function waveTargetCount(wave) {
    const w = Math.max(1, Math.min(MAX_WAVE_CAP, Math.floor(Number(wave) || 1)));
    const { groups } = waveGroups(w);
    let count = 0;
    for (const g of groups) {
      count += isGiantGroup(w, g) ? 1 : g;
    }
    const bossEntities = (w % 10 === 0) ? 1 : 0;
    return count + bossEntities;
  }

  function waveSpawnInterval() {
    return WAVE_DURATION_SECONDS;
  }

  // Exact 360° spawn position outside ALL real tower attack ranges (#31, Q3)
  function computeSpawnPosition360(towers, angle, enemyRadius = 10, safetyMargin = SPAWN_SAFETY_MARGIN, extraJitter = 0) {
    const theta = Number.isFinite(Number(angle)) ? Number(angle) : 0;
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);
    const rEnemy = Math.max(0, Number(enemyRadius) || 10);
    const margin = Math.max(2, Number(safetyMargin) || SPAWN_SAFETY_MARGIN);
    const jitter = Math.max(0, Number(extraJitter) || 0);

    const activeList = Array.isArray(towers) && towers.length
      ? towers
      : [{ x: 0, y: 0, range: 110 }];

    let requiredDist = 0;
    for (let k = 0; k < activeList.length; k++) {
      const t = activeList[k];
      if (!t || (t.hp !== undefined && t.hp <= 0) || t.forfeited) continue;
      const xk = Number(t.x) || 0;
      const yk = Number(t.y) || 0;
      const rk = Math.max(60, Number(t.range) || 110);
      const minClearance = rk + rEnemy + margin;
      const bk = xk * cosT + yk * sinT;
      const ck2 = xk * xk + yk * yk;
      const disc = Math.max(0, minClearance * minClearance - ck2 + bk * bk);
      const dk = bk + Math.sqrt(disc);
      if (dk > requiredDist) requiredDist = dk;
    }

    if (requiredDist <= 0) {
      requiredDist = 110 + rEnemy + margin;
    }

    const d = requiredDist + jitter;
    return {
      x: cosT * d,
      y: sinT * d,
      dist: d,
      angle: theta
    };
  }

  function rollOrdinaryEnemyType(rng = Math.random) {
    const r1 = rng();
    if (r1 < 0.10) return 3;
    const r2 = rng();
    if (r2 < 0.18) return 2;
    if (rng() < 0.25) return 1;
    return 0;
  }

  function enemyStats({ wave, map = 1, diff = 0, type = 0 }) {
    const t = TYPES[type] || TYPES[0];
    const w = Math.max(1, Number(wave) || 1);
    const m = Math.max(1, Number(map) || 1);
    const d = Math.max(0, Math.min(DIFFS.length - 1, Number(diff) || 0));
    const baseAtk = (3.2 + 0.45 * Math.pow(w, 1.42)) * Math.pow(1.0055, Math.min(w, 500)) * Math.pow(1.0025, Math.max(0, w - 500));
    const baseHp = (18 + 2.4 * Math.pow(w, 1.48)) * Math.pow(1.0075, Math.min(w, 500)) * Math.pow(1.0035, Math.max(0, w - 500)) * t.hp;
    // Modification #34: Stage scaling = x2 per stage (2^(map-1)), Difficulty scaling = x11 per difficulty (11^diff)
    const mapMult = Math.pow(2, m - 1);
    const diffMult = Math.pow(11, d);
    return {
      hp: baseHp * mapMult * diffMult,
      spd: (15 + Math.min(40, w * 0.05)) * t.speed,
      atk: baseAtk * mapMult * diffMult
    };
  }

  // Priority 1: No bonus (base, Skill Tree, Achievements, Boosters, or Overcrit) may allow any chance to exceed 100% (1.0).
  function criticalHit(chance, multiplier, roll) {
    const capped = Math.min(1, Math.max(0, Number(chance) || 0));
    const r = Number.isFinite(Number(roll)) ? Number(roll) : 0;
    const guaranteed = Math.floor(capped);
    const fraction = capped - guaranteed;
    const tiers = guaranteed + (r < fraction ? 1 : 0);
    return { crit: tiers > 0, damageMultiplier: Math.pow(Math.max(1, multiplier), tiers), tiers };
  }

  function critRoll(chance, multiplier, rng = Math.random) {
    return criticalHit(chance, multiplier, typeof rng === 'function' ? rng() : Math.random());
  }

  // Refonte complète d'Overcrit (#24) :
  // 1. Calcul du Crit normal.
  // 2. Si le Crit échoue : dégâts normaux (multiplier = 1).
  // 3. Si le Crit réussit : appliquer Crit Damage.
  // 4. Seulement après un Crit réussi, calculer Overcrit Chance.
  // 5. Si Overcrit réussit : appliquer Overcrit Damage par-dessus le Crit (Crit Dmg * Overcrit Dmg).
  function calculateHitCritical(critChance, critMultiplier, overcritChance, overcritMultiplier, rng = Math.random) {
    const roll1 = typeof rng === 'function' ? rng() : Math.random();
    const cChance = Math.min(1, Math.max(0, Number(critChance) || 0));
    const cMult = Math.max(1, Number(critMultiplier) || 1);

    if (roll1 >= cChance) {
      return { isCrit: false, isOvercrit: false, multiplier: 1, tiers: 0 };
    }

    // Premier Crit réussi ! Tirage du second palier Overcrit
    const roll2 = typeof rng === 'function' ? rng() : Math.random();
    const ocChance = Math.min(1, Math.max(0, Number(overcritChance) || 0));
    const ocMult = Math.max(1, Number(overcritMultiplier) || 2);

    if (ocChance > 0 && roll2 < ocChance) {
      return { isCrit: true, isOvercrit: true, multiplier: cMult * ocMult, tiers: 2 };
    }

    return { isCrit: true, isOvercrit: false, multiplier: cMult, tiers: 1 };
  }

  function waveEndHealFraction(permanent, temporary) {
    return Math.min(1, Math.max(0, (Number(permanent) || 0) + (Number(temporary) || 0)));
  }

  // `base` includes permanent lab, workshop bonuses & Skill Tree; `up` is effective levels.
  function towerStats(up, base = {}, mod = {}) {
    const v = i => Math.max(0, Number(up?.[i]) || 0);
    const b = (key, d) => Number.isFinite(+base[key]) ? +base[key] : d;
    const m = key => Number.isFinite(+mod[key]) ? +mod[key] : 0;
    const speedVal = Math.min(35, 1.1 * percentLevels(v(1), SCALING.attackSpeed) * percentLevels(v(9), SCALING.rapidFire) * b('attackSpeed', 1.1) / 1.1);
    return {
      dmg: 15 * percentLevels(v(0), SCALING.damage) * b('damage', 15) / 15,
      range: b('range', 110) + 110 * v(7) * 0.08,
      speed: speedVal,
      projectileSpeed: Math.min(2500, Math.max(450, Math.round((450 + 8 * v(1)) * (b('attackSpeed', 1.1) / 1.1)))),
      regen: b('maxHp', 100) * Math.min(0.20, Math.min(20, v(3)) * SCALING.regenHpPerSecond) * (1 + m('regen')),
      defense: Math.min(0.75, Math.min(20, v(12)) * 0.01 * (1 + m('defense'))),
      absolute: v(13) * 0.35,
      thorns: Math.min(0.5, v(14) * 0.025),
      lifesteal: Math.min(0.5, v(15) * 0.007),
      critDamage: b('critDamage', 2) + v(8) * 0.15,
      crit: Math.min(1, Math.max(0, b('critChance', 0) + Math.min(40, v(4)) * 0.025)),
      multi: 1 + Math.min(6, v(5)) + b('extraMulti', 0),
      knockback: v(22) * 0.3,
      burstChance: Math.min(1, Math.max(0, Math.min(40, v(24) + v(34)) * 0.025)),
      burstCount: Math.min(6, 2 + v(25))
    };
  }

  // Camera zoom calculation based on attack range (#33 Dynamic Camera Zoom)
  // Continuous dezoom for EVERY range increase, framing the entire attack range with guaranteed screen margin, NO fixed zoom floor
  function computeCameraZoom({ range = 110, isCoop = false, towers = null, baseRange = 110 } = {}) {
    let effectiveRange = Math.max(baseRange, Number(range) || baseRange);
    if (isCoop) {
      if (Array.isArray(towers) && towers.length > 0) {
        let maxExtent = 0;
        for (const t of towers) {
          if (!t || t.forfeited || (t.hp !== undefined && t.hp <= 0)) continue;
          const dist = Math.hypot(Number(t.x) || 0, Number(t.y) || 0);
          const r = Math.max(baseRange, Number(t.range) || effectiveRange);
          if (dist + r > maxExtent) maxExtent = dist + r;
        }
        effectiveRange = maxExtent > 0 ? maxExtent : (35 + effectiveRange);
      } else {
        effectiveRange = 35 + effectiveRange;
      }
    }
    if (effectiveRange <= baseRange) return 1.0;
    // Normalized framing: circle expands gracefully from 33.8% of screen at R=110 towards ~72% at extreme R,
    // ensuring the attack range is ALWAYS 100% visible with a guaranteed >= 28% margin for incoming enemies,
    // strictly dezooming for every single +1 Range increase without any fixed floor clamp.
    const baseFraction = baseRange / 325;
    const targetMaxFraction = 0.72;
    const f = targetMaxFraction - (targetMaxFraction - baseFraction) * Math.pow(baseRange / effectiveRange, 0.60);
    const zoom = (325 * f) / effectiveRange;
    return Math.min(1.0, zoom);
  }

  function hpUpgrade(currentMax, currentHp, previousLevel, newLevel) {
    const ratio = percentLevels(newLevel, SCALING.maxHp) / percentLevels(previousLevel, SCALING.maxHp);
    const max = Math.max(1, currentMax) * ratio;
    return { max, hp: Math.min(max, Math.max(0, currentHp) + Math.max(0, max - currentMax)) };
  }

  function knockbackEnemy(enemy, level, random = Math.random) {
    const lv = Math.max(0, Number(level) || 0);
    if (lv === 0 || random() >= Math.min(0.6, lv * 0.04)) return false;
    const distance = Math.hypot(enemy.x, enemy.y) || 1;
    const giantMass = Math.max(1, Number(enemy?.giantFactor) || 1);
    const force = (lv * 0.3) / giantMass;
    enemy.x += (enemy.x / distance) * force;
    enemy.y += (enemy.y / distance) * force;
    return true;
  }

  function shieldCapacity(level) {
    return Math.max(0, Math.round(Number(level) || 0));
  }

  function absorbShield(shields, damage) {
    if (damage > 0 && shields > 0) return { shields: shields - 1, damage: 0, absorbed: damage };
    return { shields, damage, absorbed: 0 };
  }

  const NUMBER_UNITS = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc', 'Ud', 'Dd', 'Td', 'Qad', 'Qid'];

  function formatNumber(n) {
    if (!Number.isFinite(n)) return '∞';
    if (n === 0) return '0';
    const sign = n < 0 ? '-' : '';
    const abs = Math.abs(n);
    if (abs < 1000) {
      if (Math.abs(abs - Math.round(abs)) < 1e-4) return sign + Math.round(abs).toString();
      return sign + (Math.floor(abs * 100) / 100).toLocaleString('en-US');
    }
    const tier = Math.floor(Math.log10(abs) / 3);
    if (tier < NUMBER_UNITS.length) {
      const val = abs / Math.pow(1000, tier);
      const decimals = val < 10 ? 2 : 1;
      const str = Number(val.toFixed(decimals)).toString();
      return sign + str + NUMBER_UNITS[tier];
    }
    return n.toExponential(2);
  }

  // Each bounce picks a NEW living target within bounce range.
  // Rebounds target enemies closest to the firing tower (ox, oy) as validated (#39).
  function bounceHits(enemies, first, level, baseDamage, range = 125, ox = null, oy = null) {
    const hits = [];
    let previous = first;
    let damage = baseDamage;
    const seen = new Set([first]);
    const maxBounces = Math.min(5, Math.floor(Math.max(0, level)));
    const r2 = range * range;

    for (let i = 0; i < maxBounces; i++) {
      let closest = null;
      let bestScore = Infinity;
      for (const e of enemies) {
        if (!e || e.hp <= 0 || seen.has(e)) continue;
        const dx = e.x - previous.x;
        const dy = e.y - previous.y;
        const dFromPrev = dx * dx + dy * dy;
        if (dFromPrev > r2) continue;
        const score = (ox !== null && oy !== null)
          ? ((e.x - ox) * (e.x - ox) + (e.y - oy) * (e.y - oy))
          : dFromPrev;
        if (score < bestScore) {
          bestScore = score;
          closest = e;
        }
      }
      if (!closest) break;
      damage *= 0.70;
      hits.push({ enemy: closest, damage });
      seen.add(closest);
      previous = closest;
    }
    return hits;
  }

  function projectileDamage(baseDamage, enemy, modifiers = {}) {
    const missing = 1 - Math.max(0, Number(enemy.hp) || 0) / Math.max(1, Number(enemy.max) || 1);
    const boss = Number(enemy.type) === 4;
    const enemyBonus = Number(modifiers.enemyDamage) || 0;
    const specialized = boss ? (Number(modifiers.bossDamage) || 0) : ((Number(modifiers.eliteDamage) || 0) * (enemy.elite ? 1 : 0));
    return baseDamage * (1 + (Number(modifiers.missingHpDamage) || 0) * missing) * (1 + enemyBonus + specialized) * (1 + (Number(modifiers.enemyFragility) || 0));
  }

  function contactDamage(attack, defense, reduction, bossResist, absolute, isBoss) {
    return Math.max(0, attack * (1 - defense) * (1 - Math.min(0.8, reduction)) * (isBoss ? 1 - Math.min(0.8, bossResist) : 1) - absolute);
  }

  // Fixed targeting: always selects the truly closest living enemies to (ox, oy) within range,
  // regardless of spawn order in the enemies array.
  const TARGET_PRIORITY_MODES = Object.freeze([
    'closest',
    'farthest',
    'highest_dmg',
    'highest_hp',
    'fastest',
    'ranged'
  ]);

  // Deterministic target selection for tower shots supporting all 6 Target Priority modes (#39).
  // Primary targets follow the selected priority mode.
  // Secondary shots (Multishot) and rebounds (Bounce) target enemies closest to the firing tower.
  function selectTargets(enemies, ox = 0, oy = 0, range = 110, maxCount = Infinity, priority = 'closest') {
    if (!Array.isArray(enemies) || !enemies.length) return [];
    const r2 = Math.max(0, Number(range) || 0) * Math.max(0, Number(range) || 0);
    const candidates = [];
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (!e || !(e.hp > 0)) continue;
      const dx = (Number(e.x) || 0) - ox;
      const dy = (Number(e.y) || 0) - oy;
      const d2 = dx * dx + dy * dy;
      if (d2 < r2) candidates.push({ e, d2 });
    }
    if (!candidates.length) return [];

    const mode = String(priority || 'closest').toLowerCase();
    if (mode === 'farthest') {
      candidates.sort((a, b) => (b.d2 - a.d2) || (a.e.id - b.e.id));
    } else if (mode === 'highest_dmg' || mode === 'strongest' || mode === 'highest_damage') {
      candidates.sort((a, b) => ((Number(b.e.atk) || 0) - (Number(a.e.atk) || 0)) || (a.d2 - b.d2) || (a.e.id - b.e.id));
    } else if (mode === 'highest_hp') {
      candidates.sort((a, b) => ((Number(b.e.hp) || 0) - (Number(a.e.hp) || 0)) || (a.d2 - b.d2) || (a.e.id - b.e.id));
    } else if (mode === 'fastest') {
      candidates.sort((a, b) => ((Number(b.e.spd) || 0) - (Number(a.e.spd) || 0)) || (a.d2 - b.d2) || (a.e.id - b.e.id));
    } else if (mode === 'ranged' || mode === 'ranged_enemy') {
      candidates.sort((a, b) => {
        const aRanged = (Number(a.e.type) === 3 || a.e.ranged) ? 1 : 0;
        const bRanged = (Number(b.e.type) === 3 || b.e.ranged) ? 1 : 0;
        return (bRanged - aRanged) || (a.d2 - b.d2) || (a.e.id - b.e.id);
      });
    } else {
      candidates.sort((a, b) => (a.d2 - b.d2) || (a.e.id - b.e.id));
    }

    const limit = Number.isFinite(maxCount) ? Math.max(0, Math.floor(maxCount)) : candidates.length;
    const out = [];
    for (let i = 0; i < Math.min(limit, candidates.length); i++) out.push(candidates[i].e);
    return out;
  }

  function closestLivingTower(towers, enemy) {
    if (!Array.isArray(towers) || !towers.length || !enemy) return null;
    let best = null;
    let bestD2 = Infinity;
    const ex = Number(enemy.x) || 0;
    const ey = Number(enemy.y) || 0;
    for (let i = 0; i < towers.length; i++) {
      const t = towers[i];
      if (!t || !(t.hp > 0)) continue;
      const dx = ex - (Number(t.x) || 0);
      const dy = ey - (Number(t.y) || 0);
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = t;
      }
    }
    return best;
  }

  // Shared calculation of effects from upgrades 33..40 + matching Final Labs
  // V56: Projectile Speed (#33) is fused into Attack Speed (#1); Burst Chance (#34) is fused into #24.
  // Step 2B Priority 1: Burst/Multishot/Bounce Chances = +2.5% (0.025) per level, max 40 levels = 100% (1.0).
  function computeUpgradeEffects(workshopLevels = [], runUpgrades = [], labLevels = {}) {
    const isEffArray = Array.isArray(labLevels);
    const wl = i => Math.max(0, Number(workshopLevels?.[i]) || 0);
    const ru = i => Math.max(0, Number(runUpgrades?.[i]) || 0);
    const lb = (k, idx) => isEffArray ? Math.max(0, Number(labLevels[idx]) || 0) : Math.max(0, Number(labLevels?.[k] ?? (idx !== undefined ? labLevels?.[idx] : 0)) || 0);
    const atkSpdLv = wl(1) + lb('Attack Speed', 1) + ru(1);
    return {
      projectileSpeed: Math.min(2500, Math.max(450, Math.round(450 + 8 * atkSpdLv))),
      burstChance: Math.min(1, Math.max(0, Math.min(40, wl(24) + wl(34) + lb('Burst Chance', 24) + ru(24) + ru(34)) * 0.025)),
      multishotChance: Math.min(1, Math.max(0, Math.min(40, wl(35) + lb('Multishot Chance', 35) + ru(35)) * 0.025)),
      bounceChance: Math.min(1, Math.max(0, Math.min(40, wl(36) + lb('Bounce Shot Chance', 36) + (isEffArray ? 0 : lb('Bounce Chance')) + ru(36)) * 0.025)),
      rapidFireChance: Math.min(1.0, Math.max(0, (wl(37) * 0.025) + (lb('Rapid Fire Chance', 37) * 0.025) + (ru(37) * 0.025))),
      rapidFireMultiplier: 1 + (wl(9) + ru(9) + lb('Rapid Fire', 9)) * 0.02,
      bounceCount: Math.min(5, Math.max(0, wl(10) + ru(10) + lb('Bounce Count', 10))),
      lifeOnWaveEnd: Math.min(0.5, Math.max(0, (wl(38) + lb('Life on Wave End', 38)) * 0.005)),
      startupCash: (wl(39) + wl(28) + lb('Startup Cash', 39)) * 100,
      overcritChance: Math.min(1.0, Math.max(0, (wl(41) * 0.025) + (lb('Overcrit Chance', 41) * 0.025) + (ru(41) * 0.025))),
      overcritDamage: Math.min(6.0, 2.0 + (wl(42) + lb('Overcrit Damage', 42) + ru(42)) * 0.10)
    };
  }

  // Shared validation for whether a run upgrade can still be purchased (SOLO & CO-OP)
  function canBuyRunUpgrade(i, { up = [], effectiveUp = [], stats = {}, effects = {}, waveEndHeal = 0, freeUpgradeLabLevel = 0 } = {}) {
    if (!Number.isInteger(i) || i < 0 || i >= UPGRADES.length) return false;
    if (UPGRADES[i].cat === 'Retired' || i === 23 || i === 26 || i === 28 || i === 33 || i === 34 || i === 38 || i === 39) return false;
    const purchasedLevel = Math.max(0, Math.floor(Number(up[i]) || 0));
    const effLv = Math.max(0, Number(effectiveUp[i] ?? purchasedLevel) || 0);
    if (purchasedLevel >= 1000) return false;
    if (cost(i, purchasedLevel) >= Number.MAX_SAFE_INTEGER || !canUpgrade(i, effLv)) return false;
    if (i === 3 && effLv >= 20) return false;
    if (i === 4 && (effLv >= 40 || Number(stats.crit) >= 1 - 1e-9)) return false;
    if (i === 5 && effLv >= 6) return false;
    if (i === 10 && effLv >= 5) return false;
    if (i === 12 && effLv >= 20) return false;
    if (i === 14 && (effLv >= 20 || Number(stats.thorns) >= 0.5 - 1e-9)) return false;
    if (i === 15 && (effLv >= 72 || Number(stats.lifesteal) >= 0.5 - 1e-9)) return false;
    if (i === 16 && effLv >= 1) return false;
    if (i === 20 && effLv >= 20) return false;
    if (i === 24 && (effLv >= 40 || Number(stats.burstChance) >= 1 - 1e-9 || Number(effects.burstChance) >= 1 - 1e-9)) return false;
    if (i === 25 && (effLv >= 4 || Number(stats.burstCount) >= 6)) return false;
    if (i === 40 && Number(waveEndHeal) >= 1 - 1e-9) return false;
    if (i === 35 && (effLv >= 40 || Number(effects.multishotChance) >= 1 - 1e-9)) return false;
    if (i === 36 && (effLv >= 40 || Number(effects.bounceChance) >= 1 - 1e-9)) return false;
    if (i === 37 && (effLv >= 40 || Number(effects.rapidFireChance) >= 1 - 1e-9)) return false;
    if (i === 41 && (effLv >= 40 || Number(effects.overcritChance) >= 1 - 1e-9)) return false;
    if (i === 42 && (effLv >= 40 || Number(effects.overcritDamage) >= 6.0 - 1e-9)) return false;
    if (i >= 29 && i <= 32 && effLv + (Number(freeUpgradeLabLevel) || 0) * 0.5 >= 100) return false;
    return true;
  }

  // Shared CO-OP speed rule (Section 5, Modif #11):
  // - Minimum speed x1, no pause.
  // - La vitesse maximale du lobby est déterminée par le déblocage le plus élevé parmi les joueurs présents.
  function resolveCoopSpeed(currentSpeed, playerMaxSpeed, requestedSpeed, action, roomMaxSpeed) {
    const cur = Math.max(1, Math.min(10, Math.round(Number(currentSpeed) || 1)));
    const myMax = Math.max(1, Math.min(10, Math.round(Number(playerMaxSpeed) || 1)));
    const effectiveMax = roomMaxSpeed !== undefined
      ? Math.max(myMax, Math.max(1, Math.min(10, Math.round(Number(roomMaxSpeed) || myMax))))
      : myMax;

    if (action === 'minus' || action === 'plus') {
      if (cur > effectiveMax) {
        return { allowed: true, speed: effectiveMax, clamped: true };
      }
      if (action === 'minus') {
        return { allowed: true, speed: Math.max(1, cur - 1), clamped: false };
      }
      if (cur >= effectiveMax) {
        return { allowed: false, speed: cur, reason: 'Speed not unlocked for this player or room limit reached' };
      }
      return { allowed: true, speed: Math.min(effectiveMax, cur + 1), clamped: false };
    }

    const req = Number(requestedSpeed);
    if (!Number.isInteger(req) || req < 1 || req > 10) {
      return { allowed: false, speed: cur, reason: 'Invalid speed' };
    }
    if (req <= effectiveMax) {
      return { allowed: true, speed: req, clamped: false };
    }
    if (cur > effectiveMax) {
      return { allowed: true, speed: effectiveMax, clamped: true };
    }
    return { allowed: false, speed: cur, reason: 'Speed not unlocked for this player or room limit reached' };
  }

  // Shared run reward calculation (SOLO & CO-OP)
  function calculateRunRewards({ earnedGold = 0, earnedXP = 0, wave = 1, map = 1, diff = 0, coinBonus = 1, xpBonus = 1, diamonds = 0 }) {
    const safeWave = Math.max(1, Math.min(5000, Math.floor(Number(wave) || 1)));
    const safeMap = Math.max(1, Math.min(10, Math.floor(Number(map) || 1)));
    const safeDiff = Math.max(0, Math.min(DIFF_MULT.length - 1, Math.floor(Number(diff) || 0)));
    const rewardMultiplier = Math.pow(1.4, safeMap - 1) * DIFF_MULT[safeDiff];
    const coins = Math.max(0, Math.floor(((Number(earnedGold) || 0) + safeWave * 3) * rewardMultiplier * Math.max(0, Number(coinBonus) || 1)));
    const xp = Math.max(0, Math.floor((Number(earnedXP) || 0) * Math.max(0, Number(xpBonus) || 1)));
    const safeDiamonds = Math.max(0, Math.floor(Number(diamonds) || 0));
    return { coins, xp, diamonds: safeDiamonds, rewardMultiplier };
  }

  // Spawn a single enemy at 360° outside all active tower ranges
  function spawnSingleEnemy360(state, arg2 = {}, arg3 = {}) {
    if (!state) return null;
    const opts = Array.isArray(arg2) ? { ...arg3, towers: arg2 } : (arg2 || {});
    const {
      type = 0,
      isGiant = false,
      giantFactor = 1,
      towers = null,
      rng = Math.random,
      angle = undefined,
      jitter: jitterOpt = undefined
    } = opts;
    state.enemies = state.enemies || [];
    const factor = isGiant ? Math.max(1, Math.floor(Number(giantFactor) || 1)) : 1;
    const radius = isGiant ? 20 : (type === 4 ? 17 : type === 2 ? 10 : 7);
    const ang = Number.isFinite(Number(angle)) ? Number(angle) : rng() * Math.PI * 2;
    const jitter = Number.isFinite(Number(jitterOpt)) ? Number(jitterOpt) : rng() * 14;
    const pos = computeSpawnPosition360(towers, ang, radius, SPAWN_SAFETY_MARGIN, jitter);
    const baseEnemy = enemyStats({ wave: state.wave, map: state.map, diff: state.diff, type });
    const obj = {
      id: state.nextId ? state.nextId++ : undefined,
      x: pos.x,
      y: pos.y,
      hp: baseEnemy.hp * factor,
      max: baseEnemy.hp * factor,
      type,
      shot: 0,
      spd: baseEnemy.spd,
      atk: baseEnemy.atk * factor,
      isGiant: Boolean(isGiant),
      giantFactor: factor,
      killWeight: factor,
      radius,
      spawnWave: state.wave
    };
    state.enemies.push(obj);
    state.spawned = (state.spawned || 0) + 1;
    if (type === 4) state.boss = true;
    return obj;
  }

  // Spawn the single main batch for `state.wave` (+ 1 existing Boss on multiples of 10 per Decision D2)
  // Spawn a single decomposed group within a wave (Étape 2)
  function spawnWaveGroup(state, groupSize, isFirstGroup = false, towers = null, rng = Math.random) {
    if (!state || groupSize <= 0) return [];
    const wave = Math.max(1, Math.min(MAX_WAVE_CAP, Math.floor(Number(state.wave) || 1)));
    const spawnedList = [];
    const isGiant = isGiantGroup(wave, groupSize);

    if (isGiant) {
      const gType = rollOrdinaryEnemyType(rng);
      const gEnemy = spawnSingleEnemy360(state, {
        type: gType,
        isGiant: true,
        giantFactor: groupSize,
        towers,
        rng
      });
      if (gEnemy) spawnedList.push(gEnemy);
    } else {
      for (let i = 0; i < groupSize; i++) {
        const eType = rollOrdinaryEnemyType(rng);
        const eObj = spawnSingleEnemy360(state, {
          type: eType,
          isGiant: false,
          giantFactor: 1,
          towers,
          rng
        });
        if (eObj) spawnedList.push(eObj);
      }
    }

    if (isFirstGroup && wave % 10 === 0) {
      const bossObj = spawnSingleEnemy360(state, {
        type: 4,
        isGiant: false,
        giantFactor: 1,
        towers,
        rng
      });
      if (bossObj) spawnedList.push(bossObj);
    }

    return spawnedList;
  }

  function spawnWaveBatch(state, towers = null, rng = Math.random) {
    if (!state) return [];
    const wave = Math.max(1, Math.min(MAX_WAVE_CAP, Math.floor(Number(state.wave) || 1)));
    const { groups } = waveGroups(wave);
    state.spawned = 0;
    state.boss = false;
    state.waveGroupIndex = 0;
    const spawnedList = [];
    if (groups.length > 0) {
      const initial = spawnWaveGroup(state, groups[0], true, towers, rng);
      spawnedList.push(...initial);
      state.waveGroupIndex = 1;
    }
    state.batchSpawnedWave = wave;
    return spawnedList;
  }

  // Backward-compatible helper for single enemy spawn (uses 360° outside tower ranges)
  function spawnWaveEnemy(state, rng = Math.random, towers = null) {
    if (!state) return null;
    const boss = state.wave % 10 === 0 && (state.spawned || 0) === 0;
    const type = boss ? 4 : rollOrdinaryEnemyType(rng);
    const giant = !boss && isGiantWave(state.wave);
    const factor = giant ? waveBatchCount(state.wave) : 1;
    return spawnSingleEnemy360(state, {
      type,
      isGiant: giant,
      giantFactor: factor,
      towers,
      rng
    });
  }

  // Unified per-step combat engine used by both SOLO and CO-OP server
  function stepCombat(state, dt, hooks = {}) {
    if (!state || !(dt > 0)) return null;
    const options = (typeof hooks === 'object' && hooks !== null) ? hooks : {};
    const rng = typeof hooks === 'function' ? hooks : (typeof hooks?.rng === 'function' ? hooks.rng : Math.random);
    const isMulti = Array.isArray(state.players) && state.players.length > 0;
    const towers = isMulti ? state.players : [state];

    state.wave = Math.max(1, Math.min(MAX_WAVE_CAP, Math.floor(Number(state.wave) || 1)));
    state.enemies = state.enemies || [];
    state.bullets = state.bullets || [];
    state.enemyBullets = state.enemyBullets || [];
    if (!isMulti) state.burstQueue = state.burstQueue || [];

    const getEffUp = p => {
      if (typeof hooks.getEffectiveUp === 'function') return hooks.getEffectiveUp(p);
      if (Array.isArray(p.effectiveUp)) return p.effectiveUp;
      const wl = p.permanent?.workshopLevels || [];
      const ll = p.permanent?.workshopLabLevels || [];
      return UPGRADES.map((u, i) => {
        const runLv = Math.max(0, Number(p.up?.[i]) || 0);
        const permLv = Math.max(0, Number(wl[i]) || 0) + Math.max(0, Number(ll[i]) || 0);
        if (i === 16) return Math.min(2, Math.max(permLv, Math.min(1, runLv)));
        return (u.max && u.max < 1000) ? Math.min(u.max, runLv + permLv) : runLv + permLv;
      });
    };

    const getEffects = (p, effUp) => {
      if (typeof hooks.getEffects === 'function') return hooks.getEffects(p, effUp);
      const baseEff = p.permanent?.effects || p.stats || {};
      const wl = p.permanent?.workshopLevels || [];
      const ru = p.up || [];
      const atkSpdLv = Math.max(0, Number(effUp?.[1]) || (Number(wl[1]) || 0) + (Number(ru[1]) || 0));
      return {
        projectileSpeed: Math.min(2500, Math.max(450, Math.round(450 + 8 * atkSpdLv))),
        burstChance: Math.min(1, Math.max(0, Math.min(40, (Number(effUp?.[24]) || 0) + (Number(effUp?.[34]) || 0)) * 0.025, (Number(baseEff.burstChance ?? baseEff.burstChanceBonus) || 0) + (Number(ru[24]) || 0) * 0.025)),
        multishotChance: Math.min(1, Math.max(0, Math.min(40, Number(effUp?.[35]) || 0) * 0.025, (Number(baseEff.multishotChance) || (Number(wl[35]) || 0) * 0.025) + (Number(ru[35]) || 0) * 0.025)),
        bounceChance: Math.min(1, Math.max(0, Math.min(40, Number(effUp?.[36]) || 0) * 0.025, (Number(baseEff.bounceChance) || (Number(wl[36]) || 0) * 0.025) + (Number(ru[36]) || 0) * 0.025)),
        rapidFireChance: Math.min(1.0, Math.max(0, (Number(baseEff.rapidFireChance) || (Number(wl[37]) || 0) * 0.025) + (Number(ru[37]) || 0) * 0.025)),
        rapidFireMultiplier: Math.max(1, Number(baseEff.rapidFireMultiplier ?? p.stats?.rapidFireMultiplier) || 1),
        bounceCount: Math.min(5, Math.max(0, Number(baseEff.bounceCount ?? p.stats?.bounceCount) || 0)),
        lifeOnWaveEnd: Math.min(0.5, Math.max(0, Number(baseEff.lifeOnWaveEnd ?? baseEff.waveEndHeal ?? p.stats?.waveEndHeal) || (Number(wl[38]) || 0) * 0.005)),
        overcritChance: Math.min(1.0, Math.max(0, (Number(baseEff.overcritChance) || (Number(wl[41]) || 0) * 0.025) + (Number(ru[41]) || 0) * 0.025)),
        overcritDamage: Math.max(2.0, Number(baseEff.overcritDamage || 2.0) + (Number(ru[42]) || 0) * 0.10)
      };
    };

    const getStats = (p, effUp, eff) => {
      if (typeof hooks.getTowerStats === 'function') return hooks.getTowerStats(p, effUp, eff);
      const baseStats = p.stats || {};
      const boosters = p.permanent?.boosters || {};
      const mods = p.permanent?.modifiers || {};
      const st = towerStats(effUp, { ...baseStats, maxHp: p.maxhp }, {
        regen: (Number(mods.regen) || 0) + (Number(boosters.regen ?? baseStats.boosterRegen) || 0) * 10,
        defense: (Number(mods.defense) || 0) + (Number(boosters.defense ?? baseStats.boosterDefense) || 0)
      });
      st.defense = Math.min(0.95, Math.max(0, st.defense));
      st.speed *= ((Number(p.rapidFireRemaining) || 0) > 0 ? eff.rapidFireMultiplier : 1);
      return st;
    };

    const getModifiers = p => {
      if (typeof hooks.getModifiers === 'function') return hooks.getModifiers(p);
      return p.permanent?.modifiers || {};
    };

    const getBoosters = p => {
      if (typeof hooks.getBoosters === 'function') return hooks.getBoosters(p);
      return p.permanent?.boosters || {
        regen: p.stats?.boosterRegen || 0,
        defense: p.stats?.boosterDefense || 0,
        damageReduction: p.stats?.boosterDamageReduction || 0,
        slow: p.stats?.boosterSlow || 0,
        interest: p.stats?.boosterInterest || 0,
        cash: p.stats?.boosterCash || 0,
        speed: p.stats?.boosterSpeed || 0,
        shield: p.stats?.boosterShield || 0
      };
    };

    const getBonuses = p => {
      if (typeof hooks.getBonuses === 'function') return hooks.getBonuses(p);
      return p.permanent?.bonuses || { xp: 0, coin: 0 };
    };

    const getActiveTowersForSpawn = () => towers.map(p => {
      if (!p) return null;
      const effUp = getEffUp(p);
      const eff = getEffects(p, effUp);
      const st = getStats(p, effUp, eff);
      return {
        x: Number(p.x) || 0,
        y: Number(p.y) || 0,
        hp: p.hp,
        forfeited: Boolean(p.forfeited),
        range: Math.max(60, Number(st.range) || 110)
      };
    }).filter(Boolean);

    const grantWaveEndRewards = completedWave => {
      if ((state.lastWaveRewarded || 0) >= completedWave) return;
      state.lastWaveRewarded = completedWave;

      for (const p of towers) {
        if (!p || p.forfeited) continue;
        const effUp = getEffUp(p);
        const eff = getEffects(p, effUp);
        const mods = getModifiers(p);
        const boosters = getBoosters(p);
        const bonuses = getBonuses(p);

        if (p.hp > 0) {
          const heal = waveEndHealFraction(eff.lifeOnWaveEnd, (Number(p.up?.[40]) || 0) * 0.005);
          p.hp = Math.min(p.maxhp, p.hp + p.maxhp * heal);
        }

        if (typeof hooks.awardFreeUpgrades === 'function') {
          hooks.awardFreeUpgrades(p);
        } else {
          for (const [idx, cat] of [[29, 'Offense'], [30, 'Defense'], [31, 'Utility'], [32, 'Economy']]) {
            const freeLabBonus = Number(p.permanent?.labs?.freeUpgrade?.[idx - 29]) || 0;
            const chance = Math.min(1, Math.max(0, effUp[idx] * 0.01 + freeLabBonus * 0.005));
            if (rng() < chance) {
              const curEffUp = getEffUp(p);
              const curEff = getEffects(p, curEffUp);
              const curSt = getStats(p, curEffUp, curEff);
              const curHeal = waveEndHealFraction(curEff.lifeOnWaveEnd, (Number(p.up?.[40]) || 0) * 0.005);
              const options = UPGRADES.map((u, i) => ({ u, i })).filter(x =>
                x.u.cat === cat && x.i !== 28 && x.i !== 26 && x.i !== 23 && x.i !== 33 && x.i !== 34 && x.i !== 38 &&
                (!p.allowedUpgrades || p.allowedUpgrades.includes(x.i)) &&
                canBuyRunUpgrade(x.i, {
                  up: p.up,
                  effectiveUp: curEffUp,
                  stats: curSt,
                  effects: curEff,
                  waveEndHeal: curHeal,
                  freeUpgradeLabLevel: freeLabBonus
                })
              );
              if (options.length) {
                const pick = options[Math.floor(rng() * options.length)];
                p.up[pick.i] = (p.up[pick.i] || 0) + 1;
                if (Array.isArray(p.purchased)) p.purchased[pick.i] = (p.purchased[pick.i] || 0) + 1;
                if (pick.i === 2) {
                  const newEff = getEffUp(p)[2];
                  const hp = hpUpgrade(p.maxhp, p.hp, newEff - 1, newEff);
                  p.maxhp = hp.max;
                  p.hp = hp.hp;
                }
              }
            }
          }
        }

        const updatedEffUp = getEffUp(p);
        p.shields = shieldCapacity(updatedEffUp[16]) * (1 + (Number(boosters.shield) || 0));

        const batchVal = waveBatchCount(completedWave);
        const mult = Math.pow(1.42, state.map - 1) * DIFF_MULT[state.diff];
        const multXP = Math.pow(1.65, state.map - 1) * Math.pow(3, state.diff);

        const baseWaveCash = (10 + completedWave * 2.5) * batchVal * mult;
        const baseWaveGold = Math.max(1, Math.floor((1 + completedWave * 0.1) * batchVal * mult));
        const baseWaveXP = (20 + completedWave * 2) * batchVal * multXP;

        p.cash += baseWaveCash * (1 + updatedEffUp[17] * 0.05 + (Number(mods.cash) || 0) + (Number(boosters.cash) || 0));

        const waveGold = Math.max(1, Math.floor(baseWaveGold * (1 + updatedEffUp[19] * 0.05 + (Number(mods.gold) || 0) + (Number(boosters.coin) || 0))));
        const waveXP = Math.max(1, Math.floor(baseWaveXP * (1 + updatedEffUp[27] * 0.05 + (Number(bonuses.xp) || 0) + (Number(boosters.xp) || 0))));
        if (isMulti) {
          p.earnedGold = (p.earnedGold || 0) + waveGold;
          p.earnedXP = (p.earnedXP || 0) + waveXP;
        } else {
          state.gold = (state.gold || 0) + waveGold;
          if (typeof hooks.onXP === 'function') hooks.onXP(waveXP);
        }
      }

      if (isMulti) {
        state.xp = (state.xp || 0) + (20 + completedWave * 2);
        state.hp = towers.reduce((sum, p) => sum + Math.max(0, p.hp), 0);
        state.maxhp = towers.reduce((sum, p) => sum + p.maxhp, 0);
        state.shields = towers.reduce((sum, p) => sum + (p.shields || 0), 0);
      }

      if (completedWave % 10 === 0) state.diamonds = (state.diamonds || 0) + 1;
      if (typeof hooks.onWaveComplete === 'function') hooks.onWaveComplete(completedWave);
    };

    // 1. Spawn current wave groups distributed over the 10-second duration
    if ((state.batchSpawnedWave || 0) < state.wave) {
      spawnWaveBatch(state, getActiveTowersForSpawn(), rng);
    } else if (state.waveGroupIndex !== undefined) {
      const { groups } = waveGroups(state.wave);
      const K = groups.length;
      while (state.waveGroupIndex < K && state.waveTime >= (state.waveGroupIndex / K) * WAVE_DURATION_SECONDS) {
        spawnWaveGroup(state, groups[state.waveGroupIndex], false, getActiveTowersForSpawn(), rng);
        state.waveGroupIndex++;
      }
    }

    state.elapsed = (Number(state.elapsed) || 0) + dt;
    state.waveTime = (Number(state.waveTime) || 0) + dt;

    // 1b. 10-second wave timer: a new wave starts every 10s at x1 speed, even if enemies from previous waves are still alive
    let waveAdvanceBudget = 32;
    while (state.waveTime >= WAVE_DURATION_SECONDS && state.wave < MAX_WAVE_CAP && waveAdvanceBudget-- > 0) {
      state.waveTime -= WAVE_DURATION_SECONDS;
      const completedWave = state.wave;
      grantWaveEndRewards(completedWave);
      state.wave = Math.min(MAX_WAVE_CAP, state.wave + 1);
      spawnWaveBatch(state, getActiveTowersForSpawn(), rng);
    }

    // 2. Per-tower interest, regen, shooting and burst queue
    for (const p of towers) {
      if (!p || p.hp <= 0) continue;
      const effUp = getEffUp(p);
      const eff = getEffects(p, effUp);
      const st = getStats(p, effUp, eff);
      const boosters = getBoosters(p);
      const ox = Number(p.x) || 0;
      const oy = Number(p.y) || 0;

      p.rapidFireRemaining = Math.max(0, (Number(p.rapidFireRemaining) || 0) - dt);
      p.interestTimer = (Number(p.interestTimer) || 0) + dt;
      while (p.interestTimer >= 10) {
        p.interestTimer -= 10;
        const gained = interestCash(p.cash, effUp[20]) * (1 + (Number(boosters.interest) || 0));
        p.cash += gained;
        if (gained > 0 && typeof options.onInterestGain === 'function') {
          options.onInterestGain({ x: ox, y: oy, slot: p.slot ?? 0, amount: Math.round(gained) });
        }
      }

      p.hp = Math.min(p.maxhp, p.hp + st.regen * dt);
      p.shot = (Number(p.shot) || 0) + dt;

      const shotInterval = 1 / Math.max(0.01, st.speed);
      let shotBudget = 64;
      const bq = p.burstQueue || (isMulti ? (p.burstQueue = []) : state.burstQueue);

      while (p.shot >= shotInterval && shotBudget-- > 0) {
        p.shot -= shotInterval;
        const rf = rapidFireTrigger(p.rapidFireRemaining, eff.rapidFireChance, rng());
        p.rapidFireRemaining = rf.remaining;
        if (rf.triggered) p.rapidFireTriggers = (p.rapidFireTriggers || 0) + 1;

        // Primary target selection follows tower's target priority (#39)
        const priority = p.targetPriority || state.targetPriority || 'closest';
        const primaryList = selectTargets(state.enemies, ox, oy, st.range, 1, priority);
        if (!primaryList.length) continue;
        const primaryTarget = primaryList[0];

        // Multishot evaluation (#38): 0% = 0 extra, 50% = statistical, 100% = always, cap 6 extra shots
        const multiChance = Math.min(1, Math.max(0, Number(eff.multishotChance) || 0, (Number(effUp[35]) || 0) * 0.025));
        const multiTriggered = multiChance > 0 && rng() < multiChance;
        const extraShotCount = multiTriggered ? Math.min(6, Math.max(0, (st.multi || 1) - 1)) : 0;

        const targets = [primaryTarget];
        if (extraShotCount > 0) {
          // Multishot extra projectiles target enemies closest to the shooting tower (#38, #39)
          const closestList = selectTargets(state.enemies, ox, oy, st.range, extraShotCount + 1, 'closest');
          for (let k = 0; k < closestList.length && targets.length < 1 + extraShotCount; k++) {
            if (closestList[k] !== primaryTarget) {
              targets.push(closestList[k]);
            }
          }
          while (targets.length < 1 + extraShotCount && closestList.length > 0) {
            targets.push(closestList[targets.length % closestList.length]);
          }
        }

        for (let j = 0; j < targets.length; j++) {
          const e = targets[j];
          const ocRoll = calculateHitCritical(st.crit, st.critDamage, eff.overcritChance || st.overcritChance || 0, eff.overcritDamage || st.overcritDamage || 2, rng);
          if (state.bullets.length < 2500) {
            state.bullets.push({
              x: ox,
              y: oy,
              tx: e,
              txX: e.x,
              txY: e.y,
              slot: p.slot ?? 0,
              damage: st.dmg * ocRoll.multiplier,
              crit: ocRoll.isCrit,
              overcrit: ocRoll.isOvercrit,
              critTiers: ocRoll.tiers,
              life: 0
            });
          }
          const bChance = Math.min(1, Math.max(0, Number(st.burstChance) || 0, Number(eff.burstChance) || 0));
          if (j === 0 && bChance > 0 && rng() < bChance) {
            const count = Math.min(6, 2 + effUp[25]);
            const scale = 0.5;
            for (let shot = 1; shot < count; shot++) {
              if (bq.length < 2000) {
                bq.push({ delay: shot * 0.085, target: e, damage: st.dmg * scale, slot: p.slot ?? 0 });
              }
            }
          }
        }
      }

      for (let q = bq.length - 1; q >= 0; q--) {
        const burst = bq[q];
        burst.delay -= dt;
        if (burst.delay <= 0) {
          const e = (burst.target && burst.target.hp > 0)
            ? burst.target
            : selectTargets(state.enemies, ox, oy, st.range, 1)[0];
          if (e) {
            const ocRoll = calculateHitCritical(st.crit, st.critDamage, eff.overcritChance || st.overcritChance || 0, eff.overcritDamage || st.overcritDamage || 2, rng);
            if (state.bullets.length < 2500) {
              state.bullets.push({
                x: ox,
                y: oy,
                tx: e,
                txX: e.x,
                txY: e.y,
                slot: p.slot ?? 0,
                damage: burst.damage * ocRoll.multiplier,
                crit: ocRoll.isCrit,
                overcrit: ocRoll.isOvercrit,
                critTiers: ocRoll.tiers,
                life: 0
              });
            }
          }
          bq.splice(q, 1);
        }
      }
    }

    // 3. Enemy movement and attacks
    for (const e of state.enemies) {
      if (!e || e.hp <= 0) continue;
      const target = closestLivingTower(towers, e);
      if (!target) continue;
      const tx = Number(target.x) || 0;
      const ty = Number(target.y) || 0;
      const effUp = getEffUp(target);
      const eff = getEffects(target, effUp);
      const st = getStats(target, effUp, eff);
      const boosters = getBoosters(target);
      const mods = getModifiers(target);

      const dx = e.x - tx;
      const dy = e.y - ty;
      const dist = Math.hypot(dx, dy) || 1;
      const stop = e.type === 3 ? st.range * 0.5 : (e.isGiant ? 22 : 17);
      if (dist > stop) {
        const slow = Math.min(0.8, Number(boosters.slow) || 0);
        e.x -= (dx / dist) * e.spd * dt * (1 - slow);
        e.y -= (dy / dist) * e.spd * dt * (1 - slow);
      } else {
        e.shot = (Number(e.shot) || 0) + dt;
        if (e.shot >= (e.type === 3 ? 1.6 : 1.0)) {
          e.shot = 0;
          if (e.type === 3 && dist <= st.range * 0.5 + 0.01) {
            state.enemyBullets.push({ x: e.x, y: e.y, tx, ty, targetSlot: target.slot ?? 0, life: 0, damage: e.atk });
          } else if (e.type !== 3) {
            const hit = contactDamage(
              e.atk,
              st.defense,
              (Number(mods.damageReduction) || 0) + (Number(boosters.damageReduction) || 0),
              Number(mods.bossResist) || 0,
              st.absolute,
              e.type === 4
            );
            const shield = absorbShield(target.shields || 0, hit);
            target.shields = shield.shields;
            target.shieldAbsorbed = (target.shieldAbsorbed || 0) + shield.absorbed;
            target.hp -= shield.damage;
            if (target.hp <= 0) {
              target.killedBy = e.isGiant ? ('Giant ' + (TYPES[e.type]?.name || 'Enemy')) : (TYPES[e.type]?.name || 'Unknown');
              if (!isMulti) state.killedBy = target.killedBy;
            }
            target.taken = (target.taken || 0) + shield.damage;
            target.damageSources = target.damageSources || {};
            const srcKey = e.type === 4 ? 'Boss' : e.isGiant ? 'Giant' : e.type === 3 ? 'Ranged' : 'Contact';
            target.damageSources[srcKey] = (target.damageSources[srcKey] || 0) + shield.damage;
            e.hp -= e.max * st.thorns;
            if (st.thorns > 0) e.lastHitSlot = target.slot ?? 0;
          }
        }
      }
    }

    // 4. Tower projectiles (Projectile Speed fused with Attack Speed #1)
    for (const bullet of state.bullets) {
      bullet.life = (Number(bullet.life) || 0) + dt;
      const e = bullet.tx;
      if (!e || typeof e !== 'object' || e.hp <= 0) {
        bullet.life = 99;
        continue;
      }
      const shooter = towers.find(t => (t.slot ?? 0) === (bullet.slot ?? 0)) || towers[0];
      const effUp = getEffUp(shooter);
      const eff = getEffects(shooter, effUp);
      const st = getStats(shooter, effUp, eff);
      const mods = getModifiers(shooter);
      const boosters = getBoosters(shooter);

      const dx = e.x - bullet.x;
      const dy = e.y - bullet.y;
      const dist = Math.hypot(dx, dy) || 1;
      const projSpeed = Math.min(2500, Math.max(450, Number(st.projectileSpeed) || Number(eff.projectileSpeed) || 450) * (1 + (Number(boosters.speed) || 0)));
      const move = projSpeed * dt;
      if (dist <= move) {
        bullet.x = e.x;
        bullet.y = e.y;
        bullet.txX = e.x;
        bullet.txY = e.y;
        bullet.life = 99;
        const actualDamage = projectileDamage(bullet.damage, e, mods);
        e.hp -= actualDamage;
        e.lastHitSlot = shooter.slot ?? 0;
        shooter.damage = (shooter.damage || 0) + actualDamage;
        shooter.damageDealt = shooter.damageDealt || {};
        shooter.damageDealt.Direct = (shooter.damageDealt.Direct || 0) + actualDamage;

        if (typeof options.onHitDamage === 'function') {
          options.onHitDamage({
            x: e.x,
            y: e.y,
            damage: actualDamage,
            crit: !!bullet.crit,
            overcrit: !!bullet.overcrit
          });
        }

        knockbackEnemy(e, effUp[22], rng);

        const bounceProb = Math.min(1, Math.max(0, Number(eff.bounceChance) || 0));
        if ((effUp[10] > 0 || eff.bounceCount > 0) && bounceProb > 0 && rng() < bounceProb) {
          for (const bounce of bounceHits(state.enemies, e, Math.min(5, effUp[10] || eff.bounceCount), actualDamage, 125, shooter.x, shooter.y)) {
            bounce.enemy.hp -= bounce.damage;
            bounce.enemy.lastHitSlot = shooter.slot ?? 0;
            shooter.damage += bounce.damage;
            shooter.damageDealt.Bounce = (shooter.damageDealt.Bounce || 0) + bounce.damage;
          }
        }
        shooter.hp = Math.min(shooter.maxhp, shooter.hp + actualDamage * st.lifesteal);
      } else {
        bullet.x += (dx / dist) * move;
        bullet.y += (dy / dist) * move;
        bullet.txX = e.x;
        bullet.txY = e.y;
      }
    }

    // 5. Enemy ranged projectiles
    for (const p of state.enemyBullets) {
      p.life = (Number(p.life) || 0) + dt;
      const target = towers.find(t => (t.slot ?? 0) === (p.targetSlot ?? 0) && t.hp > 0) || closestLivingTower(towers, p) || towers[0];
      if (!target) { p.life = 99; continue; }
      const tx = Number(target.x) || 0;
      const ty = Number(target.y) || 0;
      const dx = p.x - tx;
      const dy = p.y - ty;
      const d = Math.hypot(dx, dy) || 1;
      const move = 120 * dt;
      p.x -= (dx / d) * move;
      p.y -= (dy / d) * move;
      if (d < move + 14) {
        p.life = 99;
        const effUp = getEffUp(target);
        const eff = getEffects(target, effUp);
        const st = getStats(target, effUp, eff);
        const mods = getModifiers(target);
        const boosters = getBoosters(target);
        const hit = contactDamage(
          p.damage,
          st.defense,
          (Number(mods.damageReduction) || 0) + (Number(boosters.damageReduction) || 0),
          0,
          st.absolute,
          false
        );
        const shield = absorbShield(target.shields || 0, hit);
        target.shields = shield.shields;
        target.shieldAbsorbed = (target.shieldAbsorbed || 0) + shield.absorbed;
        target.hp -= shield.damage;
        if (target.hp <= 0) {
          target.killedBy = 'Ranged';
          if (!isMulti) state.killedBy = 'Ranged';
        }
        target.taken = (target.taken || 0) + shield.damage;
        target.damageSources = target.damageSources || {};
        target.damageSources.Ranged = (target.damageSources.Ranged || 0) + shield.damage;
      }
    }

    // In-place compaction of bullets for zero-allocation performance (Étape 4)
    let bWrite = 0;
    for (let bIdx = 0; bIdx < state.bullets.length; bIdx++) {
      const b = state.bullets[bIdx];
      if (b && b.life < 90) state.bullets[bWrite++] = b;
    }
    state.bullets.length = bWrite;

    let ebWrite = 0;
    for (let ebIdx = 0; ebIdx < state.enemyBullets.length; ebIdx++) {
      const eb = state.enemyBullets[ebIdx];
      if (eb && eb.life < 90) state.enemyBullets[ebWrite++] = eb;
    }
    state.enemyBullets.length = ebWrite;

    // 6. Enemy deaths & kill rewards (Giant Enemy grants xN economic rewards and 1 roll at N * p_diamond)
    for (let i = state.enemies.length - 1; i >= 0; i--) {
      const e = state.enemies[i];
      if (e.hp > 0) continue;
      state.enemies.splice(i, 1);
      state.kills = (state.kills || 0) + 1;
      if (e.isGiant) state.giantKills = (state.giantKills || 0) + 1;
      const killerSlot = e.lastHitSlot ?? 0;
      const killer = towers.find(t => (t.slot ?? 0) === killerSlot) || towers[0];
      if (isMulti && killer) {
        killer.kills = (killer.kills || 0) + 1;
        if (e.isGiant) killer.giantKills = (killer.giantKills || 0) + 1;
      }

      const enemyWave = Math.max(1, Number(e.spawnWave) || state.wave);
      const rewardWeight = e.isGiant ? Math.max(1, Number(e.giantFactor || e.killWeight) || 1) : 1;
      const mult = Math.pow(1.42, state.map - 1) * DIFF_MULT[state.diff];
      const earn = Math.max(1, Math.floor((2 + enemyWave * 0.2) * mult)) * rewardWeight;
      const xpBase = (2 + enemyWave * 0.15) * Math.pow(1.65, state.map - 1) * Math.pow(3, state.diff) * (e.type === 4 ? 30 : 1) * rewardWeight;

      for (const p of towers) {
        const effUp = getEffUp(p);
        const mods = getModifiers(p);
        const boosters = getBoosters(p);
        const bonuses = getBonuses(p);
        p.cash += earn * (1 + effUp[6] * 0.05 + (Number(mods.cash) || 0) + (Number(boosters.cash) || 0));
        const goldGain = earn * (1 + effUp[18] * 0.05 + (Number(mods.gold) || 0) + (Number(boosters.coin) || 0));
        const xpGain = xpBase * (1 + effUp[21] * 0.05 + (Number(bonuses.xp) || 0) + (Number(boosters.xp) || 0));
        if (isMulti) {
          p.earnedGold = (p.earnedGold || 0) + goldGain;
          p.earnedXP = (p.earnedXP || 0) + xpGain;
        } else {
          state.gold = (state.gold || 0) + goldGain;
          if (typeof hooks.onXP === 'function') hooks.onXP(xpGain);
        }
      }
      if (isMulti) {
        state.gold = (state.gold || 0) + earn;
        state.xp = (state.xp || 0) + xpBase;
      }
      const diamondMod = towers.reduce((m, t) => Math.max(m, Number(getModifiers(t).diamonds) || 0), 0);
      const diamondProb = Math.min(1, 0.001 * rewardWeight * (1 + diamondMod) * (e.type === 4 ? 20 : 1));
      if (rng() < diamondProb) {
        state.diamonds = (state.diamonds || 0) + 1;
      }
      if (typeof hooks.onKill === 'function') hooks.onKill(e, killer);
    }

    if (isMulti) {
      state.hp = towers.reduce((sum, p) => sum + Math.max(0, p.hp), 0);
      state.maxhp = towers.reduce((sum, p) => sum + p.maxhp, 0);
      state.shields = towers.reduce((sum, p) => sum + (p.shields || 0), 0);
    }

    if (towers.every(p => p.hp <= 0)) {
      if (typeof hooks.onRunEnd === 'function') hooks.onRunEnd();
      return 'core_destroyed';
    }

    // 7. Wave 5,000 strict victory check: only when Wave 5,000 batch has spawned AND all enemies are eliminated while tower(s) survive
    if (state.wave >= MAX_WAVE_CAP && state.batchSpawnedWave >= MAX_WAVE_CAP && state.enemies.length === 0) {
      grantWaveEndRewards(MAX_WAVE_CAP);
      state.wave5000Cleared = true;
      if (typeof hooks.onRunEnd === 'function') hooks.onRunEnd('Wave Complete');
      return 'max_wave';
    }

    return null;
  }

  const backgroundCache = new WeakMap();
  function drawBackground(ctx, w, h) {
    let cache = backgroundCache.get(ctx);
    if (!cache || cache.w !== w || cache.h !== h) {
      const gradient = ctx.createRadialGradient(w * 0.5, h * 0.46, 10, w * 0.5, h * 0.5, Math.max(w, h) * 0.8);
      gradient.addColorStop(0, '#14324b');
      gradient.addColorStop(0.55, '#101c38');
      gradient.addColorStop(1, '#06091d');
      cache = { w, h, gradient };
      backgroundCache.set(ctx, cache);
    }
    const bg = cache.gradient;
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    const showParticles = !(typeof globalThis !== 'undefined' && globalThis.itExtraParticles === false);
    for (let i = 0; i < (showParticles ? 22 : 0); i++) {
      const px = (Math.sin(i * 79.7) * 0.5 + 0.5) * w;
      const py = (Math.sin(i * 33.4) * 0.5 + 0.5) * h;
      ctx.fillStyle = i % 3 === 0 ? '#30e8cb18' : '#ab55e71c';
      ctx.fillRect(px, py, 2, Math.max(16, h * 0.14));
    }
  }

  function drawEnemy(ctx, e, zoom = 1, scale = 1, showHpBars = false) {
    const type = e.type || 0;
    const isGiant = Boolean(e.isGiant || (e.giantFactor && e.giantFactor > 1));
    const rawSize = isGiant ? 20 : (type === 4 ? 17 : type === 2 ? 10 : 7);
    const minScreenPx = isGiant ? 6 : (type === 4 ? 5 : (type === 2 ? 3.5 : 2.5));
    const size = Math.max(rawSize, minScreenPx / (Math.max(0.1, Number(scale) || 1) * Math.max(0.005, Number(zoom) || 1)));
    const baseColor = (TYPES[type] || TYPES[0]).color;

    if (isGiant) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(e.x, e.y, size + 4, 0, Math.PI * 2);
      ctx.strokeStyle = '#ffd45c';
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.restore();
    }

    ctx.fillStyle = baseColor;
    if (type === 1) {
      ctx.beginPath();
      ctx.moveTo(e.x, e.y - size);
      ctx.lineTo(e.x - size, e.y + size);
      ctx.lineTo(e.x + size, e.y + size);
      ctx.fill();
    } else if (type === 2) {
      ctx.fillRect(e.x - size, e.y - size, size * 2, size * 2);
    } else {
      ctx.beginPath();
      ctx.arc(e.x, e.y, size, 0, Math.PI * 2);
      ctx.fill();
    }

    if (type === 4 || isGiant) {
      const barW = isGiant ? 44 : 40;
      const barY = e.y - size - 10;
      ctx.fillStyle = '#222';
      ctx.fillRect(e.x - barW / 2, barY, barW, 4);
      ctx.fillStyle = isGiant ? '#ffd45c' : '#ff7188';
      ctx.fillRect(e.x - barW / 2, barY, barW * Math.max(0, Math.min(1, e.hp / Math.max(1, e.max))), 4);
    } else if (showHpBars) {
      // Option Enemy HP Bars (#05)
      const barW = Math.max(16, size * 2.2);
      const barY = e.y - size - 6;
      const pct = Math.max(0, Math.min(1, e.hp / Math.max(1, e.max)));
      ctx.fillStyle = 'rgba(10, 20, 35, 0.75)';
      ctx.fillRect(e.x - barW / 2, barY, barW, 2.5);
      ctx.fillStyle = pct > 0.5 ? '#4ade80' : (pct > 0.25 ? '#facc15' : '#ef4444');
      ctx.fillRect(e.x - barW / 2, barY, barW * pct, 2.5);
    }
  }

  function drawTower(ctx, x = 0, y = 0, color = '#6af4ff', size = 14) {
    const showParticles = !(typeof globalThis !== 'undefined' && globalThis.itExtraParticles === false);
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = showParticles ? 24 : 0;
    ctx.fillStyle = '#112b49';
    ctx.fillRect(x - size, y - size, size * 2, size * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.strokeRect(x - size, y - size, size * 2, size * 2);
    ctx.restore();
  }

  // ============================================================================
  // SUB-STEP 1A: PURE, NON-MUTATING SAVE MIGRATION TO V56 (INACTIVE IN GAMEPLAY)
  // ============================================================================

  const MIGRATION_TARGET_VERSION = 56;
  const ACH_MILESTONES_V56 = Object.freeze([50, 100, 250, 500, 1000, 2500, 5000]);
  const BOOSTER_DIAMOND_REFUND_PER_COPY = 20;

  // Target permanent caps for V56 migration refunds (kept separate from active gameplay caps during Sub-Step 1A)
  const V56_WORKSHOP_CAPS = Object.freeze({
    3: 10,   // HP Regen: max 10 Workshop (+10%/s)
    4: 20,   // Critical Chance: max 20 Workshop (+20%)
    5: 3,    // Multishot Count: max 3 Workshop (+3 extra shots)
    10: 5,   // Bounce Shot Count: max 5
    12: 10,  // Defense %: max 10 Workshop (+10%)
    14: 20,  // Thorns: max 20
    15: 72,  // Lifesteal: max 72
    16: 1,   // Energy Shield: max 1
    20: 10,  // Interest: max 10 Workshop
    23: 0,   // Target Priority: Lab-only unique research (0 in Workshop)
    24: 20,  // Burst Chance: max 20 Workshop (+20%)
    25: 4,   // Burst Count: max 4
    26: 0,   // Retired Burst Damage
    28: 0,   // Consolidated into #39 Startup Cash
    29: 50,  // Offense Free Upgrade
    30: 50,  // Defense Free Upgrade
    31: 50,  // Utility Free Upgrade
    32: 50,  // Economy Free Upgrade
    33: 0,   // Projectile Speed: merged into #1 Attack Speed
    34: 0,   // Duplicate Burst Chance: merged into #24 Burst Chance
    35: 20,  // Multishot Chance: max 20 Workshop (+20%)
    36: 20,  // Bounce Shot Chance: max 20 Workshop (+20%)
    37: 50,  // Rapid Fire Chance
    38: 50,  // Life on Wave End
    40: 0    // Life on Wave End (Run-only)
  });

  const V56_LAB_CAPS = Object.freeze({
    8: 4,    // Research Slots: max 4 upgrades (5 slots total)
    85: 5,   // Game Speed: max 5 upgrades (up to x6 from Lab, x10 total with Diamonds/Tree)
    160: 10, // #3 HP Regen: max 10 Lab (+10%/s)
    161: 20, // #4 Critical Chance: max 20 Lab (+20%)
    162: 3,  // #5 Multishot Count: max 3 Lab (+3 extra shots)
    167: 5,  // #10 Bounce Shot Count: max 5
    169: 10, // #12 Defense %: max 10 Lab (+10%)
    171: 10, // #14 Thorns: max 10 Lab
    172: 36, // #15 Lifesteal: max 36 Lab
    173: 1,  // #16 Energy Shield: max 1 Lab
    177: 10, // #20 Interest: max 10 Lab
    180: 1,  // #23 Target Priority: max 1 Lab (unique unlock)
    181: 20, // #24 Burst Chance: max 20 Lab (+20%)
    182: 4,  // #25 Burst Count: max 4 Lab
    183: 0,  // #26 Retired Burst Damage
    185: 0,  // #28 Duplicate Startup Cash -> merged into #196
    190: 0,  // #33 Projectile Speed -> merged into #158 Attack Speed
    191: 0,  // #34 Duplicate Burst Chance -> merged into #181
    192: 20, // #35 Multishot Chance: max 20 Lab (+20%)
    193: 20, // #36 Bounce Shot Chance: max 20 Lab (+20%)
    206: 0,  // FINAL_LAB_NEW Projectile Speed -> merged into #158 Attack Speed
    51: 0    // FAMILIES Projectile Velocity -> merged into #158 Attack Speed
  });

  // Build exact historical Lab base costs table matching index.html (lines 1962-2120)
  const HISTORICAL_LAB_BASE_COSTS = (function buildHistoricalLabTable() {
    const table = {};
    const legacyBases = [100, 120, 150, 200, 250, 300, 400, 600, 500];
    let id = 0;
    for (let i = 0; i < legacyBases.length; i++) {
      table[id++] = { id: i, base: legacyBases[i], isGameSpeed: false };
    }
    for (let i = 0; i < 40; i++) {
      table[id] = { id, base: 999999, isGameSpeed: false, retired: true };
      id++;
    }
    const catNames = ['Offense', 'Defense', 'Economy', 'Laboratory', 'Special', 'Elite'];
    const familyCats = ['Offense', 'Defense', 'Economy', 'Utility', 'Technology', 'Ultimate Weapons', 'Enemies', 'Cards & Perks', ''];
    for (let c = 0; c < familyCats.length; c++) {
      const cat = familyCats[c];
      const catMult = 1 + Math.max(0, catNames.indexOf(cat));
      for (let j = 0; j < 12; j++) {
        const isGameSpeed = (cat === 'Utility' && j === 0);
        const base = Math.ceil(350 * catMult * (1 + j * 0.35));
        table[id] = { id, base, isGameSpeed };
        id++;
      }
    }
    for (let i = 0; i < 40; i++) {
      const u = UPS[i];
      const base = Math.ceil((u ? u[1] : 100) * 5);
      table[id] = { id, base, isGameSpeed: false, workshopIdx: i };
      id++;
    }
    // Exact FINAL_LAB_NEW bases from index.html lines 2052-2060 (IDs 197..212)
    const finalBases = [950, 1100, 1000, 1200, 1300, 1000, 1500, 1500, 1200, 1100, 1500, 2000, 1300, 2000, 2000, 2000];
    for (let i = 0; i < finalBases.length; i++) {
      table[id] = { id, base: finalBases[i], isGameSpeed: false };
      id++;
    }
    table[id] = { id, base: 650, isGameSpeed: false }; id++; // 213: STARTUP_CASH_LAB_ID
    const freeBases = [700, 800, 900, 1000];
    for (let i = 0; i < freeBases.length; i++) {
      table[id] = { id, base: freeBases[i], isGameSpeed: false };
      id++;
    }
    table[id] = { id, base: 1800, isGameSpeed: false }; id++; // 218: Rapid Fire Chance
    table[id] = { id, base: 1800, isGameSpeed: false }; id++; // 219: Rapid Fire
    return Object.freeze(table);
  })();

  function historicalWorkshopPrice(i, lv) {
    const u = UPS[i];
    if (!u) return Number.MAX_SAFE_INTEGER;
    const level = Math.max(0, Math.floor(Number(lv) || 0));
    const x = Math.log(u[1] * 10) + level * Math.log(1.24);
    if (!Number.isFinite(x) || x >= Math.log(Number.MAX_SAFE_INTEGER)) return Number.MAX_SAFE_INTEGER;
    return Math.min(Number.MAX_SAFE_INTEGER, Math.max(1, Math.ceil(Math.exp(x))));
  }

  function historicalWorkshopCumulativeCost(i, fromLv, toLv) {
    const start = Math.max(0, Math.floor(Number(fromLv) || 0));
    const end = Math.max(start, Math.floor(Number(toLv) || 0));
    let total = 0;
    for (let lv = start; lv < end; lv++) {
      const c = historicalWorkshopPrice(i, lv);
      if (total + c >= Number.MAX_SAFE_INTEGER) return Number.MAX_SAFE_INTEGER;
      total += c;
    }
    return total;
  }

  function historicalLabCost(idOrBase, lv, explicitGameSpeed) {
    const level = Math.max(0, Math.floor(Number(lv) || 0));
    let base = 500;
    let isGameSpeed = Boolean(explicitGameSpeed);
    if (typeof idOrBase === 'number' && HISTORICAL_LAB_BASE_COSTS[idOrBase]) {
      base = HISTORICAL_LAB_BASE_COSTS[idOrBase].base;
      if (explicitGameSpeed === undefined) isGameSpeed = HISTORICAL_LAB_BASE_COSTS[idOrBase].isGameSpeed;
    } else if (typeof idOrBase === 'number' && idOrBase > 0) {
      base = idOrBase;
    }
    const mult = isGameSpeed ? 2.65 : 1.32;
    const x = Math.log(base) + level * Math.log(mult);
    if (!Number.isFinite(x) || x >= Math.log(Number.MAX_SAFE_INTEGER)) return Number.MAX_SAFE_INTEGER;
    return Math.min(Number.MAX_SAFE_INTEGER, Math.max(1, Math.ceil(Math.exp(x))));
  }

  function historicalLabCumulativeCost(researchId, fromLv, toLv) {
    const start = Math.max(0, Math.floor(Number(fromLv) || 0));
    const end = Math.max(start, Math.floor(Number(toLv) || 0));
    let total = 0;
    for (let lv = start; lv < end; lv++) {
      const c = historicalLabCost(researchId, lv);
      if (total + c >= Number.MAX_SAFE_INTEGER) return Number.MAX_SAFE_INTEGER;
      total += c;
    }
    return total;
  }

  // Safe, damped 5,000-level cost formula for long-term progression analysis (Sub-Step 1A analysis)
  function longTermLevelPrice(baseCost, lv, mode = 'workshop') {
    const level = Math.max(0, Math.floor(Number(lv) || 0));
    const base = Math.max(1, Number(baseCost) || 20);
    // Damped piecewise log-polynomial growth designed so level 5,000 remains well below 1e13 (and far below MAX_SAFE_INTEGER = 9.007e15)
    // Tier 1 (0..50): familiar early game feel
    // Tier 2 (50..500): mid-game progression
    // Tier 3 (500..5000): smooth asymptotic growth rate ~0.35% per level
    const t1 = Math.min(level, 50);
    const t2 = Math.max(0, Math.min(level - 50, 450));
    const t3 = Math.max(0, level - 500);
    const earlyRate = mode === 'lab' ? 0.080 : 0.072;
    const midRate = mode === 'lab' ? 0.011 : 0.010;
    const lateRate = mode === 'lab' ? 0.0025 : 0.0023;
    const startMult = mode === 'lab' ? 5 : 10;
    const logVal = Math.log(base * startMult) + t1 * earlyRate + t2 * midRate + t3 * lateRate;
    if (!Number.isFinite(logVal) || logVal >= Math.log(Number.MAX_SAFE_INTEGER)) return Number.MAX_SAFE_INTEGER;
    return Math.max(1, Math.ceil(Math.exp(logVal)));
  }

  function calculateLongTermCostTable(baseCost = 20, mode = 'workshop', milestones = [100, 500, 1000, 2500, 5000]) {
    const maxM = Math.max(...milestones, 0);
    const result = {};
    let cumProposed = 0;
    let cumHistorical = 0;
    const targetSet = new Set(milestones);
    for (let lv = 0; lv < maxM; lv++) {
      const pCost = longTermLevelPrice(baseCost, lv, mode);
      cumProposed = Math.min(Number.MAX_SAFE_INTEGER, cumProposed + pCost);
      const hCost = mode === 'lab'
        ? historicalLabCost(baseCost * 5, lv, false)
        : (Math.log(baseCost * 10) + lv * Math.log(1.24) >= Math.log(Number.MAX_SAFE_INTEGER)
          ? Number.MAX_SAFE_INTEGER
          : Math.ceil(Math.exp(Math.log(baseCost * 10) + lv * Math.log(1.24))));
      cumHistorical = cumHistorical >= Number.MAX_SAFE_INTEGER || hCost >= Number.MAX_SAFE_INTEGER
        ? Number.MAX_SAFE_INTEGER
        : Math.min(Number.MAX_SAFE_INTEGER, cumHistorical + hCost);
      const nextLv = lv + 1;
      if (targetSet.has(nextLv)) {
        result[nextLv] = {
          level: nextLv,
          unitCostProposed: pCost,
          cumulativeCostProposed: cumProposed,
          unitCostHistorical: hCost,
          cumulativeCostHistorical: cumHistorical,
          overflowedHistorical: cumHistorical >= Number.MAX_SAFE_INTEGER
        };
      }
    }
    return result;
  }

  function safeNonNegInt(val, fallback = 0) {
    const n = Number(val);
    if (!Number.isFinite(n) || n < 0) return fallback;
    return Math.min(Number.MAX_SAFE_INTEGER, Math.floor(n));
  }

  function deepCloneSaveState(raw) {
    if (raw === null || typeof raw !== 'object') return {};
    try {
      return JSON.parse(JSON.stringify(raw));
    } catch (_) {
      const out = {};
      for (const k of Object.keys(raw)) {
        const v = raw[k];
        if (v !== null && typeof v === 'object') {
          out[k] = Array.isArray(v) ? v.slice() : Object.assign({}, v);
        } else {
          out[k] = v;
        }
      }
      return out;
    }
  }

  function migrateSaveStateToV56(rawState, options = {}) {
    const isValidInput = rawState !== null && typeof rawState === 'object' && !Array.isArray(rawState);
    const state = isValidInput ? deepCloneSaveState(rawState) : {};

    const report = {
      fromVersion: isValidInput && Number.isFinite(Number(rawState.migrationVersion)) ? Number(rawState.migrationVersion) : 0,
      toVersion: MIGRATION_TARGET_VERSION,
      alreadyMigrated: false,
      corruptedInputFixed: !isValidInput,
      goldBefore: 0,
      goldAfter: 0,
      goldAddedTotal: 0,
      diamondsBefore: 0,
      diamondsAfter: 0,
      diamondsAddedTotal: 0,
      workshopConversions: [],
      workshopCapRefunds: [],
      labConversions: [],
      labCapRefunds: [],
      activeResearchesRefunded: [],
      boosterMigration: {
        card12Before: 0,
        card1Before: 0,
        card1After: 0,
        copiesMergedIntoCard1: 0,
        overflowCopiesRefunded: 0,
        diamondsRefunded: 0
      },
      achievementsRecovery: {
        badgesUnlocked: 0,
        trophiesUnlocked: 0,
        achievementCoinBonus: 0,
        newlyRecoveredKeys: []
      }
    };

    // Sanitize base currencies & structures even if already migrated
    const rawGold = Number(state.gold);
    const rawDiamonds = Number(state.diamonds);
    if (!Number.isFinite(rawGold) || rawGold < 0) report.corruptedInputFixed = true;
    if (!Number.isFinite(rawDiamonds) || rawDiamonds < 0) report.corruptedInputFixed = true;
    state.gold = safeNonNegInt(state.gold, 0);
    state.diamonds = safeNonNegInt(state.diamonds, 0);
    report.goldBefore = state.gold;
    report.diamondsBefore = state.diamonds;

    if (!Array.isArray(state.workshop)) {
      if (state.workshop !== undefined) report.corruptedInputFixed = true;
      state.workshop = Array(UPS.length).fill(0);
    } else {
      const cleanW = Array(UPS.length).fill(0);
      for (let i = 0; i < UPS.length; i++) {
        const v = Number(state.workshop[i]);
        if (state.workshop[i] !== undefined && (!Number.isFinite(v) || v < 0)) {
          report.corruptedInputFixed = true;
        }
        cleanW[i] = safeNonNegInt(state.workshop[i], 0);
      }
      state.workshop = cleanW;
    }

    if (!state.labLevels || typeof state.labLevels !== 'object' || Array.isArray(state.labLevels)) {
      if (state.labLevels !== undefined) report.corruptedInputFixed = true;
      state.labLevels = {};
    }

    // Legacy researchLevels array migration (if present from pre-v50 saves)
    if (Array.isArray(state.researchLevels)) {
      for (let i = 0; i < state.researchLevels.length; i++) {
        const lv = safeNonNegInt(state.researchLevels[i], 0);
        if (lv > 0 && state.labLevels[i] === undefined) {
          state.labLevels[i] = lv;
        }
      }
    }

    // Sanitize labLevels values & map known string keys ('w_33', 'Projectile Speed', etc.) to canonical numeric IDs
    const STRING_KEY_TO_LAB_ID = {
      'Projectile Speed': 206,
      'Projectile Velocity': 51,
      'Multishot Chance': 207,
      'Multishot Count': 208,
      'Bounce Chance': 209,
      'Bounce Count': 210,
      'Startup Cash': 213
    };
    for (const k of Object.keys(state.labLevels)) {
      const rawVal = state.labLevels[k];
      const numVal = Number(rawVal);
      if (!Number.isFinite(numVal) || numVal < 0) {
        report.corruptedInputFixed = true;
        delete state.labLevels[k];
        continue;
      }
      const cleanLv = safeNonNegInt(numVal, 0);
      if (k.startsWith('w_')) {
        const wIdx = Number(k.slice(2));
        if (Number.isInteger(wIdx) && wIdx >= 0 && wIdx < 40) {
          const targetId = 157 + wIdx;
          state.labLevels[targetId] = Math.max(safeNonNegInt(state.labLevels[targetId], 0), cleanLv);
        }
        delete state.labLevels[k];
      } else if (STRING_KEY_TO_LAB_ID[k] !== undefined) {
        const targetId = STRING_KEY_TO_LAB_ID[k];
        state.labLevels[targetId] = Math.max(safeNonNegInt(state.labLevels[targetId], 0), cleanLv);
        delete state.labLevels[k];
      } else {
        state.labLevels[k] = cleanLv;
      }
    }

    // Normalize researches array (including legacy single state.research)
    if (!Array.isArray(state.researches)) {
      if (state.researches !== undefined) report.corruptedInputFixed = true;
      state.researches = [];
    }
    if (state.research && typeof state.research === 'object' && !Array.isArray(state.research)) {
      if (Number.isInteger(Number(state.research.i))) {
        state.researches.push({
          i: Number(state.research.i),
          slot: safeNonNegInt(state.research.slot, 0),
          start: safeNonNegInt(state.research.start, 0),
          end: safeNonNegInt(state.research.end, 0)
        });
      }
      delete state.research;
    }

    if (!state.records || typeof state.records !== 'object' || Array.isArray(state.records)) {
      state.records = {};
    }
    if (!state.achUnlocked || typeof state.achUnlocked !== 'object' || Array.isArray(state.achUnlocked)) {
      state.achUnlocked = {};
    }
    if (!state.claimed || typeof state.claimed !== 'object' || Array.isArray(state.claimed)) {
      state.claimed = {};
    }

    // Idempotence guard: if already at version 56, recompute deterministic achievement bonus and return without double-refunding
    if (isValidInput && Number(rawState.migrationVersion) === MIGRATION_TARGET_VERSION) {
      report.alreadyMigrated = true;
      const achSummary = recomputeAchievementsV56(state);
      report.achievementsRecovery = achSummary;
      report.goldAfter = state.gold;
      report.diamondsAfter = state.diamonds;
      Object.defineProperty(state, 'migrationReport', {
        value: report,
        enumerable: false,
        configurable: true,
        writable: true
      });
      return options && options.withReport ? { state, report, changed: false } : state;
    }

    // ------------------------------------------------------------------------
    // 1. WORKSHOP CONVERSIONS (#33 -> #1, #34 -> #24, #28 -> #39, #26 -> refund)
    // ------------------------------------------------------------------------
    function convertWorkshopUpgrade(fromIdx, toIdx, targetCap) {
      const lvFrom = safeNonNegInt(state.workshop[fromIdx], 0);
      if (lvFrom <= 0) return;
      const investedCoins = historicalWorkshopCumulativeCost(fromIdx, 0, lvFrom);
      state.workshop[fromIdx] = 0;

      let remaining = investedCoins;
      const lvToStart = safeNonNegInt(state.workshop[toIdx], 0);
      let lvTo = lvToStart;
      const cap = targetCap ?? 5000;
      while (lvTo < cap) {
        const nextPrice = historicalWorkshopPrice(toIdx, lvTo);
        if (remaining < nextPrice) break;
        remaining -= nextPrice;
        lvTo++;
      }
      state.workshop[toIdx] = lvTo;
      if (remaining > 0) {
        state.gold = Math.min(Number.MAX_SAFE_INTEGER, state.gold + remaining);
      }
      report.workshopConversions.push({
        fromIdx,
        toIdx,
        fromLevelsRemoved: lvFrom,
        investedCoins,
        toLevelBefore: lvToStart,
        toLevelAfter: lvTo,
        levelsGained: lvTo - lvToStart,
        coinsRefunded: remaining
      });
    }

    // Convert Projectile Speed (#33) -> Attack Speed (#1, cap 5000)
    convertWorkshopUpgrade(33, 1, 5000);
    // Consolidate duplicate Burst Chance (#34) -> Burst Chance (#24, cap 20)
    convertWorkshopUpgrade(34, 24, V56_WORKSHOP_CAPS[24]);
    // Consolidate duplicate Startup Cash (#28) -> Startup Cash (#39, cap 5000)
    convertWorkshopUpgrade(28, 39, 5000);

    // ------------------------------------------------------------------------
    // 2. WORKSHOP CAP REFUNDS (Regen, Defense, Interest, Chances, Multishot, Target Priority, etc.)
    // ------------------------------------------------------------------------
    for (const [idxStr, cap] of Object.entries(V56_WORKSHOP_CAPS)) {
      const idx = Number(idxStr);
      const currentLv = safeNonNegInt(state.workshop[idx], 0);
      if (currentLv > cap) {
        const refundCoins = historicalWorkshopCumulativeCost(idx, cap, currentLv);
        state.workshop[idx] = cap;
        state.gold = Math.min(Number.MAX_SAFE_INTEGER, state.gold + refundCoins);
        report.workshopCapRefunds.push({
          idx,
          name: UPS[idx] ? UPS[idx][0] : ('Upgrade #' + idx),
          levelBefore: currentLv,
          levelAfter: cap,
          coinsRefunded: refundCoins
        });
      }
    }

    // ------------------------------------------------------------------------
    // 3. LAB CONVERSIONS & ACTIVE RESEARCH TIMERS
    // ------------------------------------------------------------------------
    // First inspect active research timers in state.researches BEFORE modifying labLevels
    // so that any refunded active research uses the exact level price paid when it was started.
    const RETIRED_OR_MERGED_LAB_IDS = new Set([51, 183, 185, 190, 191, 206, 207, 208, 209, 210, 213]);
    for (let r = 9; r <= 48; r++) RETIRED_OR_MERGED_LAB_IDS.add(r);

    const keptResearches = [];
    for (const item of state.researches) {
      if (!item || typeof item !== 'object') {
        report.corruptedInputFixed = true;
        continue;
      }
      const rId = Number(item.i);
      if (!Number.isInteger(rId) || rId < 0 || !HISTORICAL_LAB_BASE_COSTS[rId]) {
        report.corruptedInputFixed = true;
        continue;
      }
      const currentLv = safeNonNegInt(state.labLevels[rId], 0);
      const cap = V56_LAB_CAPS[rId];
      const paidCoins = Number.isFinite(Number(item.historicalCostPaid)) && Number(item.historicalCostPaid) > 0
        ? safeNonNegInt(item.historicalCostPaid, 0)
        : historicalLabCost(rId, currentLv);
      const shouldCancel = RETIRED_OR_MERGED_LAB_IDS.has(rId) || (cap !== undefined && currentLv >= cap);
      if (shouldCancel) {
        state.gold = Math.min(Number.MAX_SAFE_INTEGER, state.gold + paidCoins);
        report.activeResearchesRefunded.push({
          id: rId,
          levelAtStart: currentLv,
          coinsRefunded: paidCoins
        });
      } else {
        const startTs = safeNonNegInt(item.start, 0);
        const endTs = Math.max(startTs, safeNonNegInt(item.end, startTs));
        keptResearches.push({
          i: rId,
          slot: safeNonNegInt(item.slot, 0),
          start: startTs,
          end: endTs,
          duration: Math.max(0, endTs - startTs),
          historicalCostPaid: paidCoins
        });
      }
    }
    state.researches = keptResearches;

    function convertLabResearchGroup(fromIds, toId, targetCap) {
      let totalInvested = 0;
      const removedDetails = [];
      for (const fId of fromIds) {
        const lv = safeNonNegInt(state.labLevels[fId], 0);
        if (lv > 0) {
          const spent = historicalLabCumulativeCost(fId, 0, lv);
          totalInvested = Math.min(Number.MAX_SAFE_INTEGER, totalInvested + spent);
          removedDetails.push({ id: fId, level: lv, investedCoins: spent });
          delete state.labLevels[fId];
        }
      }
      if (totalInvested <= 0) return;

      let remaining = totalInvested;
      const lvToStart = safeNonNegInt(state.labLevels[toId], 0);
      let lvTo = lvToStart;
      const cap = targetCap ?? 5000;
      while (lvTo < cap) {
        const nextCost = historicalLabCost(toId, lvTo);
        if (remaining < nextCost) break;
        remaining -= nextCost;
        lvTo++;
      }
      if (lvTo > 0) {
        state.labLevels[toId] = lvTo;
      }
      if (remaining > 0) {
        state.gold = Math.min(Number.MAX_SAFE_INTEGER, state.gold + remaining);
      }
      report.labConversions.push({
        from: removedDetails,
        toId,
        investedCoins: totalInvested,
        toLevelBefore: lvToStart,
        toLevelAfter: lvTo,
        levelsGained: lvTo - lvToStart,
        coinsRefunded: remaining
      });
    }

    // Convert all Projectile Speed Lab IDs (190: WORKSHOP_LAB_IDS[33], 206: FINAL_LAB_NEW['Projectile Speed'], 51: Projectile Velocity) -> 158 (WORKSHOP_LAB_IDS[1] Attack Speed)
    convertLabResearchGroup([190, 206, 51], 158, 5000);
    // Consolidate duplicate Burst Chance Lab (191 -> 181)
    convertLabResearchGroup([191], 181, V56_LAB_CAPS[181]);
    // Consolidate duplicate Multishot Chance Lab (207 -> 192)
    convertLabResearchGroup([207], 192, V56_LAB_CAPS[192]);
    // Consolidate duplicate Multishot Count Lab (208 -> 162)
    convertLabResearchGroup([208], 162, V56_LAB_CAPS[162]);
    // Consolidate duplicate Bounce Chance Lab (209 -> 193)
    convertLabResearchGroup([209], 193, V56_LAB_CAPS[193]);
    // Consolidate duplicate Bounce Count Lab (210 -> 167)
    convertLabResearchGroup([210], 167, V56_LAB_CAPS[167]);
    // Consolidate duplicate Startup Cash Lab (185, 213 -> 196)
    convertLabResearchGroup([185, 213], 196, 5000);

    // If a consolidation pushed a target research to its cap while an active timer was running on that target ID, refund that active timer
    const postMergeResearches = [];
    for (const item of state.researches) {
      const rId = item.i;
      const currentLv = safeNonNegInt(state.labLevels[rId], 0);
      const cap = V56_LAB_CAPS[rId];
      if (cap !== undefined && currentLv >= cap) {
        const paidCoins = safeNonNegInt(item.historicalCostPaid, historicalLabCost(rId, currentLv));
        state.gold = Math.min(Number.MAX_SAFE_INTEGER, state.gold + paidCoins);
        report.activeResearchesRefunded.push({
          id: rId,
          levelAtStart: currentLv,
          coinsRefunded: paidCoins
        });
      } else {
        postMergeResearches.push(item);
      }
    }
    state.researches = postMergeResearches;

    // Enforce Lab Caps and refund excess historical Coins
    for (const [idStr, cap] of Object.entries(V56_LAB_CAPS)) {
      const rId = Number(idStr);
      const currentLv = safeNonNegInt(state.labLevels[rId], 0);
      if (currentLv > cap) {
        const refundCoins = historicalLabCumulativeCost(rId, cap, currentLv);
        if (cap === 0) {
          delete state.labLevels[rId];
        } else {
          state.labLevels[rId] = cap;
        }
        state.gold = Math.min(Number.MAX_SAFE_INTEGER, state.gold + refundCoins);
        report.labCapRefunds.push({
          id: rId,
          levelBefore: currentLv,
          levelAfter: cap,
          coinsRefunded: refundCoins
        });
      }
    }

    // ------------------------------------------------------------------------
    // 4. BOOSTER CARD #12 (projectileSpeed) -> CARD #1 (speed) + DIAMOND REFUND
    // ------------------------------------------------------------------------
    if (!state.itBoosterProfile || typeof state.itBoosterProfile !== 'object' || Array.isArray(state.itBoosterProfile)) {
      state.itBoosterProfile = { unlocked: false, cards: {}, active: [] };
    }
    const bp = state.itBoosterProfile;
    if (!bp.cards || typeof bp.cards !== 'object' || Array.isArray(bp.cards)) {
      bp.cards = {};
    }
    if (!Array.isArray(bp.active)) {
      bp.active = [];
    }

    const copies12 = safeNonNegInt(bp.cards[12] ?? bp.cards['12'], 0);
    const copies1Before = safeNonNegInt(bp.cards[1] ?? bp.cards['1'], 0);
    report.boosterMigration.card12Before = copies12;
    report.boosterMigration.card1Before = Math.min(MAX_BOOSTER_COPIES, copies1Before);

    if (copies12 > 0) {
      const clamped1 = Math.min(MAX_BOOSTER_COPIES, copies1Before);
      const roomIn1 = Math.max(0, MAX_BOOSTER_COPIES - clamped1);
      const merged = Math.min(roomIn1, copies12);
      const overflow = copies12 - merged;
      bp.cards[1] = clamped1 + merged;
      delete bp.cards[12];
      delete bp.cards['12'];

      const diamondRefund = overflow * BOOSTER_DIAMOND_REFUND_PER_COPY;
      if (diamondRefund > 0) {
        state.diamonds = Math.min(Number.MAX_SAFE_INTEGER, state.diamonds + diamondRefund);
      }
      report.boosterMigration.card1After = bp.cards[1];
      report.boosterMigration.copiesMergedIntoCard1 = merged;
      report.boosterMigration.overflowCopiesRefunded = overflow;
      report.boosterMigration.diamondsRefunded += diamondRefund;
    } else {
      report.boosterMigration.card1After = Math.min(MAX_BOOSTER_COPIES, copies1Before);
    }

    // Clamp any other booster card > 5 copies and refund excess copies at 20 Diamonds each
    for (const k of Object.keys(bp.cards)) {
      const id = Number(k);
      if (!Number.isInteger(id) || id < 0 || id >= BOOSTER_CARDS.length || id === 12) {
        delete bp.cards[k];
        continue;
      }
      const c = safeNonNegInt(bp.cards[k], 0);
      if (c <= 0) {
        delete bp.cards[k];
      } else if (c > MAX_BOOSTER_COPIES) {
        const extra = c - MAX_BOOSTER_COPIES;
        bp.cards[id] = MAX_BOOSTER_COPIES;
        const refundD = extra * BOOSTER_DIAMOND_REFUND_PER_COPY;
        state.diamonds = Math.min(Number.MAX_SAFE_INTEGER, state.diamonds + refundD);
        report.boosterMigration.overflowCopiesRefunded += extra;
        report.boosterMigration.diamondsRefunded += refundD;
      } else {
        bp.cards[id] = c;
      }
    }

    // Replace active card 12 with 1 and deduplicate active deck
    const cleanActive = [];
    const seenActive = new Set();
    for (const rawId of bp.active) {
      let id = Number(rawId);
      if (id === 12) id = 1;
      if (!Number.isInteger(id) || id < 0 || id >= BOOSTER_CARDS.length) continue;
      if (seenActive.has(id)) continue;
      if ((bp.cards[id] || 0) <= 0) continue;
      seenActive.add(id);
      cleanActive.push(id);
      if (cleanActive.length >= 5) break;
    }
    bp.active = cleanActive;

    // ------------------------------------------------------------------------
    // 5. IN-RUN SNAPSHOT MIGRATION (IF PRESENT)
    // ------------------------------------------------------------------------
    if (state.runSnapshot && typeof state.runSnapshot === 'object' && Array.isArray(state.runSnapshot.up)) {
      const up = state.runSnapshot.up;
      if (safeNonNegInt(up[33], 0) > 0) {
        up[1] = safeNonNegInt(up[1], 0) + safeNonNegInt(up[33], 0);
        up[33] = 0;
      }
      if (safeNonNegInt(up[34], 0) > 0) {
        up[24] = Math.min(20, safeNonNegInt(up[24], 0) + safeNonNegInt(up[34], 0));
        up[34] = 0;
      }
      if (safeNonNegInt(up[28], 0) > 0) {
        up[39] = safeNonNegInt(up[39], 0) + safeNonNegInt(up[28], 0);
        up[28] = 0;
      }
    }

    // ------------------------------------------------------------------------
    // 6. RETROACTIVE ACHIEVEMENTS RECOVERY (50 SERIES: MAP 1..10 x DIFF 0..4)
    // ------------------------------------------------------------------------
    report.achievementsRecovery = recomputeAchievementsV56(state);

    state.migrationVersion = MIGRATION_TARGET_VERSION;
    report.goldAfter = state.gold;
    report.goldAddedTotal = state.gold - report.goldBefore;
    report.diamondsAfter = state.diamonds;
    report.diamondsAddedTotal = state.diamonds - report.diamondsBefore;

    Object.defineProperty(state, 'migrationReport', {
      value: report,
      enumerable: false,
      configurable: true,
      writable: true
    });

    return options && options.withReport ? { state, report, changed: true } : state;
  }

  function recomputeAchievementsV56(state) {
    let badgesUnlocked = 0;
    let trophiesUnlocked = 0;
    const newlyRecoveredKeys = [];

    for (let m = 1; m <= 10; m++) {
      for (let d = 0; d <= 4; d++) {
        const seriesKey = `${m}-${d}`;
        let bestWave = safeNonNegInt(state.records[seriesKey], 0);
        for (const w of ACH_MILESTONES_V56) {
          const k = `${m}-${d}-${w}`;
          if (state.achUnlocked[k] || state.claimed[k]) {
            bestWave = Math.max(bestWave, w);
          }
        }
        if (bestWave > 0 && safeNonNegInt(state.records[seriesKey], 0) < bestWave) {
          state.records[seriesKey] = bestWave;
        }

        let allSevenUnlocked = true;
        for (const w of ACH_MILESTONES_V56) {
          const k = `${m}-${d}-${w}`;
          if (bestWave >= w) {
            if (!state.achUnlocked[k]) {
              state.achUnlocked[k] = true;
              newlyRecoveredKeys.push(k);
            }
            badgesUnlocked++;
          } else {
            allSevenUnlocked = false;
          }
        }

        const trophyKey = `${m}-${d}-complete`;
        if (allSevenUnlocked || state.achUnlocked[trophyKey]) {
          if (!state.achUnlocked[trophyKey]) {
            state.achUnlocked[trophyKey] = true;
            newlyRecoveredKeys.push(trophyKey);
          }
          trophiesUnlocked++;
        }
      }
    }

    const bonus = Math.min(5.0, Number(((badgesUnlocked * 0.01) + (trophiesUnlocked * 0.03)).toFixed(4)));
    state.achievementCoinBonus = bonus;

    return {
      badgesUnlocked,
      trophiesUnlocked,
      achievementCoinBonus: bonus,
      newlyRecoveredKeys
    };
  }

  // ============================================================================
  // SUB-STEP 1B: SAFE V56 LOAD PIPELINE, DURABLE BACKUP, VALIDATION & ROLLBACK
  // ============================================================================

  const BACKUP_KEYS_V56 = Object.freeze({
    PRIMARY: 'infinite-tower-backup-pre-v56-primary',
    MIRROR: 'infinite-tower-backup-pre-v56-mirror',
    LEGACY_ARCHIVE: 'infinite-tower-production-v55-pre56-archive',
    JOURNAL: 'infinite-tower-v56-migration-journal',
    ACTIVE_SLOT_A: 'infinite-tower-production-v55-a',
    ACTIVE_SLOT_B: 'infinite-tower-production-v55-b',
    ACTIVE_LEGACY: 'infinite-tower-production-v55-legacy',
    PREVIEW_210: 'infinite-tower-210-preview-v1'
  });

  function saveHashV56(data) {
    const str = String(data ?? '');
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16);
  }

  function extractCanonicalPreMigrationSnapshot(rawState) {
    const isValid = rawState !== null && typeof rawState === 'object' && !Array.isArray(rawState);
    const s = isValid ? deepCloneSaveState(rawState) : {};

    const gold = safeNonNegInt(s.gold, 0);
    const diamonds = safeNonNegInt(s.diamonds, 0);
    const xp = safeNonNegInt(s.xp, 0);
    const level = Math.max(1, safeNonNegInt(s.level, 1));
    const sp = safeNonNegInt(s.sp, 0);
    const spent = Array.isArray(s.spent) ? s.spent.slice() : [];
    const speedDiamonds = safeNonNegInt(s.speedDiamonds, 0);
    const speedTree = safeNonNegInt(s.speedTree, 0);
    const kills = safeNonNegInt(s.kills, 0);
    const totalRuns = safeNonNegInt(s.totalRuns, 0);

    const workshop = Array(UPS.length).fill(0);
    if (Array.isArray(s.workshop)) {
      for (let i = 0; i < UPS.length; i++) {
        workshop[i] = safeNonNegInt(s.workshop[i], 0);
      }
    }

    let workshopCoins = 0;
    for (let i = 0; i < UPS.length; i++) {
      if (workshop[i] > 0) {
        workshopCoins = Math.min(Number.MAX_SAFE_INTEGER, workshopCoins + historicalWorkshopCumulativeCost(i, 0, workshop[i]));
      }
    }

    const rawLabs = (s.labLevels && typeof s.labLevels === 'object' && !Array.isArray(s.labLevels)) ? Object.assign({}, s.labLevels) : {};
    if (Array.isArray(s.researchLevels)) {
      for (let i = 0; i < s.researchLevels.length; i++) {
        const lv = safeNonNegInt(s.researchLevels[i], 0);
        if (lv > 0 && rawLabs[i] === undefined) rawLabs[i] = lv;
      }
    }

    const STRING_KEY_TO_LAB_ID = {
      'Projectile Speed': 206,
      'Projectile Velocity': 51,
      'Multishot Chance': 207,
      'Multishot Count': 208,
      'Bounce Chance': 209,
      'Bounce Count': 210,
      'Startup Cash': 213
    };
    const labLevels = {};
    for (const k of Object.keys(rawLabs)) {
      const numVal = Number(rawLabs[k]);
      if (!Number.isFinite(numVal) || numVal < 0) continue;
      const cleanLv = safeNonNegInt(numVal, 0);
      if (cleanLv <= 0) continue;
      if (k.startsWith('w_')) {
        const wIdx = Number(k.slice(2));
        if (Number.isInteger(wIdx) && wIdx >= 0 && wIdx < 40) {
          const targetId = 157 + wIdx;
          labLevels[targetId] = Math.max(safeNonNegInt(labLevels[targetId], 0), cleanLv);
        }
      } else if (STRING_KEY_TO_LAB_ID[k] !== undefined) {
        const targetId = STRING_KEY_TO_LAB_ID[k];
        labLevels[targetId] = Math.max(safeNonNegInt(labLevels[targetId], 0), cleanLv);
      } else {
        const idNum = Number(k);
        if (Number.isInteger(idNum) && idNum >= 0 && HISTORICAL_LAB_BASE_COSTS[idNum]) {
          labLevels[idNum] = Math.max(safeNonNegInt(labLevels[idNum], 0), cleanLv);
        }
      }
    }

    let labCoins = 0;
    for (const [idStr, lv] of Object.entries(labLevels)) {
      const rId = Number(idStr);
      if (lv > 0 && HISTORICAL_LAB_BASE_COSTS[rId]) {
        labCoins = Math.min(Number.MAX_SAFE_INTEGER, labCoins + historicalLabCumulativeCost(rId, 0, lv));
      }
    }

    const rawResearches = Array.isArray(s.researches) ? s.researches.slice() : [];
    if (s.research && typeof s.research === 'object' && !Array.isArray(s.research) && Number.isInteger(Number(s.research.i))) {
      rawResearches.push({
        i: Number(s.research.i),
        slot: safeNonNegInt(s.research.slot, 0),
        start: safeNonNegInt(s.research.start, 0),
        end: safeNonNegInt(s.research.end, 0)
      });
    }

    const researches = [];
    let activeResearchCoins = 0;
    for (const item of rawResearches) {
      if (!item || typeof item !== 'object') continue;
      const rId = Number(item.i);
      if (!Number.isInteger(rId) || rId < 0 || !HISTORICAL_LAB_BASE_COSTS[rId]) continue;
      const lvAtStart = safeNonNegInt(labLevels[rId], 0);
      const paidCoins = Number.isFinite(Number(item.historicalCostPaid)) && Number(item.historicalCostPaid) > 0
        ? safeNonNegInt(item.historicalCostPaid, 0)
        : historicalLabCost(rId, lvAtStart);
      const startTs = safeNonNegInt(item.start, 0);
      const endTs = Math.max(startTs, safeNonNegInt(item.end, startTs));
      researches.push({
        i: rId,
        slot: safeNonNegInt(item.slot, 0),
        start: startTs,
        end: endTs,
        duration: Math.max(0, endTs - startTs),
        paidCoins
      });
      activeResearchCoins = Math.min(Number.MAX_SAFE_INTEGER, activeResearchCoins + paidCoins);
    }

    const bpCards = (s.itBoosterProfile && typeof s.itBoosterProfile === 'object' && s.itBoosterProfile.cards && typeof s.itBoosterProfile.cards === 'object' && !Array.isArray(s.itBoosterProfile.cards))
      ? s.itBoosterProfile.cards
      : {};
    const c1 = safeNonNegInt(bpCards[1] ?? bpCards['1'], 0);
    const c12 = safeNonNegInt(bpCards[12] ?? bpCards['12'], 0);
    const clamped1 = Math.min(MAX_BOOSTER_COPIES, c1);
    const merged12 = Math.min(Math.max(0, MAX_BOOSTER_COPIES - clamped1), c12);
    let overflowCopies = (c1 > MAX_BOOSTER_COPIES ? c1 - MAX_BOOSTER_COPIES : 0) + (c12 - merged12);
    for (const k of Object.keys(bpCards)) {
      const id = Number(k);
      if (!Number.isInteger(id) || id < 0 || id >= BOOSTER_CARDS.length || id === 1 || id === 12) continue;
      const count = safeNonNegInt(bpCards[k], 0);
      if (count > MAX_BOOSTER_COPIES) overflowCopies += (count - MAX_BOOSTER_COPIES);
    }

    const records = {};
    if (s.records && typeof s.records === 'object' && !Array.isArray(s.records)) {
      for (const [k, v] of Object.entries(s.records)) {
        records[k] = safeNonNegInt(v, 0);
      }
    }
    const claimed = {};
    if (s.claimed && typeof s.claimed === 'object' && !Array.isArray(s.claimed)) {
      for (const [k, v] of Object.entries(s.claimed)) {
        if (v) claimed[k] = true;
      }
    }

    const hasRunSnapshot = Boolean(s.runSnapshot && typeof s.runSnapshot === 'object' && !Array.isArray(s.runSnapshot));
    const runSnapshotCash = hasRunSnapshot ? safeNonNegInt(s.runSnapshot.cash, 0) : null;

    return {
      gold,
      diamonds,
      xp,
      level,
      sp,
      spent,
      speedDiamonds,
      speedTree,
      kills,
      totalRuns,
      workshop,
      labLevels,
      researches,
      workshopCoins,
      labCoins,
      activeResearchCoins,
      totalEconomicCoins: gold + workshopCoins + labCoins + activeResearchCoins,
      card1Before: c1,
      card12Before: c12,
      expectedCard1After: clamped1 + merged12,
      expectedBoosterOverflowCopies: overflowCopies,
      expectedDiamondRefund: overflowCopies * BOOSTER_DIAMOND_REFUND_PER_COPY,
      records,
      claimed,
      hasRunSnapshot,
      runSnapshotCash
    };
  }

  function validateMigratedStateV56(beforeState, afterState, report) {
    const errors = [];
    const checks = {
      structureAndVersion: false,
      exactEconomicCoinConservation: false,
      conversionsAndCapsEnforced: false,
      activeResearchesPreserved: false,
      boosterAndDiamondConservation: false,
      currencyAndProgressionIsolation: false,
      recordsAndAchievementsIntegrity: false
    };

    if (!afterState || typeof afterState !== 'object' || Array.isArray(afterState)) {
      errors.push('afterState is not a valid object');
      return { valid: false, errors, checks };
    }

    const pre = extractCanonicalPreMigrationSnapshot(beforeState);

    // 1. Structure & Version Check
    if (afterState.migrationVersion !== MIGRATION_TARGET_VERSION) {
      errors.push(`migrationVersion must be ${MIGRATION_TARGET_VERSION}, got ${afterState.migrationVersion}`);
    }
    if (!Array.isArray(afterState.workshop) || afterState.workshop.length !== UPS.length) {
      errors.push('afterState.workshop must be an array of length ' + UPS.length);
    } else {
      for (let i = 0; i < UPS.length; i++) {
        const v = afterState.workshop[i];
        if (!Number.isInteger(v) || v < 0) {
          errors.push(`Invalid workshop level at index ${i}: ${v}`);
          break;
        }
      }
    }
    if (!afterState.labLevels || typeof afterState.labLevels !== 'object' || Array.isArray(afterState.labLevels)) {
      errors.push('afterState.labLevels must be a plain object');
    } else {
      for (const [k, v] of Object.entries(afterState.labLevels)) {
        if (!Number.isInteger(v) || v < 0) {
          errors.push(`Invalid lab level at key ${k}: ${v}`);
          break;
        }
      }
    }
    if (!Array.isArray(afterState.researches)) {
      errors.push('afterState.researches must be an array');
    }
    if (!Number.isInteger(afterState.gold) || afterState.gold < 0) {
      errors.push(`Invalid afterState.gold: ${afterState.gold}`);
    }
    if (!Number.isInteger(afterState.diamonds) || afterState.diamonds < 0) {
      errors.push(`Invalid afterState.diamonds: ${afterState.diamonds}`);
    }
    if (errors.length === 0) {
      checks.structureAndVersion = true;
    }

    // 2. Exact Economic Coin Conservation Check (not just comparing gold balance)
    let afterWorkshopCoins = 0;
    if (Array.isArray(afterState.workshop)) {
      for (let i = 0; i < UPS.length; i++) {
        const lv = safeNonNegInt(afterState.workshop[i], 0);
        if (lv > 0) {
          afterWorkshopCoins = Math.min(Number.MAX_SAFE_INTEGER, afterWorkshopCoins + historicalWorkshopCumulativeCost(i, 0, lv));
        }
      }
    }
    let afterLabCoins = 0;
    if (afterState.labLevels && typeof afterState.labLevels === 'object') {
      for (const [idStr, lvVal] of Object.entries(afterState.labLevels)) {
        const rId = Number(idStr);
        const lv = safeNonNegInt(lvVal, 0);
        if (lv > 0 && HISTORICAL_LAB_BASE_COSTS[rId]) {
          afterLabCoins = Math.min(Number.MAX_SAFE_INTEGER, afterLabCoins + historicalLabCumulativeCost(rId, 0, lv));
        }
      }
    }
    let afterActiveResearchCoins = 0;
    if (Array.isArray(afterState.researches)) {
      for (const r of afterState.researches) {
        if (!r || typeof r !== 'object') continue;
        const rId = Number(r.i);
        const paid = Number.isFinite(Number(r.historicalCostPaid)) && Number(r.historicalCostPaid) > 0
          ? safeNonNegInt(r.historicalCostPaid, 0)
          : historicalLabCost(rId, safeNonNegInt(afterState.labLevels?.[rId], 0));
        afterActiveResearchCoins = Math.min(Number.MAX_SAFE_INTEGER, afterActiveResearchCoins + paid);
      }
    }
    const afterTotalEconomicCoins = safeNonNegInt(afterState.gold, 0) + afterWorkshopCoins + afterLabCoins + afterActiveResearchCoins;
    if (afterState.gold < pre.gold) {
      errors.push(`Gold decreased during migration: before=${pre.gold}, after=${afterState.gold}`);
    } else if (afterTotalEconomicCoins !== pre.totalEconomicCoins) {
      errors.push(`Total historical Coin value mismatch: before=${pre.totalEconomicCoins}, after=${afterTotalEconomicCoins}`);
    } else {
      checks.exactEconomicCoinConservation = true;
    }

    // 3. Conversions & Caps Enforcement Check
    let capsOk = true;
    if (Array.isArray(afterState.workshop)) {
      for (const [idxStr, cap] of Object.entries(V56_WORKSHOP_CAPS)) {
        const idx = Number(idxStr);
        if ((afterState.workshop[idx] || 0) > cap) {
          errors.push(`Workshop #${idx} level ${afterState.workshop[idx]} exceeds V56 cap ${cap}`);
          capsOk = false;
        }
      }
      if (pre.workshop[33] > 0 && afterState.workshop[1] < pre.workshop[1]) {
        errors.push('Attack Speed (#1) decreased during Projectile Speed (#33) conversion');
        capsOk = false;
      }
    }
    const retiredLabIds = [51, 183, 185, 190, 191, 206, 207, 208, 209, 210, 213];
    if (afterState.labLevels && typeof afterState.labLevels === 'object') {
      for (const rId of retiredLabIds) {
        if ((afterState.labLevels[rId] || 0) > 0) {
          errors.push(`Retired/merged Lab ID ${rId} still has level ${afterState.labLevels[rId]}`);
          capsOk = false;
        }
      }
      for (const [idStr, cap] of Object.entries(V56_LAB_CAPS)) {
        const rId = Number(idStr);
        if ((afterState.labLevels[rId] || 0) > cap) {
          errors.push(`Lab ID ${rId} level ${afterState.labLevels[rId]} exceeds V56 cap ${cap}`);
          capsOk = false;
        }
      }
      const hadLabProj = (pre.labLevels[190] || 0) + (pre.labLevels[206] || 0) + (pre.labLevels[51] || 0) > 0;
      if (hadLabProj && (afterState.labLevels[158] || 0) < (pre.labLevels[158] || 0)) {
        errors.push('Lab Attack Speed (158) decreased during Lab Projectile Speed conversion');
        capsOk = false;
      }
    }
    if (capsOk) {
      checks.conversionsAndCapsEnforced = true;
    }

    // 4. Active Researches Preservation Check (durations, timestamps, and historical costs)
    let researchesOk = true;
    const retiredSet = new Set(retiredLabIds);
    for (let r = 9; r <= 48; r++) retiredSet.add(r);
    for (const preR of pre.researches) {
      const cap = V56_LAB_CAPS[preR.i];
      const postLv = safeNonNegInt(afterState.labLevels?.[preR.i], 0);
      const shouldHaveBeenKept = !retiredSet.has(preR.i) && !(cap !== undefined && (safeNonNegInt(pre.labLevels[preR.i], 0) >= cap || postLv >= cap));
      if (shouldHaveBeenKept) {
        const match = (afterState.researches || []).find(
          x => x && x.i === preR.i && x.start === preR.start && x.end === preR.end
        );
        if (!match) {
          errors.push(`Valid active research ID ${preR.i} (start=${preR.start}, end=${preR.end}) was lost or altered`);
          researchesOk = false;
        }
      }
    }
    if (researchesOk) {
      checks.activeResearchesPreserved = true;
    }

    // 5. Booster Card #12 & Diamond Conservation Check
    let boosterOk = true;
    const afterBp = afterState.itBoosterProfile;
    if (!afterBp || typeof afterBp !== 'object' || !afterBp.cards || !Array.isArray(afterBp.active)) {
      errors.push('afterState.itBoosterProfile is missing or malformed');
      boosterOk = false;
    } else {
      if ((afterBp.cards[12] ?? afterBp.cards['12']) !== undefined) {
        errors.push('Booster Card #12 was not removed after migration');
        boosterOk = false;
      }
      const afterCard1 = safeNonNegInt(afterBp.cards[1] ?? afterBp.cards['1'], 0);
      if (afterCard1 !== pre.expectedCard1After) {
        errors.push(`Booster Card #1 expected ${pre.expectedCard1After} copies, got ${afterCard1}`);
        boosterOk = false;
      }
      const expectedDiamonds = pre.diamonds + pre.expectedDiamondRefund;
      if (afterState.diamonds !== expectedDiamonds) {
        errors.push(`Diamonds mismatch after booster migration: expected=${expectedDiamonds}, got=${afterState.diamonds}`);
        boosterOk = false;
      }
      if (afterBp.active.includes(12)) {
        errors.push('Active booster deck still contains Card #12');
        boosterOk = false;
      }
      if (new Set(afterBp.active).size !== afterBp.active.length) {
        errors.push('Active booster deck contains duplicate card IDs');
        boosterOk = false;
      }
    }
    if (boosterOk) {
      checks.boosterAndDiamondConservation = true;
    }

    // 6. Currency & Progression Isolation Check (Coins vs Cash vs Diamonds vs XP vs SP)
    let isolationOk = true;
    if (safeNonNegInt(afterState.xp, 0) !== pre.xp) {
      errors.push(`XP altered during migration: before=${pre.xp}, after=${afterState.xp}`);
      isolationOk = false;
    }
    if (Math.max(1, safeNonNegInt(afterState.level, 1)) !== pre.level && afterState.level !== undefined) {
      errors.push(`Player level altered during migration: before=${pre.level}, after=${afterState.level}`);
      isolationOk = false;
    }
    if (safeNonNegInt(afterState.sp, 0) !== pre.sp) {
      errors.push(`Skill points (SP) altered during migration: before=${pre.sp}, after=${afterState.sp}`);
      isolationOk = false;
    }
    if (Array.isArray(afterState.spent) && JSON.stringify(afterState.spent) !== JSON.stringify(pre.spent)) {
      errors.push('Skill tree spent nodes altered during migration');
      isolationOk = false;
    }
    if (safeNonNegInt(afterState.speedDiamonds, 0) !== pre.speedDiamonds || safeNonNegInt(afterState.speedTree, 0) !== pre.speedTree) {
      errors.push('Permanent speed unlocks altered during migration');
      isolationOk = false;
    }
    if (pre.hasRunSnapshot) {
      const afterCash = safeNonNegInt(afterState.runSnapshot?.cash, 0);
      if (afterCash !== pre.runSnapshotCash) {
        errors.push(`In-run Cash was altered or confused with Coins: before=${pre.runSnapshotCash}, after=${afterCash}`);
        isolationOk = false;
      }
    }
    if (isolationOk) {
      checks.currencyAndProgressionIsolation = true;
    }

    // 7. Records & Achievements Integrity Check
    let achOk = true;
    for (const [k, prevWave] of Object.entries(pre.records)) {
      const afterWave = safeNonNegInt(afterState.records?.[k], 0);
      if (afterWave < prevWave) {
        errors.push(`Wave record for ${k} regressed: before=${prevWave}, after=${afterWave}`);
        achOk = false;
      }
    }
    for (const k of Object.keys(pre.claimed)) {
      if (!afterState.claimed?.[k]) {
        errors.push(`Previously claimed achievement ${k} was lost`);
        achOk = false;
      }
    }
    const bonus = Number(afterState.achievementCoinBonus);
    if (!Number.isFinite(bonus) || bonus < 0 || bonus > 5.0) {
      errors.push(`Invalid achievementCoinBonus: ${afterState.achievementCoinBonus}`);
      achOk = false;
    }
    if (achOk) {
      checks.recordsAndAchievementsIntegrity = true;
    }

    return {
      valid: errors.length === 0,
      errors,
      checks,
      summary: {
        totalEconomicCoinsBefore: pre.totalEconomicCoins,
        totalEconomicCoinsAfter: afterTotalEconomicCoins,
        diamondsBefore: pre.diamonds,
        diamondsAfter: afterState.diamonds
      }
    };
  }

  function isValidStorageAdapter(storage) {
    return Boolean(
      storage &&
      typeof storage.getItem === 'function' &&
      typeof storage.setItem === 'function'
    );
  }

  function createPreV56Backup(storage, rawState, options = {}) {
    if (!isValidStorageAdapter(storage)) {
      return { ok: false, reason: 'invalid_storage_adapter' };
    }
    const isValidObj = rawState !== null && typeof rawState === 'object' && !Array.isArray(rawState);
    if (!isValidObj) {
      return { ok: false, reason: 'invalid_raw_state' };
    }

    // If a verified pre-V56 backup already exists, preserve it intact so the original pre-V56 state is never overwritten!
    if (options.preserveExistingBackup !== false) {
      const existingCheck = verifyPreV56Backup(storage, null, options);
      if (existingCheck.ok) {
        return {
          ok: true,
          preservedExisting: true,
          hash: existingCheck.hash,
          backupBundle: existingCheck.backupBundle
        };
      }
    }

    try {
      const dataStr = JSON.stringify(rawState);
      const hash = saveHashV56(dataStr);
      const rawSlots = {
        slotA: storage.getItem(BACKUP_KEYS_V56.ACTIVE_SLOT_A),
        slotB: storage.getItem(BACKUP_KEYS_V56.ACTIVE_SLOT_B),
        legacy: storage.getItem(BACKUP_KEYS_V56.ACTIVE_LEGACY),
        preview210: storage.getItem(BACKUP_KEYS_V56.PREVIEW_210)
      };
      const bundle = {
        backupFormat: 'infinite-tower-pre-v56-v1',
        createdAt: Number(options.now) || Date.now(),
        migrationVersionBefore: Number(rawState.migrationVersion) || 0,
        hash,
        data: dataStr,
        rawSlots
      };
      const serializedBundle = JSON.stringify(bundle);

      storage.setItem(BACKUP_KEYS_V56.PRIMARY, serializedBundle);
      storage.setItem(BACKUP_KEYS_V56.MIRROR, serializedBundle);
      storage.setItem(BACKUP_KEYS_V56.LEGACY_ARCHIVE, dataStr);

      if (typeof options.externalBackupWriter === 'function') {
        const extOk = options.externalBackupWriter(serializedBundle, bundle);
        if (!extOk) {
          return { ok: false, reason: 'external_backup_writer_failed' };
        }
      }

      const verification = verifyPreV56Backup(storage, rawState, options);
      if (!verification.ok) {
        return { ok: false, reason: verification.reason || 'backup_verification_failed' };
      }

      return {
        ok: true,
        preservedExisting: false,
        hash,
        backupBundle: bundle
      };
    } catch (err) {
      return {
        ok: false,
        reason: 'backup_write_exception',
        error: String(err && err.message ? err.message : err)
      };
    }
  }

  function verifyPreV56Backup(storage, expectedState, options = {}) {
    if (!isValidStorageAdapter(storage)) {
      return { ok: false, reason: 'invalid_storage_adapter' };
    }
    try {
      const primaryRaw = storage.getItem(BACKUP_KEYS_V56.PRIMARY);
      const mirrorRaw = storage.getItem(BACKUP_KEYS_V56.MIRROR);
      const archiveRaw = storage.getItem(BACKUP_KEYS_V56.LEGACY_ARCHIVE);

      if (!primaryRaw && !mirrorRaw) {
        return { ok: false, reason: 'missing_backup_keys' };
      }

      function parseAndCheckBundle(rawStr) {
        if (!rawStr || typeof rawStr !== 'string') return null;
        const parsed = JSON.parse(rawStr);
        if (!parsed || typeof parsed !== 'object' || typeof parsed.data !== 'string' || typeof parsed.hash !== 'string') {
          return null;
        }
        const computedHash = saveHashV56(parsed.data);
        if (computedHash !== parsed.hash) return null;
        const stateObj = JSON.parse(parsed.data);
        if (!stateObj || typeof stateObj !== 'object' || Array.isArray(stateObj)) return null;
        return { bundle: parsed, state: stateObj };
      }

      const primaryChecked = parseAndCheckBundle(primaryRaw);
      const mirrorChecked = parseAndCheckBundle(mirrorRaw);

      if (!primaryChecked && !mirrorChecked) {
        return { ok: false, reason: 'corrupted_backup_bundles' };
      }

      // When creating a fresh backup (expectedState provided), require both PRIMARY and MIRROR + LEGACY_ARCHIVE to match
      if (expectedState !== null && expectedState !== undefined) {
        if (!primaryChecked || !mirrorChecked) {
          return { ok: false, reason: 'redundant_backup_slot_missing_or_corrupt' };
        }
        const expectedStr = JSON.stringify(expectedState);
        const expectedHash = saveHashV56(expectedStr);
        if (primaryChecked.bundle.hash !== expectedHash || mirrorChecked.bundle.hash !== expectedHash) {
          return { ok: false, reason: 'backup_hash_mismatch_with_expected_state' };
        }
        if (archiveRaw !== expectedStr) {
          return { ok: false, reason: 'legacy_archive_mismatch' };
        }
      }

      if (typeof options.externalBackupReader === 'function') {
        const extRaw = options.externalBackupReader();
        const extChecked = parseAndCheckBundle(extRaw);
        if (!extChecked) {
          return { ok: false, reason: 'external_backup_verification_failed' };
        }
      } else if (options.requireExternalBackup === true) {
        return { ok: false, reason: 'external_backup_required_but_missing' };
      }

      const validEntry = primaryChecked || mirrorChecked;
      return {
        ok: true,
        valid: true,
        source: primaryChecked ? 'primary' : 'mirror',
        hash: validEntry.bundle.hash,
        seq: validEntry.bundle.seq || 0,
        state: validEntry.state,
        backupBundle: validEntry.bundle,
        restorableState: validEntry.state
      };
    } catch (err) {
      return {
        ok: false,
        reason: 'backup_verify_exception',
        error: String(err && err.message ? err.message : err)
      };
    }
  }

  function readNewestCheckedSlotFromStorage(storage) {
    if (!isValidStorageAdapter(storage)) return { state: null, maxSeq: 0 };
    function readSlot(key) {
      try {
        const raw = storage.getItem(key);
        if (!raw) return null;
        const o = JSON.parse(raw);
        if (!o || typeof o.data !== 'string' || o.hash !== saveHashV56(o.data)) return null;
        const st = JSON.parse(o.data);
        if (!st || typeof st !== 'object' || Array.isArray(st)) return null;
        return { state: st, seq: Number(o.seq) || 0 };
      } catch (_) {
        return null;
      }
    }
    const a = readSlot(BACKUP_KEYS_V56.ACTIVE_SLOT_A);
    const b = readSlot(BACKUP_KEYS_V56.ACTIVE_SLOT_B);
    const maxSeq = Math.max(a ? a.seq : 0, b ? b.seq : 0);
    if (a || b) {
      const chosen = (!b || (a && a.seq >= b.seq)) ? a : b;
      return { state: chosen.state, maxSeq, source: chosen === a ? 'slot_a' : 'slot_b' };
    }
    try {
      const legRaw = storage.getItem(BACKUP_KEYS_V56.ACTIVE_LEGACY);
      if (legRaw) {
        const legState = JSON.parse(legRaw);
        if (legState && typeof legState === 'object' && !Array.isArray(legState)) {
          return { state: legState, maxSeq: 0, source: 'legacy' };
        }
      }
    } catch (_) {}
    return { state: null, maxSeq: 0, source: 'none' };
  }

  function writeCheckedSlotToStorage(storage, stateObj, nextSeq, alsoWriteLegacy = true) {
    const data = JSON.stringify(stateObj);
    const seq = Math.max(1, Math.floor(Number(nextSeq) || 1));
    const slotKey = (seq % 2) ? BACKUP_KEYS_V56.ACTIVE_SLOT_A : BACKUP_KEYS_V56.ACTIVE_SLOT_B;
    const payload = JSON.stringify({ seq, data, hash: saveHashV56(data) });
    storage.setItem(slotKey, payload);
    if (alsoWriteLegacy) {
      storage.setItem(BACKUP_KEYS_V56.ACTIVE_LEGACY, data);
    }
    return { seq, slotKey, hash: saveHashV56(data) };
  }

  function restorePreV56Backup(storage, options = {}) {
    const check = verifyPreV56Backup(storage, null, options);
    if (!check.ok) {
      return {
        restored: false,
        reason: check.reason || 'no_valid_backup_to_restore'
      };
    }

    try {
      const bundle = check.backupBundle;
      const restoredState = deepCloneSaveState(check.restorableState);
      const currentSlots = readNewestCheckedSlotFromStorage(storage);
      let nextSeq = currentSlots.maxSeq;

      // Restore original raw slots if they existed, AND write a new highest-sequence checked slot
      // so readGameSave() deterministically loads the restored pre-V56 state without deleting any key.
      if (bundle.rawSlots && typeof bundle.rawSlots === 'object') {
        if (typeof bundle.rawSlots.slotA === 'string') {
          storage.setItem(BACKUP_KEYS_V56.ACTIVE_SLOT_A, bundle.rawSlots.slotA);
        }
        if (typeof bundle.rawSlots.slotB === 'string') {
          storage.setItem(BACKUP_KEYS_V56.ACTIVE_SLOT_B, bundle.rawSlots.slotB);
        }
        if (typeof bundle.rawSlots.legacy === 'string') {
          storage.setItem(BACKUP_KEYS_V56.ACTIVE_LEGACY, bundle.rawSlots.legacy);
        }
        if (typeof bundle.rawSlots.preview210 === 'string') {
          storage.setItem(BACKUP_KEYS_V56.PREVIEW_210, bundle.rawSlots.preview210);
        }
      }

      // Also write two consecutive checked slots (A and B) with higher sequence numbers containing the exact restored state
      nextSeq += 1;
      writeCheckedSlotToStorage(storage, restoredState, nextSeq, true);
      nextSeq += 1;
      writeCheckedSlotToStorage(storage, restoredState, nextSeq, true);

      // Heal whichever backup slot was missing/corrupted so both primary and mirror remain intact
      const bundleStr = JSON.stringify(bundle);
      storage.setItem(BACKUP_KEYS_V56.PRIMARY, bundleStr);
      storage.setItem(BACKUP_KEYS_V56.MIRROR, bundleStr);

      storage.setItem(BACKUP_KEYS_V56.JOURNAL, JSON.stringify({
        status: options.journalStatus || 'RESTORED',
        restoredAt: Number(options.now) || Date.now(),
        source: check.source,
        hash: check.hash
      }));

      return {
        restored: true,
        source: check.source,
        hash: check.hash,
        seq: nextSeq,
        state: restoredState
      };
    } catch (err) {
      return {
        restored: false,
        reason: 'restore_write_exception',
        error: String(err && err.message ? err.message : err)
      };
    }
  }

  function executeSafeV56MigrationPipeline(storage, options = {}) {
    const now = Number(options.now) || Date.now();
    let recoveredFromCrash = false;

    // 1. Check write-ahead journal for interrupted migration (simulated or real app crash mid-migration)
    if (isValidStorageAdapter(storage)) {
      try {
        const rawJournal = storage.getItem(BACKUP_KEYS_V56.JOURNAL);
        if (rawJournal) {
          const journal = JSON.parse(rawJournal);
          if (journal && journal.status === 'IN_PROGRESS') {
            const crashRestore = restorePreV56Backup(storage, {
              ...options,
              journalStatus: 'RECOVERED_AFTER_INTERRUPTION'
            });
            if (crashRestore.restored) {
              recoveredFromCrash = true;
            }
          }
        }
      } catch (_) {}
    }

    // 2. Load candidate raw state (either recovered, explicitly passed, or from storage slots)
    const slotRead = isValidStorageAdapter(storage)
      ? readNewestCheckedSlotFromStorage(storage)
      : { state: null, maxSeq: 0, source: 'memory_only' };

    const rawCandidate = (recoveredFromCrash && slotRead.state)
      ? slotRead.state
      : (options.rawState !== undefined ? options.rawState : (slotRead.state || options.baseState || {}));

    const safeInput = (rawCandidate && typeof rawCandidate === 'object' && !Array.isArray(rawCandidate))
      ? deepCloneSaveState(rawCandidate)
      : (options.baseState ? deepCloneSaveState(options.baseState) : {});

    // Merge legacy 2.1.0 Booster/Pass preview profile into working copy if not yet present on safeInput
    if (isValidStorageAdapter(storage)) {
      try {
        const leg210 = JSON.parse(storage.getItem(BACKUP_KEYS_V56.PREVIEW_210) || 'null');
        if (leg210 && typeof leg210 === 'object') {
          if (!safeInput.itBoosterProfile) {
            safeInput.itBoosterProfile = {
              cards: leg210.cards || {},
              active: leg210.active || [],
              skins: leg210.skins || ['Classic'],
              equipped: leg210.equipped || 'Classic'
            };
          }
          if (!safeInput.itPassProfile) {
            safeInput.itPassProfile = {
              passXP: leg210.passXP || 0,
              passClaims: leg210.passClaims || [],
              passSeason: leg210.passSeason || ''
            };
          }
        }
      } catch (_) {}
    }

    // 3. Guard: Run migration ONLY if save version < 56
    const currentMigrationVersion = Number(safeInput.migrationVersion) || 0;
    if (currentMigrationVersion >= MIGRATION_TARGET_VERSION) {
      // Ensure deterministic achievement bonus is present without mutating or re-running conversions
      if (!Number.isFinite(Number(safeInput.achievementCoinBonus))) {
        recomputeAchievementsV56(safeInput);
      }
      return {
        status: 'ALREADY_V56',
        migrated: false,
        recoveredFromCrash,
        state: safeInput,
        seq: slotRead.maxSeq
      };
    }

    // 4. Create & strictly verify independent pre-V56 backup BEFORE any migration
    const backupRes = createPreV56Backup(storage, safeInput, options);
    if (!backupRes.ok) {
      // Strict requirement: If a durable backup cannot be created and verified, DO NOT migrate real data!
      return {
        status: 'BLOCKED_BACKUP_FAILED',
        migrated: false,
        recoveredFromCrash,
        reason: backupRes.reason,
        state: safeInput,
        seq: slotRead.maxSeq
      };
    }

    // 5. Mark write-ahead journal as IN_PROGRESS before performing migration
    try {
      storage.setItem(BACKUP_KEYS_V56.JOURNAL, JSON.stringify({
        status: 'IN_PROGRESS',
        startedAt: now,
        backupHash: backupRes.hash
      }));
    } catch (err) {
      return {
        status: 'BLOCKED_JOURNAL_WRITE_FAILED',
        migrated: false,
        recoveredFromCrash,
        reason: 'journal_write_failed',
        state: safeInput,
        seq: slotRead.maxSeq
      };
    }

    // Hook for automated tests to simulate app closure / power loss mid-migration
    if (options.simulateCrashDuringMigration === true) {
      throw new Error('SIMULATED_APP_CLOSURE_DURING_MIGRATION');
    }

    // 6. Execute V56 migration on an isolated in-memory copy
    let migratedState;
    let report;
    try {
      const migResult = migrateSaveStateToV56(safeInput, { withReport: true });
      migratedState = migResult.state;
      report = migResult.report;

      // Hook for automated tests to inject an anomaly before validation
      if (typeof options.simulatePostMigrationAnomaly === 'function') {
        options.simulatePostMigrationAnomaly(migratedState, report);
      }
    } catch (err) {
      restorePreV56Backup(storage, { ...options, journalStatus: 'ROLLED_BACK_ON_EXCEPTION' });
      return {
        status: 'BLOCKED_MIGRATION_EXCEPTION',
        migrated: false,
        recoveredFromCrash,
        reason: String(err && err.message ? err.message : err),
        state: safeInput,
        seq: slotRead.maxSeq
      };
    }

    // 7. Validate migrated state across all 7 invariant categories before any replacement
    const validation = validateMigratedStateV56(safeInput, migratedState, report);
    if (!validation.valid) {
      restorePreV56Backup(storage, { ...options, journalStatus: 'ROLLED_BACK_ON_VALIDATION_FAILURE' });
      return {
        status: 'BLOCKED_VALIDATION_FAILED',
        migrated: false,
        recoveredFromCrash,
        validation,
        report,
        state: safeInput,
        seq: slotRead.maxSeq
      };
    }

    // 8. Commit validated V56 state to active slots while keeping pre-V56 backups intact
    try {
      let nextSeq = slotRead.maxSeq + 1;
      const write1 = writeCheckedSlotToStorage(storage, migratedState, nextSeq, true);
      nextSeq += 1;
      const write2 = writeCheckedSlotToStorage(storage, migratedState, nextSeq, true);

      storage.setItem(BACKUP_KEYS_V56.JOURNAL, JSON.stringify({
        status: 'COMPLETED',
        completedAt: now,
        backupHash: backupRes.hash,
        migratedHash: write2.hash,
        seq: nextSeq
      }));

      return {
        status: 'MIGRATED_OK',
        migrated: true,
        recoveredFromCrash,
        backupHash: backupRes.hash,
        migratedHash: write2.hash,
        validation,
        report,
        state: migratedState,
        seq: nextSeq
      };
    } catch (err) {
      restorePreV56Backup(storage, { ...options, journalStatus: 'ROLLED_BACK_ON_COMMIT_FAILURE' });
      return {
        status: 'BLOCKED_COMMIT_FAILED',
        migrated: false,
        recoveredFromCrash,
        reason: String(err && err.message ? err.message : err),
        state: safeInput,
        seq: slotRead.maxSeq
      };
    }
  }

  // Firebase & Local/Cloud Conflict Resolver for Sub-Step 1B
  // Cloud write is strictly disabled in Sub-Step 1B to guarantee zero Firebase overwrites.
  function resolveLocalCloudSaveConflictV56(localState, cloudState, options = {}) {
    const hasLocal = Boolean(localState && typeof localState === 'object' && !Array.isArray(localState));
    const hasCloud = Boolean(cloudState && typeof cloudState === 'object' && !Array.isArray(cloudState));
    const allowCloudWrite = Boolean(options.allowCloudWrite || options.step3a);

    if (!hasCloud) {
      // Local exists, cloud is empty: allow cloud write only if allowCloudWrite is explicitly enabled
      const canInitCloud = allowCloudWrite && hasLocal && (Number(localState.gold || localState.level || 0) > 0 || Object.keys(localState.records || {}).length > 0);
      return {
        action: 'KEEP_LOCAL',
        cloudWriteAllowed: canInitCloud,
        firebaseOverwriteBlocked: !canInitCloud,
        reason: 'no_cloud_state',
        resolvedLocalState: hasLocal ? deepCloneSaveState(localState) : {}
      };
    }
    if (!hasLocal) {
      // Local is empty: adopt cloud state locally in memory, never overwrite cloud with empty
      const cloudCopy = deepCloneSaveState(cloudState);
      const resolved = (Number(cloudCopy.migrationVersion) || 0) < MIGRATION_TARGET_VERSION
        ? migrateSaveStateToV56(cloudCopy)
        : cloudCopy;
      return {
        action: 'ADOPT_CLOUD_LOCALLY_READONLY',
        cloudWriteAllowed: false,
        firebaseOverwriteBlocked: true,
        reason: 'local_empty',
        resolvedLocalState: resolved
      };
    }

    // Protect against cross-player profile contamination
    const localUid = String(options.localUid ?? localState.uid ?? '').trim();
    const cloudUid = String(options.cloudUid ?? cloudState.uid ?? '').trim();
    if (localUid && cloudUid && localUid !== cloudUid) {
      return {
        action: 'REJECT_DIFFERENT_USER_PROFILE',
        cloudWriteAllowed: false,
        firebaseOverwriteBlocked: true,
        reason: 'uid_mismatch',
        resolvedLocalState: deepCloneSaveState(localState)
      };
    }

    // Compare both states in V56 normalized form in memory without mutating either original
    const localV56 = (Number(localState.migrationVersion) || 0) < MIGRATION_TARGET_VERSION
      ? migrateSaveStateToV56(localState)
      : deepCloneSaveState(localState);
    const cloudV56 = (Number(cloudState.migrationVersion) || 0) < MIGRATION_TARGET_VERSION
      ? migrateSaveStateToV56(cloudState)
      : deepCloneSaveState(cloudState);

    const localSnap = extractCanonicalPreMigrationSnapshot(localV56);
    const cloudSnap = extractCanonicalPreMigrationSnapshot(cloudV56);

    const localBestWave = getBestWaveFromState(localV56);
    const cloudBestWave = getBestWaveFromState(cloudV56);

    // Protection against overwriting a populated cloud with an empty local save
    if (localSnap.totalEconomicCoins === 0 && cloudSnap.totalEconomicCoins > 0) {
      return {
        action: 'ADOPT_CLOUD_PREVENT_EMPTY_OVERWRITE',
        cloudWriteAllowed: false,
        firebaseOverwriteBlocked: true,
        reason: 'prevent_empty_overwrite',
        localVersionBefore: Number(localState.migrationVersion) || 0,
        cloudVersionBefore: Number(cloudState.migrationVersion) || 0,
        localTotalEconomicCoins: localSnap.totalEconomicCoins,
        cloudTotalEconomicCoins: cloudSnap.totalEconomicCoins,
        resolvedLocalState: cloudV56
      };
    }

    // Non-destructive merge: preserve maximum wave records & highest validated progression
    const preferCloudBase =
      cloudSnap.totalEconomicCoins > localSnap.totalEconomicCoins ||
      (cloudSnap.totalEconomicCoins === localSnap.totalEconomicCoins && cloudBestWave > localBestWave);

    const merged = preferCloudBase ? deepCloneSaveState(cloudV56) : deepCloneSaveState(localV56);

    // Helper: total booster copies
    const countTotalCards = s => {
      const cards = s?.itBoosterProfile?.cards || {};
      let sum = 0;
      for (const k of Object.keys(cards)) sum += safeNonNegInt(cards[k], 0);
      return sum;
    };

    const localVer = safeNonNegInt(localV56.saveVersion ?? localV56.seq, 0);
    const cloudVer = safeNonNegInt(cloudV56.saveVersion ?? cloudV56.seq, 0);
    const localTs = safeNonNegInt(localV56.updatedAt ?? localV56.timestamp, 0);
    const cloudTs = safeNonNegInt(cloudV56.updatedAt ?? cloudV56.timestamp, 0);

    const localInvestedCoins = (localSnap.workshopCumulativeCoins || 0) + (localSnap.labCumulativeCoins || 0);
    const cloudInvestedCoins = (cloudSnap.workshopCumulativeCoins || 0) + (cloudSnap.labCumulativeCoins || 0);
    const localCards = countTotalCards(localV56);
    const cloudCards = countTotalCards(cloudV56);

    // Section 5 (Step 3B): Transactional Currency Resolution (Never resurrect spent coins/diamonds via blind Math.max)
    if (localVer > cloudVer) {
      // Local is a direct successor version: local balance reflects true expenditures and earnings
      merged.gold = safeNonNegInt(localV56.gold, 0);
      merged.diamonds = safeNonNegInt(localV56.diamonds, 0);
    } else if (cloudVer > localVer) {
      // Cloud is a direct successor version: cloud balance reflects true expenditures and earnings
      merged.gold = safeNonNegInt(cloudV56.gold, 0);
      merged.diamonds = safeNonNegInt(cloudV56.diamonds, 0);
    } else {
      // Concurrent branch or equal versions: account for upgrade expenditures to prevent double-spending
      if (localInvestedCoins > cloudInvestedCoins) {
        // Local spent coins on workshop/lab upgrades: deduct expenditures and add net earnings from cloud
        const netCloudEarning = Math.max(0, (safeNonNegInt(cloudV56.gold, 0) + cloudInvestedCoins) - (safeNonNegInt(localV56.gold, 0) + localInvestedCoins));
        merged.gold = safeNonNegInt(localV56.gold, 0) + netCloudEarning;
      } else if (cloudInvestedCoins > localInvestedCoins) {
        // Cloud spent coins on workshop/lab upgrades: deduct expenditures and add net earnings from local
        const netLocalEarning = Math.max(0, (safeNonNegInt(localV56.gold, 0) + localInvestedCoins) - (safeNonNegInt(cloudV56.gold, 0) + cloudInvestedCoins));
        merged.gold = safeNonNegInt(cloudV56.gold, 0) + netLocalEarning;
      } else {
        // Equal investment: retain validated higher earned balance
        merged.gold = Math.max(safeNonNegInt(localV56.gold, 0), safeNonNegInt(cloudV56.gold, 0));
      }

      // Diamonds: account for booster card expenditures
      if (localCards > cloudCards) {
        const netCloudDiamondEarning = Math.max(0, (safeNonNegInt(cloudV56.diamonds, 0) + cloudCards * 20) - (safeNonNegInt(localV56.diamonds, 0) + localCards * 20));
        merged.diamonds = safeNonNegInt(localV56.diamonds, 0) + netCloudDiamondEarning;
      } else if (cloudCards > localCards) {
        const netLocalDiamondEarning = Math.max(0, (safeNonNegInt(localV56.diamonds, 0) + localCards * 20) - (safeNonNegInt(cloudV56.diamonds, 0) + cloudCards * 20));
        merged.diamonds = safeNonNegInt(cloudV56.diamonds, 0) + netLocalDiamondEarning;
      } else {
        merged.diamonds = Math.max(safeNonNegInt(localV56.diamonds, 0), safeNonNegInt(cloudV56.diamonds, 0));
      }
    }

    merged.saveVersion = Math.max(localVer, cloudVer) + 1;
    merged.updatedAt = Math.max(Date.now(), Math.max(localTs, cloudTs) + 1);
    merged.sp = Math.max(safeNonNegInt(localV56.sp, 0), safeNonNegInt(cloudV56.sp, 0));
    merged.level = Math.max(safeNonNegInt(localV56.level, 1), safeNonNegInt(cloudV56.level, 1));
    merged.xp = Math.max(safeNonNegInt(localV56.xp, 0), safeNonNegInt(cloudV56.xp, 0));

    // Highest workshop and lab levels preserved across both states
    if (Array.isArray(localV56.workshop) && Array.isArray(cloudV56.workshop)) {
      for (let i = 0; i < Math.max(localV56.workshop.length, cloudV56.workshop.length, 41); i++) {
        merged.workshop[i] = Math.max(
          safeNonNegInt(localV56.workshop?.[i], 0),
          safeNonNegInt(cloudV56.workshop?.[i], 0)
        );
      }
    }
    const allLabKeys = new Set([...Object.keys(localV56.labLevels || {}), ...Object.keys(cloudV56.labLevels || {})]);
    merged.labLevels = merged.labLevels || {};
    for (const lk of allLabKeys) {
      merged.labLevels[lk] = Math.max(
        safeNonNegInt(localV56.labLevels?.[lk], 0),
        safeNonNegInt(cloudV56.labLevels?.[lk], 0)
      );
    }

    // Merge wave records
    merged.records = Object.assign({}, localV56.records || {}, cloudV56.records || {});
    let localHasHigherRecord = false;
    for (const k of Object.keys(merged.records)) {
      const lVal = safeNonNegInt(localV56.records?.[k], 0);
      const cVal = safeNonNegInt(cloudV56.records?.[k], 0);
      if (lVal > cVal) localHasHigherRecord = true;
      merged.records[k] = Math.max(lVal, cVal);
    }

    // Union of achievements & trophies
    merged.claimed = Object.assign({}, localV56.claimed || {}, cloudV56.claimed || {});
    merged.achUnlocked = Object.assign({}, localV56.achUnlocked || {}, cloudV56.achUnlocked || {});

    // Boosters union
    if (localV56.itBoosterProfile || cloudV56.itBoosterProfile) {
      const bLocal = localV56.itBoosterProfile || {};
      const bCloud = cloudV56.itBoosterProfile || {};
      const mergedCards = Object.assign({}, bLocal.cards || {}, bCloud.cards || {});
      for (const cid of Object.keys(mergedCards)) {
        mergedCards[cid] = Math.max(
          safeNonNegInt(bLocal.cards?.[cid], 0),
          safeNonNegInt(bCloud.cards?.[cid], 0)
        );
      }
      merged.itBoosterProfile = {
        unlocked: Boolean(bLocal.unlocked || bCloud.unlocked),
        cards: mergedCards,
        active: (Array.isArray(bLocal.active) && bLocal.active.length) ? bLocal.active : (bCloud.active || [])
      };
    }

    recomputeAchievementsV56(merged);

    // Determine if cloud write is permitted
    let shouldWriteCloud = false;
    if (allowCloudWrite) {
      const mergedSnap = extractCanonicalPreMigrationSnapshot(merged);
      if (
        mergedSnap.totalEconomicCoins > cloudSnap.totalEconomicCoins ||
        localVer > cloudVer ||
        localInvestedCoins > cloudInvestedCoins ||
        localCards > cloudCards ||
        localHasHigherRecord ||
        merged.diamonds > (cloudV56.diamonds || 0)
      ) {
        shouldWriteCloud = true;
      }
    }

    return {
      action: shouldWriteCloud
        ? 'MERGE_SYNC_CLOUD_WRITE_ALLOWED'
        : (preferCloudBase ? 'MERGE_PREFER_CLOUD_READONLY' : 'MERGE_PREFER_LOCAL_READONLY'),
      cloudWriteAllowed: shouldWriteCloud,
      firebaseOverwriteBlocked: !shouldWriteCloud,
      localVersionBefore: Number(localState.migrationVersion) || 0,
      cloudVersionBefore: Number(cloudState.migrationVersion) || 0,
      localTotalEconomicCoins: localSnap.totalEconomicCoins,
      cloudTotalEconomicCoins: cloudSnap.totalEconomicCoins,
      resolvedLocalState: merged
    };
  }

  // Orchestrator helper for Step 3A bidirectional Cloud Synchronization
  function syncCloudSaveV56(localState, cloudState, options = {}) {
    const opts = Object.assign({}, options, { allowCloudWrite: true, step3a: true });
    const res = resolveLocalCloudSaveConflictV56(localState, cloudState, opts);
    return {
      ok: res.action !== 'REJECT_DIFFERENT_USER_PROFILE',
      action: res.action,
      state: res.resolvedLocalState,
      shouldSaveLocal: true,
      shouldWriteCloud: res.cloudWriteAllowed,
      reason: res.reason || null
    };
  }

  // Exportable/importable save bundle independent of localStorage (Safety Prerequisite for Step 2A)
  function exportSaveBundleV56(state, storage = null, options = {}) {
    const cleanState = deepCloneSaveState(state || {});
    const dataStr = JSON.stringify(cleanState);
    const hash = saveHashV56(dataStr);
    let preV56Backup = null;
    if (storage && typeof storage.getItem === 'function') {
      const check = verifyPreV56Backup(storage);
      if (check && (check.ok || check.valid)) {
        preV56Backup = {
          hash: check.hash || (check.backupBundle && check.backupBundle.hash),
          seq: check.seq !== undefined ? check.seq : ((check.backupBundle && check.backupBundle.seq) || 0),
          state: deepCloneSaveState(check.state || check.restorableState || (check.backupBundle && check.backupBundle.state))
        };
      }
    }
    const bundle = {
      format: 'INFINITE_TOWER_SAVE_BUNDLE_V56',
      version: VERSION,
      exportedAt: Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now(),
      hash,
      data: dataStr,
      state: cleanState,
      preV56Backup
    };
    return {
      ok: true,
      hash,
      bundle,
      json: JSON.stringify(bundle, null, 2)
    };
  }

  function importSaveBundleV56(bundleOrJson, storage = null, activeSaveKeyPrefix = null) {
    try {
      const rawParsed = typeof bundleOrJson === 'string' ? JSON.parse(bundleOrJson) : bundleOrJson;
      const parsed = (rawParsed && typeof rawParsed === 'object' && rawParsed.bundle && rawParsed.bundle.format === 'INFINITE_TOWER_SAVE_BUNDLE_V56')
        ? rawParsed.bundle
        : rawParsed;
      if (!parsed || typeof parsed !== 'object' || parsed.format !== 'INFINITE_TOWER_SAVE_BUNDLE_V56') {
        return { ok: false, reason: 'invalid_bundle_format' };
      }
      const dataStr = typeof parsed.data === 'string' ? parsed.data : JSON.stringify(parsed.state || {});
      const computedHash = saveHashV56(dataStr);
      if (parsed.hash && parsed.hash !== computedHash) {
        return { ok: false, reason: 'bundle_hash_mismatch', expected: parsed.hash, actual: computedHash };
      }
      const rawState = JSON.parse(dataStr);
      if (!rawState || typeof rawState !== 'object' || Array.isArray(rawState)) {
        return { ok: false, reason: 'invalid_state_payload' };
      }
      const normalized = (Number(rawState.migrationVersion) || 0) < MIGRATION_TARGET_VERSION
        ? migrateSaveStateToV56(rawState)
        : deepCloneSaveState(rawState);

      if (storage && typeof storage.setItem === 'function') {
        if (parsed.preV56Backup && parsed.preV56Backup.state) {
          createPreV56Backup(storage, parsed.preV56Backup.state, { seq: parsed.preV56Backup.seq || 1 });
        }
        if (activeSaveKeyPrefix) {
          const normStr = JSON.stringify(normalized);
          const normHash = saveHashV56(normStr);
          storage.setItem(activeSaveKeyPrefix + '-a', JSON.stringify({ seq: 1, data: normStr, hash: normHash }));
          storage.setItem(activeSaveKeyPrefix + '-legacy', normStr);
        }
      }

      return {
        ok: true,
        hash: computedHash,
        state: normalized,
        preV56Backup: parsed.preV56Backup || null
      };
    } catch (err) {
      return { ok: false, reason: String(err && err.message ? err.message : err) };
    }
  }

  return Object.freeze({
    VERSION,
    STARTER_UPGRADES,
    STARTER_UPGRADES_SET,
    WAVE_100_UPGRADES,
    WAVE_100_UPGRADES_SET,
    RETIRED_UPGRADES_SET,
    STARTER_RESEARCH_NAMES,
    STARTER_RESEARCH_SET,
    FEATURE_UNLOCKS,
    featureForUpgrade,
    featureForResearch,
    featureOwned,
    featureUnlocked,
    upgradeRequirement,
    upgradeVisible,
    upgradeUnlocked,
    researchRequirement,
    researchVisible,
    researchUnlocked,
    SCALING,
    percentLevels,
    rapidFireTrigger,
    maxHp,
    interestRate,
    interestCash,
    UPGRADES,
    WORKSHOP_CAPS,
    LAB_CAPS,
    UNIFIED_CATEGORY_UPGRADES,
    LAB_UNIQUE_ITEMS,
    workshopCap,
    labCap,
    TYPES,
    DIFFS,
    DIFF_MULT,
    TOWER_POSITIONS,
    MAX_BOOSTER_COPIES,
    MAX_BOOSTER_STARS,
    BOOSTER_CARDS,
    ACTIVE_BOOSTER_CARD_IDS,
    computeBoosterBonuses,
    maxLevel,
    maxUpgradeLevel,
    canUpgrade,
    canBuyRunUpgrade,
    hpUpgrade,
    knockbackEnemy,
    shieldCapacity,
    absorbShield,
    bounceHits,
    cost,
    BATCH_DISCOUNT_FACTOR,
    isDiscountedBatchSize,
    discountedLevelPrice,
    batchUpgradeQuote,
    WAVE_DURATION_SECONDS,
    MAX_WAVE_CAP,
    SPAWN_SAFETY_MARGIN,
    waveBatchCount,
    isGiantWave,
    waveTargetCount,
    waveSpawnInterval,
    computeSpawnPosition360,
    waveEndHealFraction,
    enemyStats,
    critRoll,
    criticalHit,
    calculateHitCritical,
    projectileDamage,
    contactDamage,
    towerStats,
    computeCameraZoom,
    TARGET_PRIORITY_MODES,
    ACH_MILESTONES_V56,
    selectTargets,
    closestLivingTower,
    computeUpgradeEffects,
    resolveCoopSpeed,
    calculateRunRewards,
    spawnSingleEnemy360,
    spawnWaveGroup,
    spawnWaveBatch,
    waveTotalEnemies,
    wavePacketSize,
    waveGroupSize,
    waveGroups,
    isGiantGroup,
    spawnWaveEnemy,
    stepCombat,
    drawBackground,
    drawEnemy,
    drawTower,
    MIGRATION_TARGET_VERSION,
    V56_WORKSHOP_CAPS,
    V56_LAB_CAPS,
    HISTORICAL_LAB_BASE_COSTS,
    historicalWorkshopPrice,
    historicalWorkshopCumulativeCost,
    historicalLabCost,
    historicalLabCumulativeCost,
    longTermLevelPrice,
    calculateLongTermCostTable,
    migrateSaveStateToV56,
    BACKUP_KEYS_V56,
    saveHashV56,
    extractCanonicalPreMigrationSnapshot,
    validateMigratedStateV56,
    createPreV56Backup,
    verifyPreV56Backup,
    restorePreV56Backup,
    executeSafeV56MigrationPipeline,
    resolveLocalCloudSaveConflictV56,
    syncCloudSaveV56,
    exportSaveBundleV56,
    importSaveBundleV56,
    NUMBER_UNITS,
    formatNumber,
    fmt: formatNumber
  });
});