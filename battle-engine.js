/**
 * Deterministic, serialisable battle engine for ShintomiPoket.
 * No DOM, timers, network calls or Math.random are used here.  The same state
 * and commands therefore always produce the same next state on both devices.
 */
(function initialiseBattleEngine(global) {
  "use strict";

  const DATA = global.GAME_DATA;
  if (!DATA) throw new Error("battle-engine.js より先に data.js を読み込んでください。");

  const STAT_KEYS = ["hp", "attack", "defense", "specialAttack", "specialDefense", "speed"];
  const STAGE_KEYS = ["attack", "defense", "specialAttack", "specialDefense", "speed", "accuracy", "evasion"];
  const PROTECT_MOVES = new Set(["protect", "baneful-bunker"]);
  const BERRY_CATEGORIES = new Set(["resistBerry", "healingBerry", "statusBerry", "volatileBerry"]);

  function clone(value) {
    return typeof structuredClone === "function"
      ? structuredClone(value)
      : JSON.parse(JSON.stringify(value));
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function hashString(text) {
    let hash = 2166136261;
    for (let index = 0; index < String(text).length; index += 1) {
      hash ^= String(text).charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0 || 0x9e3779b9;
  }

  function random(state) {
    let value = state.rngState >>> 0 || 0x9e3779b9;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    state.rngState = value >>> 0;
    return state.rngState / 4294967296;
  }

  function chance(state, probability) {
    return random(state) < probability;
  }

  function randomInt(state, minimum, maximum) {
    return minimum + Math.floor(random(state) * (maximum - minimum + 1));
  }

  function log(state, message, type = "info", details = {}) {
    state.log.push({ turn: state.turn, type, message, ...details });
    if (state.log.length > 240) state.log.splice(0, state.log.length - 240);
  }

  function natureMultiplier(nature, stat) {
    if (!nature || nature.increasedStat === nature.decreasedStat) return 1;
    if (nature.increasedStat === stat) return 1.1;
    if (nature.decreasedStat === stat) return 0.9;
    return 1;
  }

  function legacyEvToEffortPoint(value) {
    const ev = clamp(Math.floor(Number(value) || 0), 0, DATA.battleRules.maxEvPerStat);
    return ev <= 0 ? 0 : Math.min(DATA.battleRules.maxEffortPointsPerStat, Math.floor((ev + 4) / 8));
  }

  function effortPointToEv(value) {
    const point = clamp(Math.floor(Number(value) || 0), 0, DATA.battleRules.maxEffortPointsPerStat);
    return point <= 0 ? 0 : Math.min(DATA.battleRules.maxEvPerStat, 4 + (point - 1) * 8);
  }

  function effortPointsForBuild(build = {}) {
    if (build.effortPoints && typeof build.effortPoints === "object") {
      return Object.fromEntries(STAT_KEYS.map((stat) => [stat, build.effortPoints[stat] ?? 0]));
    }
    return Object.fromEntries(STAT_KEYS.map((stat) => [stat, legacyEvToEffortPoint(build.evs?.[stat])]));
  }

  function migrateParty(party) {
    if (!Array.isArray(party)) return party;
    return party.map((build) => {
      const migrated = clone(build);
      migrated.effortPoints = effortPointsForBuild(build);
      delete migrated.evs;
      return migrated;
    });
  }

  function calculateStats(speciesId, build = {}) {
    const species = DATA.pokemon[speciesId];
    if (!species) throw new Error(`不明なポケモンIDです: ${speciesId}`);
    const level = build.level || DATA.battleRules.level;
    const nature = DATA.natures[build.natureId] || DATA.natures.serious;
    const effortPoints = effortPointsForBuild(build);
    const evs = Object.fromEntries(STAT_KEYS.map((stat) => [stat, effortPointToEv(effortPoints[stat])]));
    const ivs = Object.fromEntries(STAT_KEYS.map((stat) => [stat, clamp(Number(build.ivs?.[stat] ?? 31), 0, 31)]));
    const stats = {};
    for (const stat of STAT_KEYS) {
      const core = Math.floor(((2 * species.baseStats[stat] + ivs[stat] + Math.floor(evs[stat] / 4)) * level) / 100);
      stats[stat] = stat === "hp"
        ? core + level + 10
        : Math.floor((core + 5) * natureMultiplier(nature, stat));
    }
    return stats;
  }

  function resolveAbilityId(species, abilityIdOrName) {
    const requested = DATA.abilities[abilityIdOrName] || DATA.abilitiesByName[abilityIdOrName];
    if (requested && species.abilities.includes(requested.name)) return requested.id;
    return DATA.abilitiesByName[species.abilities[0]]?.id || null;
  }

  function createDefaultParty() {
    return DATA.pokemonList.map((species) => ({
      speciesId: species.id,
      nickname: species.name,
      level: DATA.battleRules.level,
      natureId: "serious",
      abilityId: DATA.abilitiesByName[species.abilities[0]]?.id || null,
      itemId: null,
      moveIds: [...new Set(species.moveIds)].slice(0, DATA.battleRules.movesPerPokemon),
      effortPoints: Object.fromEntries(STAT_KEYS.map((stat) => [stat, 0])),
      ivs: Object.fromEntries(STAT_KEYS.map((stat) => [stat, DATA.battleRules.defaultIv])),
    }));
  }

  function validateParty(party, options = {}) {
    const requireFullParty = options.requireFullParty !== false;
    const errors = [];
    if (!Array.isArray(party)) return ["パーティーデータが配列ではありません。"];
    if (requireFullParty && party.length !== DATA.battleRules.partySize) {
      errors.push(`パーティーは${DATA.battleRules.partySize}体にしてください。`);
    }
    const speciesSeen = new Set();
    const itemsSeen = new Set();
    party.forEach((build, index) => {
      const label = `${index + 1}体目`;
      const species = DATA.pokemon[build.speciesId];
      if (!species) {
        errors.push(`${label}: ポケモンが存在しません。`);
        return;
      }
      if (DATA.battleRules.speciesClause && speciesSeen.has(build.speciesId)) errors.push(`${label}: 同じポケモンは登録できません。`);
      speciesSeen.add(build.speciesId);
      if (!DATA.natures[build.natureId]) errors.push(`${label}: 性格が不正です。`);
      const ability = DATA.abilities[build.abilityId];
      if (!ability || !species.abilities.includes(ability.name)) errors.push(`${label}: 特性が不正です。`);
      if (build.itemId) {
        if (!DATA.items[build.itemId]) errors.push(`${label}: 持ち物が存在しません。`);
        if (DATA.battleRules.itemClause && itemsSeen.has(build.itemId)) errors.push(`${label}: 同じ持ち物は使えません。`);
        itemsSeen.add(build.itemId);
      }
      const moveIds = [...new Set(build.moveIds || [])];
      if (moveIds.length !== (build.moveIds || []).length) errors.push(`${label}: 同じ技を複数登録できません。`);
      if (moveIds.length < 1 || moveIds.length > DATA.battleRules.movesPerPokemon) errors.push(`${label}: 技は1〜4個にしてください。`);
      for (const moveId of moveIds) {
        if (!DATA.moves[moveId] || !species.moveIds.includes(moveId)) errors.push(`${label}: 覚えられない技「${moveId}」があります。`);
      }
      const effortPoints = effortPointsForBuild(build);
      const totalEffortPoints = STAT_KEYS.reduce((sum, stat) => {
        const point = Number(effortPoints[stat]);
        if (!Number.isInteger(point) || point < 0 || point > DATA.battleRules.maxEffortPointsPerStat) errors.push(`${label}: ${stat}の努力値実数が不正です。`);
        return sum + (Number.isFinite(point) ? point : 0);
      }, 0);
      if (totalEffortPoints > DATA.battleRules.maxTotalEffortPoints) errors.push(`${label}: 努力値実数の合計が66を超えています。`);
    });
    return [...new Set(errors)];
  }

  function preparePokemon(build, teamIndex) {
    const species = DATA.pokemon[build.speciesId];
    const stats = calculateStats(build.speciesId, build);
    const moveIds = [...new Set(build.moveIds)].slice(0, 4);
    return {
      uid: `${build.speciesId}-${teamIndex}`,
      speciesId: build.speciesId,
      name: build.nickname?.trim() || species.name,
      speciesName: species.name,
      level: build.level || DATA.battleRules.level,
      typeIds: [...species.typeIds],
      stats,
      hp: stats.hp,
      maxHp: stats.hp,
      abilityId: resolveAbilityId(species, build.abilityId),
      copiedAbilityId: null,
      itemId: build.itemId || null,
      itemConsumed: false,
      lastConsumedItemId: null,
      natureId: build.natureId,
      moves: moveIds.map((moveId) => ({ id: moveId, pp: DATA.moves[moveId].pp, maxPp: DATA.moves[moveId].pp })),
      status: null,
      statusCounter: 0,
      toxicCounter: 0,
      stages: Object.fromEntries(STAGE_KEYS.map((stat) => [stat, 0])),
      volatile: {},
      lastMoveId: null,
      lastMoveFailed: false,
      choiceLockedMoveId: null,
      protectChain: 0,
      metronomeMoveId: null,
      metronomeCount: 0,
      turnsActive: 0,
      firstTurnEligible: true,
      fainted: false,
    };
  }

  function createSide() {
    return {
      stealthRock: false,
      toxicSpikes: 0,
      stickyWeb: false,
      lightScreenTurns: 0,
      reflectTurns: 0,
      auroraVeilTurns: 0,
      tailwindTurns: 0,
    };
  }

  function createBattle({ players, seed = Date.now() }) {
    if (!Array.isArray(players) || players.length !== 2) throw new Error("対戦には2人のプレイヤーが必要です。");
    for (const player of players) {
      const errors = validateParty(player.team, { requireFullParty: false });
      if (player.team.length !== DATA.battleRules.selectionSize) errors.unshift("選出は3体必要です。");
      if (errors.length) throw new Error(`${player.name}: ${errors.join(" ")}`);
    }
    const state = {
      version: 1,
      phase: "battle",
      turn: 1,
      seed: typeof seed === "number" ? seed >>> 0 : hashString(seed),
      rngState: typeof seed === "number" ? seed >>> 0 : hashString(seed),
      players: players.map((player, playerIndex) => ({
        id: String(player.id),
        name: String(player.name),
        active: 0,
        team: player.team.map((build, teamIndex) => preparePokemon(build, teamIndex)),
        side: createSide(),
      })),
      field: { weather: null, weatherTurns: 0, terrain: null, terrainTurns: 0, trickRoomTurns: 0 },
      requiredSwitches: [],
      winnerId: null,
      result: null,
      log: [],
    };
    log(state, `${state.players[0].name} と ${state.players[1].name} の対戦が始まった！`, "start");
    log(state, `${active(state, 0).name} と ${active(state, 1).name} が場に出た！`, "switch");
    runEntryAbilities(state, [0, 1]);
    activateTerrainItems(state);
    return state;
  }

  function active(state, playerIndex) {
    return state.players[playerIndex].team[state.players[playerIndex].active];
  }

  function opponentIndex(playerIndex) {
    return playerIndex === 0 ? 1 : 0;
  }

  function playerIndexById(state, playerId) {
    return state.players.findIndex((player) => player.id === String(playerId));
  }

  function abilityId(mon) {
    return mon.copiedAbilityId || mon.abilityId;
  }

  function hasAbility(mon, id) {
    return abilityId(mon) === id;
  }

  function heldItem(mon) {
    return mon.itemId && !mon.itemConsumed ? DATA.items[mon.itemId] : null;
  }

  function hasChoiceItem(mon) {
    return heldItem(mon)?.effect?.kind === "choiceItem";
  }

  function replaceHeldItem(mon, item) {
    mon.itemId = item?.id || null;
    mon.itemConsumed = false;
    // A Choice lock belongs to the item currently being held. Receiving a
    // Choice item does not lock a Pokemon until it next uses a move.
    mon.choiceLockedMoveId = null;
  }

  function consumeItem(state, mon, reason = "used") {
    const current = heldItem(mon);
    if (!current) return null;
    mon.itemConsumed = true;
    mon.lastConsumedItemId = current.id;
    log(state, `${mon.name} は ${current.name} を使った！`, "item", { pokemon: mon.uid, itemId: current.id, reason });
    return current;
  }

  function isGrounded(mon) {
    const item = heldItem(mon);
    if (item?.id === "iron-ball") return true;
    if (item?.id === "air-balloon") return false;
    if (mon.volatile.roosted) return true;
    return !mon.typeIds.includes("flying");
  }

  function typeEffectiveness(moveTypeId, target) {
    if (moveTypeId === "ground" && !isGrounded(target)) return 0;
    const targetTypes = target.volatile.roosted ? target.typeIds.filter((type) => type !== "flying") : target.typeIds;
    return targetTypes.reduce((value, targetType) => value * (DATA.typeChart[moveTypeId]?.[targetType] ?? 1), 1);
  }

  function stageMultiplier(stage, accuracy = false) {
    const bounded = clamp(stage, -6, 6);
    if (accuracy) return bounded >= 0 ? (3 + bounded) / 3 : 3 / (3 - bounded);
    return bounded >= 0 ? (2 + bounded) / 2 : 2 / (2 - bounded);
  }

  function changeStage(state, mon, stat, requestedStages, source = null, reason = "move") {
    if (!STAGE_KEYS.includes(stat) || mon.fainted) return 0;
    if (reason === "intimidate" && requestedStages < 0 && ["own-tempo", "oblivious"].includes(abilityId(mon))) {
      log(state, `${mon.name} は特性でいかくを受けない！`, "ability");
      return 0;
    }
    const stages = hasAbility(mon, "simple") ? requestedStages * 2 : requestedStages;
    const before = mon.stages[stat];
    mon.stages[stat] = clamp(before + stages, -6, 6);
    const changed = mon.stages[stat] - before;
    if (!changed) {
      log(state, `${mon.name} の能力はこれ以上${stages > 0 ? "上がら" : "下がら"}ない！`, "stage");
      return 0;
    }
    const statName = { attack: "攻撃", defense: "防御", specialAttack: "特攻", specialDefense: "特防", speed: "素早さ", accuracy: "命中率", evasion: "回避率" }[stat];
    log(state, `${mon.name} の${statName}が${changed > 0 ? "上がった" : "下がった"}！`, "stage", { pokemon: mon.uid, stat, stages: changed });
    if (changed < 0 && heldItem(mon)?.id === "white-herb") mon.volatile.whiteHerbPending = true;
    return changed;
  }

  function effectiveSpeed(state, playerIndex) {
    const mon = active(state, playerIndex);
    let speed = mon.stats.speed * stageMultiplier(mon.stages.speed);
    if (mon.status === "paralysis") speed *= 0.5;
    if (heldItem(mon)?.id === "choice-scarf") speed *= 1.5;
    if (heldItem(mon)?.id === "iron-ball") speed *= 0.5;
    if (state.players[playerIndex].side.tailwindTurns > 0) speed *= 2;
    return Math.floor(speed);
  }

  function orderedPlayerIndexes(state, indexes = [0, 1]) {
    return [...indexes].sort((left, right) => {
      const speedDifference = effectiveSpeed(state, right) - effectiveSpeed(state, left);
      if (speedDifference) return speedDifference;
      return left - right;
    });
  }

  function setWeather(state, weather, turns, sourceMon = null) {
    state.field.weather = weather;
    state.field.weatherTurns = turns;
    log(state, weather === "rain" ? "雨が降り始めた！" : weather === "sun" ? "日差しが強くなった！" : weather === "sandstorm" ? "砂嵐が吹き始めた！" : "雪が降り始めた！", "weather");
    if (sourceMon) sourceMon.volatile.weatherSet = weather;
  }

  function runEntryAbilities(state, indexes) {
    for (const playerIndex of orderedPlayerIndexes(state, indexes)) {
      const mon = active(state, playerIndex);
      const foe = active(state, opponentIndex(playerIndex));
      if (mon.fainted) continue;
      if (hasAbility(mon, "trace") && foe && !foe.fainted && !["trace"].includes(abilityId(foe))) {
        mon.copiedAbilityId = abilityId(foe);
        log(state, `${mon.name} は ${DATA.abilities[mon.copiedAbilityId].name} をトレースした！`, "ability");
      }
      if (hasAbility(mon, "intimidate") && foe && !foe.fainted) changeStage(state, foe, "attack", -1, mon, "intimidate");
      if (hasAbility(mon, "sand-stream")) {
        const turns = heldItem(mon)?.id === "smooth-rock" ? 8 : 5;
        setWeather(state, "sandstorm", turns, mon);
      }
    }
  }

  function activateTerrainItems(state) {
    if (!state.field.terrain) return;
    for (const playerIndex of [0, 1]) {
      const mon = active(state, playerIndex);
      const item = heldItem(mon);
      if (!item || item.category !== "terrainSeed" || item.effect.terrain !== state.field.terrain) continue;
      consumeItem(state, mon, "terrainSeed");
      changeStage(state, mon, item.effect.stat, item.effect.stages, mon, "item");
    }
  }

  function clearSwitchVolatiles(mon, pass = false) {
    const kept = pass ? clone(mon.volatile) : {};
    mon.stages = Object.fromEntries(STAGE_KEYS.map((stat) => [stat, 0]));
    mon.volatile = kept;
    mon.copiedAbilityId = null;
    mon.choiceLockedMoveId = null;
    mon.protectChain = 0;
    mon.metronomeMoveId = null;
    mon.metronomeCount = 0;
    mon.toxicCounter = mon.status === "badPoison" ? 1 : mon.toxicCounter;
  }

  function availableSwitches(state, playerIndex) {
    return state.players[playerIndex].team
      .map((mon, index) => ({ mon, index }))
      .filter(({ mon, index }) => index !== state.players[playerIndex].active && !mon.fainted && mon.hp > 0)
      .map(({ index }) => index);
  }

  function voluntarySwitches(state, playerIndex) {
    const mon = active(state, playerIndex);
    return mon.volatile.trapped && heldItem(mon)?.id !== "shed-shell" ? [] : availableSwitches(state, playerIndex);
  }

  function applyEntryHazards(state, playerIndex, mon) {
    const side = state.players[playerIndex].side;
    if (side.stealthRock) {
      const ratio = (1 / 8) * typeEffectiveness("rock", mon);
      if (ratio > 0) dealDirectDamage(state, mon, Math.max(1, Math.floor(mon.maxHp * ratio)), "ステルスロック");
    }
    if (mon.fainted) return;
    if (side.toxicSpikes && isGrounded(mon)) {
      if (mon.typeIds.includes("poison")) {
        side.toxicSpikes = 0;
        log(state, `${mon.name} はどくびしを吸収した！`, "hazard");
      } else if (!mon.typeIds.includes("steel")) {
        applyStatus(state, mon, side.toxicSpikes >= 2 ? "badPoison" : "poison", null);
      }
    }
    if (mon.fainted) return;
    if (side.stickyWeb && isGrounded(mon)) changeStage(state, mon, "speed", -1, null, "hazard");
  }

  function switchPokemon(state, playerIndex, toIndex, options = {}) {
    const player = state.players[playerIndex];
    if (!availableSwitches(state, playerIndex).includes(Number(toIndex))) return false;
    const outgoing = active(state, playerIndex);
    const passedStages = options.pass ? clone(outgoing.stages) : null;
    const passedVolatile = options.pass ? clone(outgoing.volatile) : null;
    if (hasAbility(outgoing, "regenerator") && !outgoing.fainted) heal(state, outgoing, Math.floor(outgoing.maxHp / 3), "さいせいりょく");
    clearSwitchVolatiles(outgoing);
    player.active = Number(toIndex);
    const incoming = active(state, playerIndex);
    clearSwitchVolatiles(incoming);
    incoming.turnsActive = 0;
    incoming.firstTurnEligible = true;
    if (passedStages) incoming.stages = passedStages;
    if (passedVolatile) incoming.volatile = passedVolatile;
    log(state, `${player.name} は ${incoming.name} を繰り出した！`, "switch", { playerId: player.id, pokemon: incoming.uid });
    applyEntryHazards(state, playerIndex, incoming);
    if (!incoming.fainted) {
      runEntryAbilities(state, [playerIndex]);
      activateTerrainItems(state);
    }
    updateBattleOutcome(state);
    return true;
  }

  function heal(state, mon, amount, source = "回復") {
    if (mon.fainted || mon.hp <= 0) return 0;
    const before = mon.hp;
    mon.hp = Math.min(mon.maxHp, mon.hp + Math.max(0, Math.floor(amount)));
    const healed = mon.hp - before;
    if (healed) log(state, `${mon.name} はHPを${healed}回復した！`, "heal", { pokemon: mon.uid, value: healed, source });
    return healed;
  }

  function faint(state, mon) {
    if (mon.hp > 0 || mon.fainted) return;
    mon.hp = 0;
    mon.fainted = true;
    mon.volatile = {};
    log(state, `${mon.name} は倒れた！`, "faint", { pokemon: mon.uid });
  }

  function dealDirectDamage(state, mon, amount, source) {
    if (mon.fainted) return 0;
    const damage = Math.min(mon.hp, Math.max(1, Math.floor(amount)));
    mon.hp -= damage;
    log(state, `${mon.name} は${source}で${damage}ダメージを受けた！`, "damage", { pokemon: mon.uid, value: damage, source });
    faint(state, mon);
    return damage;
  }

  function statusImmunity(state, mon, status) {
    if (hasAbility(mon, "comatose")) return true;
    if (isGrounded(mon) && state.field.terrain === "misty") return true;
    if (status === "sleep" && isGrounded(mon) && state.field.terrain === "electric") return true;
    if (["poison", "badPoison"].includes(status) && (mon.typeIds.includes("poison") || mon.typeIds.includes("steel"))) return true;
    if (status === "burn" && mon.typeIds.includes("fire")) return true;
    if (status === "paralysis" && mon.typeIds.includes("electric")) return true;
    if (status === "freeze" && mon.typeIds.includes("ice")) return true;
    return false;
  }

  function activateStatusBerry(state, mon) {
    const item = heldItem(mon);
    if (!item) return false;
    const statuses = item.effect.statuses || [];
    if (item.effect.kind === "cureStatus" && statuses.includes(mon.status)) {
      consumeItem(state, mon, "statusCure");
      mon.status = null;
      mon.statusCounter = 0;
      mon.toxicCounter = 0;
      log(state, `${mon.name} の状態異常が治った！`, "status");
      return true;
    }
    if (item.id === "lum-berry" && mon.status) {
      consumeItem(state, mon, "statusCure");
      mon.status = null;
      mon.statusCounter = 0;
      mon.toxicCounter = 0;
      log(state, `${mon.name} の状態異常が治った！`, "status");
      return true;
    }
    return false;
  }

  function applyConfusion(state, mon) {
    if (hasAbility(mon, "own-tempo")) {
      log(state, `${mon.name} はマイペースで混乱しない！`, "ability");
      return false;
    }
    mon.volatile.confusionTurns = randomInt(state, 2, 5);
    log(state, `${mon.name} は混乱した！`, "status");
    const item = heldItem(mon);
    if (item?.id === "persim-berry" || item?.id === "lum-berry") {
      consumeItem(state, mon, "confusionCure");
      delete mon.volatile.confusionTurns;
      log(state, `${mon.name} の混乱が治った！`, "status");
    }
    return true;
  }

  function applyStatus(state, mon, status, source) {
    if (mon.status || statusImmunity(state, mon, status)) {
      log(state, `${mon.name} には効かなかった！`, "immune");
      return false;
    }
    mon.status = status;
    mon.statusCounter = status === "sleep" ? randomInt(state, 1, 3) : 0;
    mon.toxicCounter = status === "badPoison" ? 1 : 0;
    const names = { poison: "どく", badPoison: "もうどく", burn: "やけど", paralysis: "まひ", sleep: "ねむり", freeze: "こおり" };
    log(state, `${mon.name} は${names[status]}状態になった！`, "status", { pokemon: mon.uid, status });
    if (source && hasAbility(source, "poison-puppeteer") && ["poison", "badPoison"].includes(status)) applyConfusion(state, mon);
    activateStatusBerry(state, mon);
    return true;
  }

  function activateHealingBerry(state, mon) {
    const item = heldItem(mon);
    if (item?.id === "sitrus-berry" && mon.hp > 0 && mon.hp * 2 <= mon.maxHp) {
      consumeItem(state, mon, "lowHp");
      heal(state, mon, Math.floor(mon.maxHp / 4), item.name);
    }
  }

  function markDamageCrossingHalf(state, mon, previousHp) {
    if (hasAbility(mon, "berserk") && previousHp * 2 > mon.maxHp && mon.hp * 2 <= mon.maxHp && mon.hp > 0) {
      changeStage(state, mon, "specialAttack", 1, mon, "ability");
    }
  }

  function calculateAccuracy(state, attacker, target, move, attackerIndex) {
    if (move.id === "toxic" && attacker.typeIds.includes("poison")) return true;
    if (move.id === "hurricane") {
      if (state.field.weather === "rain") return true;
    }
    if (move.accuracy == null) return true;
    let accuracy = move.id === "hurricane" && state.field.weather === "sun" ? 50 : move.accuracy;
    accuracy *= stageMultiplier(attacker.stages.accuracy - target.stages.evasion, true);
    if (hasAbility(attacker, "compound-eyes")) accuracy *= 1.3;
    const attackerItem = heldItem(attacker);
    if (attackerItem?.id === "wide-lens") accuracy *= 1.1;
    if (attackerItem?.id === "zoom-lens" && attacker.volatile.movesAfterTarget) accuracy *= 1.2;
    if (heldItem(target)?.id === "bright-powder") accuracy *= 0.9;
    return chance(state, Math.min(1, accuracy / 100));
  }

  function criticalHit(state, attacker, target, move) {
    if (hasAbility(target, "battle-armor")) return false;
    if (hasAbility(attacker, "merciless") && ["poison", "badPoison"].includes(target.status)) return true;
    let stage = Number(move.effect?.criticalStage || 0);
    if (hasAbility(attacker, "super-luck")) stage += 1;
    if (heldItem(attacker)?.id === "scope-lens") stage += 1;
    const probabilities = [1 / 24, 1 / 8, 0.5, 1];
    return chance(state, probabilities[Math.min(3, stage)]);
  }

  function modifiedMovePower(state, attacker, target, move) {
    let power = move.power;
    const effect = move.effect || {};
    if (effect.kind === "conditionalPower") {
      if (effect.condition === "previousMoveFailed" && attacker.volatile.previousMoveFailed) power *= effect.multiplier;
      if (effect.condition === "userBurnPoisonOrParalysis" && ["burn", "poison", "badPoison", "paralysis"].includes(attacker.status)) power *= effect.multiplier;
    }
    if (effect.kind === "lockedEscalatingDamage") {
      const count = attacker.volatile.rolloutCount || 0;
      power *= 2 ** count;
      if (attacker.volatile.defenseCurl) power *= effect.defenseCurlMultiplier;
    }
    if (effect.kind === "flingHeldItem") power = attacker.volatile.thrownItem?.flingPower ?? heldItem(attacker)?.flingPower ?? null;
    if (power == null) return null;
    if (hasAbility(attacker, "technician") && power <= 60) power *= 1.5;
    const item = heldItem(attacker);
    if (item?.effect?.kind === "movePowerMultiplier" && item.effect.moveTypeId === move.typeId) power *= item.effect.multiplier;
    if (item?.id === "muscle-band" && move.categoryId === "physical") power *= 1.1;
    if (item?.id === "wise-glasses" && move.categoryId === "special") power *= 1.1;
    if (attacker.volatile.charge && move.typeId === "electric") power *= 2;
    return Math.max(1, Math.floor(power));
  }

  function damageStat(mon, stat, stage, ignoreStage) {
    return mon.stats[stat] * (ignoreStage ? 1 : stageMultiplier(stage));
  }

  function calculateDamage(state, attacker, target, move, attackerIndex) {
    const power = modifiedMovePower(state, attacker, target, move);
    if (power == null) return { damage: 0, effectiveness: 1, critical: false };
    const physical = move.categoryId === "physical";
    const attackStat = physical ? "attack" : "specialAttack";
    const defenseStat = physical ? "defense" : "specialDefense";
    const critical = criticalHit(state, attacker, target, move);
    const attackerIgnores = hasAbility(target, "unaware") || (critical && attacker.stages[attackStat] < 0);
    const defenderIgnores = hasAbility(attacker, "unaware") || (critical && target.stages[defenseStat] > 0);
    let attack = damageStat(attacker, attackStat, attacker.stages[attackStat], attackerIgnores);
    let defense = damageStat(target, defenseStat, target.stages[defenseStat], defenderIgnores);
    if (!physical && state.field.weather === "sandstorm" && target.typeIds.includes("rock")) defense *= 1.5;
    if (physical && state.field.weather === "snow" && target.typeIds.includes("ice")) defense *= 1.5;
    let damage = Math.floor(Math.floor(Math.floor((2 * attacker.level) / 5 + 2) * power * attack / Math.max(1, defense)) / 50) + 2;
    if (attacker.typeIds.includes(move.typeId)) damage = Math.floor(damage * 1.5);
    const effectiveness = typeEffectiveness(move.typeId, target);
    damage = Math.floor(damage * effectiveness);
    if (critical) damage = Math.floor(damage * 1.5);
    if (state.field.weather === "rain") {
      if (move.typeId === "water") damage = Math.floor(damage * 1.5);
      if (move.typeId === "fire") damage = Math.floor(damage * 0.5);
    }
    if (state.field.weather === "sun") {
      if (move.typeId === "fire") damage = Math.floor(damage * 1.5);
      if (move.typeId === "water") damage = Math.floor(damage * 0.5);
    }
    if (isGrounded(attacker) && state.field.terrain === move.typeId) damage = Math.floor(damage * 1.3);
    if (isGrounded(target) && state.field.terrain === "misty" && move.typeId === "dragon") damage = Math.floor(damage * 0.5);
    if (isGrounded(target) && state.field.terrain === "grassy" && ["bulldoze", "earthquake", "magnitude"].includes(move.id)) damage = Math.floor(damage * 0.5);
    const defenderSide = state.players[opponentIndex(attackerIndex)].side;
    if (!critical) {
      if (!physical && defenderSide.lightScreenTurns > 0) damage = Math.floor(damage * 0.5);
      if (physical && defenderSide.reflectTurns > 0) damage = Math.floor(damage * 0.5);
      if (defenderSide.auroraVeilTurns > 0) damage = Math.floor(damage * 0.5);
    }
    const attackerItem = heldItem(attacker);
    if (attackerItem?.id === "life-orb") damage = Math.floor(damage * 1.3);
    if (attackerItem?.id === "expert-belt" && effectiveness > 1) damage = Math.floor(damage * 1.2);
    if (attackerItem?.id === "metronome") damage = Math.floor(damage * Math.min(2, 1 + 0.2 * Math.max(0, attacker.metronomeCount - 1)));
    if (attackerItem?.id === "normal-gem" && move.typeId === "normal") {
      consumeItem(state, attacker, "gem");
      damage = Math.floor(damage * 1.3);
    }
    const targetItem = heldItem(target);
    if ((!target.volatile.substituteHp || move.flags.sound) && targetItem?.category === "resistBerry" && targetItem.effect.incomingTypeId === move.typeId
      && (!targetItem.effect.superEffectiveOnly || effectiveness > 1)) {
      consumeItem(state, target, "resistBerry");
      damage = Math.floor(damage * 0.5);
    }
    damage = Math.floor(damage * randomInt(state, 85, 100) / 100);
    if (physical && attacker.status === "burn" && !(move.id === "facade" && move.effect.ignoreBurnAttackDrop)) damage = Math.floor(damage * 0.5);
    return { damage: effectiveness === 0 ? 0 : Math.max(1, damage), effectiveness, critical };
  }

  function dealMoveDamage(state, attacker, target, move, calculated) {
    if (target.volatile.substituteHp && !move.flags.sound) {
      const damage = Math.min(target.volatile.substituteHp, calculated.damage);
      target.volatile.substituteHp -= damage;
      log(state, `${target.name} のみがわりに${damage}ダメージ！`, "damage", { substitute: true, value: damage });
      if (target.volatile.substituteHp <= 0) {
        delete target.volatile.substituteHp;
        log(state, `${target.name} のみがわりは壊れた！`, "status");
      }
      return { damage, toSubstitute: true };
    }
    let damage = Math.min(target.hp, calculated.damage);
    const previousHp = target.hp;
    if (damage >= target.hp && target.hp === target.maxHp && heldItem(target)?.id === "focus-sash") {
      consumeItem(state, target, "survive");
      damage = target.hp - 1;
    }
    target.hp -= damage;
    log(state, `${target.name} に${damage}ダメージ！`, "damage", { pokemon: target.uid, value: damage, critical: calculated.critical, effectiveness: calculated.effectiveness });
    if (calculated.critical) log(state, "急所に当たった！", "critical");
    if (calculated.effectiveness > 1) log(state, "効果は抜群だ！", "effectiveness");
    if (calculated.effectiveness > 0 && calculated.effectiveness < 1) log(state, "効果はいまひとつのようだ…", "effectiveness");
    if (heldItem(target)?.id === "air-balloon" && damage > 0) consumeItem(state, target, "balloonPopped");
    markDamageCrossingHalf(state, target, previousHp);
    faint(state, target);
    if (!target.fainted) activateHealingBerry(state, target);
    return { damage, toSubstitute: false };
  }

  function canAct(state, mon, selectedMove) {
    if (mon.volatile.flinch) {
      delete mon.volatile.flinch;
      log(state, `${mon.name} はひるんで動けない！`, "cantMove");
      return false;
    }
    if (mon.status === "sleep" && !hasAbility(mon, "comatose")) {
      mon.statusCounter -= 1;
      if (mon.statusCounter <= 0) {
        mon.status = null;
        log(state, `${mon.name} は目を覚ました！`, "status");
      } else if (selectedMove?.id !== "sleep-talk") {
        log(state, `${mon.name} はぐうぐう眠っている。`, "cantMove");
        return false;
      }
    }
    if (mon.status === "freeze") {
      if (chance(state, 0.2)) {
        mon.status = null;
        log(state, `${mon.name} のこおりが溶けた！`, "status");
      } else {
        log(state, `${mon.name} は凍って動けない！`, "cantMove");
        return false;
      }
    }
    if (mon.status === "paralysis" && chance(state, 0.25)) {
      log(state, `${mon.name} は体がしびれて動けない！`, "cantMove");
      return false;
    }
    if (mon.volatile.confusionTurns) {
      mon.volatile.confusionTurns -= 1;
      if (mon.volatile.confusionTurns <= 0) {
        delete mon.volatile.confusionTurns;
        log(state, `${mon.name} の混乱が解けた！`, "status");
      } else {
        log(state, `${mon.name} は混乱している！`, "status");
        if (chance(state, 1 / 3)) {
          const attack = mon.stats.attack * stageMultiplier(mon.stages.attack);
          const defense = mon.stats.defense * stageMultiplier(mon.stages.defense);
          const damage = Math.max(1, Math.floor((Math.floor(Math.floor((2 * mon.level) / 5 + 2) * 40 * attack / defense) / 50) + 2));
          dealDirectDamage(state, mon, damage, "混乱");
          return false;
        }
      }
    }
    return true;
  }

  function chooseFallbackSwitch(state, playerIndex, preferred) {
    const choices = availableSwitches(state, playerIndex);
    return choices.includes(Number(preferred)) ? Number(preferred) : choices[0];
  }

  function chooseRequestedSwitch(state, playerIndex, requested) {
    const choices = availableSwitches(state, playerIndex);
    return choices.includes(Number(requested)) ? Number(requested) : null;
  }

  function forceRandomSwitch(state, playerIndex) {
    const choices = availableSwitches(state, playerIndex);
    if (!choices.length) return false;
    const replacement = choices[randomInt(state, 0, choices.length - 1)];
    return switchPokemon(state, playerIndex, replacement);
  }

  function applyContactItems(state, attacker, target, move, action) {
    if (!move.flags.contact || attacker.fainted) return;
    if (heldItem(target)?.id === "rocky-helmet") dealDirectDamage(state, attacker, Math.floor(attacker.maxHp / 6), "ゴツゴツメット");
  }

  function applyPostHitItemSwitch(state, targetPlayerIndex, target, preferred) {
    if (target.fainted || heldItem(target)?.id !== "eject-button") return;
    const replacement = chooseFallbackSwitch(state, targetPlayerIndex, preferred);
    if (replacement == null) return;
    consumeItem(state, target, "ejectButton");
    switchPokemon(state, targetPlayerIndex, replacement);
  }

  function applyLifeOrb(state, attacker, didDamage) {
    if (didDamage && !attacker.fainted && heldItem(attacker)?.id === "life-orb") {
      dealDirectDamage(state, attacker, Math.floor(attacker.maxHp / 10), "いのちのたま");
    }
  }

  function applyKingsRock(state, attacker, target, move) {
    if (target.fainted || move.effect?.volatile === "flinch") return;
    if (heldItem(attacker)?.id === "kings-rock" && chance(state, 0.1)) {
      target.volatile.flinch = true;
      log(state, `${target.name} はひるんだ！`, "status");
    }
  }

  function applySecondaryEffect(state, attacker, target, move, result, action) {
    const effect = move.effect || {};
    if (result.toSubstitute && !move.flags.sound) return;
    if (effect.kind === "damageAndStage" && chance(state, effect.chance ?? 1)) {
      changeStage(state, effect.target === "user" ? attacker : target, effect.stat, effect.stages, attacker);
    }
    if (effect.kind === "damageAndStageOnKo" && target.fainted) {
      changeStage(state, attacker, effect.stat, effect.stages, attacker);
    }
    if (effect.kind === "damageAndStatus" && chance(state, effect.chance ?? 1)) applyStatus(state, target, effect.status, attacker);
    if (effect.kind === "damageAndVolatile" && chance(state, effect.chance ?? 1)) {
      if (effect.volatile === "confusion") applyConfusion(state, target);
      else {
        target.volatile[effect.volatile] = effect.turns || true;
        log(state, effect.volatile === "flinch" ? `${target.name} はひるんだ！` : `${target.name} は回復できなくなった！`, "status");
      }
    }
    if (effect.kind === "weatherAccuracyAndStatus" && chance(state, effect.chance ?? 1)) applyConfusion(state, target);
    if (effect.kind === "recoil" && result.damage > 0 && !attacker.fainted) {
      dealDirectDamage(state, attacker, Math.max(1, Math.floor(result.damage * effect.damageRatio)), "反動");
    }
    if (effect.kind === "drain" && result.damage > 0 && !attacker.fainted) {
      let multiplier = effect.damageRatio;
      if (heldItem(attacker)?.id === "big-root") multiplier *= 1.3;
      heal(state, attacker, Math.max(1, Math.floor(result.damage * multiplier)), move.name);
    }
    if (effect.kind === "rapidSpin" && !attacker.fainted) {
      const side = state.players[action.playerIndex].side;
      side.stealthRock = false;
      side.toxicSpikes = 0;
      side.stickyWeb = false;
      delete attacker.volatile.boundTurns;
      changeStage(state, attacker, "speed", 1, attacker);
      log(state, `${attacker.name} は自分側の設置物を吹き飛ばした！`, "hazard");
    }
    if (effect.kind === "damageThenSwitch" && !attacker.fainted) {
      const replacement = chooseRequestedSwitch(state, action.playerIndex, action.switchTo);
      if (replacement != null) switchPokemon(state, action.playerIndex, replacement);
    }
    if (effect.kind === "flingHeldItem") {
      const thrown = attacker.volatile.thrownItem;
      if (thrown?.flingEffect?.kind === "activateItemOnTarget") activateThrownItem(state, target, thrown);
      if (thrown?.id === "kings-rock" && !target.fainted) target.volatile.flinch = true;
      if (thrown?.id === "poison-barb" && !target.fainted) applyStatus(state, target, "poison", attacker);
      delete attacker.volatile.thrownItem;
    }
  }

  function activateThrownItem(state, target, item) {
    if (target.fainted) return;
    if (item.effect?.kind === "cureStatus" && item.effect.statuses.includes(target.status)) {
      target.status = null;
      target.statusCounter = 0;
      target.toxicCounter = 0;
      log(state, `${target.name} の状態異常が治った！`, "status");
    }
    if (item.id === "sitrus-berry") heal(state, target, Math.floor(target.maxHp / 4), item.name);
    if (item.id === "persim-berry") delete target.volatile.confusionTurns;
    if (item.id === "lum-berry") {
      target.status = null;
      target.statusCounter = 0;
      target.toxicCounter = 0;
      delete target.volatile.confusionTurns;
    }
  }

  function applyStatusMove(state, attacker, target, move, action) {
    const effect = move.effect || {};
    const attackerIndex = action.playerIndex;
    const targetIndex = opponentIndex(attackerIndex);
    switch (effect.kind) {
      case "status":
        applyStatus(state, target, effect.status, attacker);
        break;
      case "delayedStatus":
        target.volatile.yawn = effect.delayTurns + 1;
        log(state, `${target.name} は眠気を誘われた！`, "status");
        break;
      case "encore":
        if (!target.lastMoveId || !target.moves.some((slot) => slot.id === target.lastMoveId && slot.pp > 0)) {
          log(state, "アンコールできる技がない！", "fail");
        } else {
          target.volatile.encore = effect.turns;
          log(state, `${target.name} はアンコールを受けた！`, "status");
          activateMentalHerb(state, target);
        }
        break;
      case "swapRawStat": {
        const value = attacker.stats[effect.stat];
        attacker.stats[effect.stat] = target.stats[effect.stat];
        target.stats[effect.stat] = value;
        log(state, `${attacker.name} と ${target.name} の${effect.stat === "speed" ? "素早さ" : effect.stat}が入れ替わった！`, "stage");
        break;
      }
      case "curse":
        if (attacker.typeIds.includes("ghost")) {
          const cost = Math.floor(attacker.maxHp * effect.ghost.hpCostRatio);
          attacker.hp = Math.max(0, attacker.hp - cost);
          target.volatile.curse = true;
          log(state, `${target.name} はのろわれた！`, "status");
          faint(state, attacker);
        } else {
          Object.entries(effect.other).forEach(([stat, stages]) => changeStage(state, attacker, stat, stages, attacker));
        }
        break;
      case "heal":
        if (attacker.volatile.healBlock) log(state, `${attacker.name} は回復できない！`, "fail");
        else heal(state, attacker, Math.floor(attacker.maxHp * effect.maxHpRatio), move.name);
        break;
      case "roost":
        if (attacker.volatile.healBlock) log(state, `${attacker.name} は回復できない！`, "fail");
        else {
          heal(state, attacker, Math.floor(attacker.maxHp * effect.maxHpRatio), move.name);
          attacker.volatile.roosted = true;
        }
        break;
      case "protect": {
        const denominator = 3 ** attacker.protectChain;
        if (chance(state, 1 / denominator)) {
          attacker.volatile.protected = true;
          attacker.volatile.protectContactStatus = effect.contactStatus || null;
          attacker.protectChain += 1;
          log(state, `${attacker.name} は守りの体勢に入った！`, "status");
        } else {
          attacker.lastMoveFailed = true;
          attacker.protectChain = 0;
          log(state, "しかし、うまく決まらなかった！", "fail");
        }
        break;
      }
      case "substitute": {
        const cost = Math.floor(attacker.maxHp * effect.hpCostRatio);
        if (attacker.hp <= cost || attacker.volatile.substituteHp) log(state, "しかし、みがわりを出せなかった！", "fail");
        else {
          attacker.hp -= cost;
          attacker.volatile.substituteHp = cost;
          log(state, `${attacker.name} はHPを${cost}使ってみがわりを作った！`, "status");
        }
        break;
      }
      case "stage":
        changeStage(state, effect.target === "target" ? target : attacker, effect.stat, effect.stages, attacker);
        if (effect.marksDefenseCurl) attacker.volatile.defenseCurl = true;
        break;
      case "stages":
        Object.entries(effect.stats).forEach(([stat, stages]) => changeStage(state, attacker, stat, stages, attacker));
        break;
      case "stockpile":
        if ((attacker.volatile.stockpile || 0) >= effect.maxCount) log(state, "これ以上たくわえられない！", "fail");
        else {
          attacker.volatile.stockpile = (attacker.volatile.stockpile || 0) + 1;
          attacker.volatile.stockpileStageChanges ||= {};
          Object.entries(effect.stagesEachUse).forEach(([stat, stages]) => {
            const changed = changeStage(state, attacker, stat, stages, attacker);
            attacker.volatile.stockpileStageChanges[stat] = (attacker.volatile.stockpileStageChanges[stat] || 0) + changed;
          });
        }
        break;
      case "resetStages":
        for (const playerIndex of [0, 1]) active(state, playerIndex).stages = Object.fromEntries(STAGE_KEYS.map((stat) => [stat, 0]));
        log(state, "全ての能力変化が元に戻った！", "stage");
        break;
      case "entryHazard": {
        const side = state.players[targetIndex].side;
        if (effect.hazard === "toxicSpikes") side.toxicSpikes = Math.min(effect.maxLayers, side.toxicSpikes + 1);
        else if (effect.hazard === "stealthRock") side.stealthRock = true;
        else if (effect.hazard === "stickyWeb") side.stickyWeb = true;
        log(state, `${state.players[targetIndex].name} の場に${move.name}が設置された！`, "hazard");
        break;
      }
      case "forceRandomSwitch":
        if (!forceRandomSwitch(state, targetIndex)) {
          attacker.lastMoveFailed = true;
          log(state, "しかし、うまく決まらなかった！", "fail");
        }
        break;
      case "weather": {
        const weatherItem = heldItem(attacker);
        const extended = (move.id === "rain-dance" && weatherItem?.id === "damp-rock");
        setWeather(state, effect.weather, extended ? 8 : effect.turns, attacker);
        break;
      }
      case "rest":
        if (attacker.volatile.healBlock) log(state, `${attacker.name} は回復できない！`, "fail");
        else {
          attacker.hp = attacker.maxHp;
          attacker.status = "sleep";
          attacker.statusCounter = effect.sleepTurns + 1;
          attacker.toxicCounter = 0;
          log(state, `${attacker.name} は眠ってHPを全回復した！`, "heal");
          activateStatusBerry(state, attacker);
        }
        break;
      case "bellyDrum": {
        const cost = Math.floor(attacker.maxHp * effect.hpCostRatio);
        if (attacker.hp <= cost || attacker.stages.attack >= 6) log(state, "しかし、うまく決まらなかった！", "fail");
        else {
          attacker.hp -= cost;
          changeStage(state, attacker, "attack", 6 - attacker.stages.attack, attacker);
        }
        break;
      }
      case "switch": {
        const replacement = chooseRequestedSwitch(state, attackerIndex, action.switchTo);
        if (replacement == null) log(state, "交代できるポケモンがいない！", "fail");
        else switchPokemon(state, attackerIndex, replacement, { pass: effect.passStagesAndVolatiles });
        break;
      }
      case "consumeBerryAndStage": {
        const berry = heldItem(attacker);
        if (!berry || !BERRY_CATEGORIES.has(berry.category)) log(state, "食べられるきのみを持っていない！", "fail");
        else {
          consumeItem(state, attacker, "stuffCheeks");
          activateThrownItem(state, attacker, berry);
          changeStage(state, attacker, effect.stat, effect.stages, attacker);
        }
        break;
      }
      case "swallow": {
        const stockpile = attacker.volatile.stockpile || 0;
        if (!stockpile) log(state, "たくわえていないので失敗した！", "fail");
        else {
          if (!attacker.volatile.healBlock) heal(state, attacker, Math.floor(attacker.maxHp * effect.stockpileHealing[stockpile]), move.name);
          for (const [stat, stages] of Object.entries(attacker.volatile.stockpileStageChanges || {})) {
            attacker.stages[stat] = clamp(attacker.stages[stat] - stages, -6, 6);
          }
          delete attacker.volatile.stockpile;
          delete attacker.volatile.stockpileStageChanges;
        }
        break;
      }
      case "charge":
        attacker.volatile.charge = 2;
        changeStage(state, attacker, "specialDefense", 1, attacker);
        break;
      case "terrain": {
        const turns = heldItem(attacker)?.id === "terrain-extender" ? 8 : effect.turns;
        state.field.terrain = effect.terrain;
        state.field.terrainTurns = turns;
        log(state, `${move.name}が場に広がった！`, "terrain");
        activateTerrainItems(state);
        break;
      }
      case "room":
        state.field.trickRoomTurns = state.field.trickRoomTurns ? 0 : effect.turns;
        log(state, state.field.trickRoomTurns ? "時空がゆがんだ！" : "ゆがんだ時空が元に戻った！", "field");
        break;
      case "weatherThenSwitch": {
        const turns = heldItem(attacker)?.id === "icy-rock" ? 8 : effect.turns;
        setWeather(state, effect.weather, turns, attacker);
        const replacement = chooseRequestedSwitch(state, attackerIndex, action.switchTo);
        if (replacement != null) switchPokemon(state, attackerIndex, replacement);
        break;
      }
      case "stagesAndTrapSelf":
        if (attacker.volatile.noRetreatUsed) log(state, "しかし、うまく決まらなかった！", "fail");
        else {
          Object.entries(effect.stats).forEach(([stat, stages]) => changeStage(state, attacker, stat, stages, attacker));
          attacker.volatile.trapped = true;
          attacker.volatile.noRetreatUsed = true;
        }
        break;
      case "taunt":
        if (hasAbility(target, "oblivious")) log(state, `${target.name} には効かなかった！`, "immune");
        else {
          target.volatile.taunt = 3;
          log(state, `${target.name} は挑発に乗ってしまった！`, "status");
          activateMentalHerb(state, target);
        }
        break;
      case "callRandomKnownMove":
        executeSleepTalk(state, attackerIndex, attacker, target, action);
        break;
      case "swapHeldItems": {
        const attackerItem = heldItem(attacker);
        const targetItem = heldItem(target);
        // Sticky Hold prevents an opponent from taking the holder's item. It
        // does not stop that Pokemon from using Trick itself.
        if (hasAbility(target, "sticky-hold")) {
          attacker.lastMoveFailed = true;
          log(state, `${target.name} はねんちゃくで持ち物を守った！`, "ability");
        } else if (!attackerItem && !targetItem) {
          attacker.lastMoveFailed = true;
          log(state, "しかし、うまく決まらなかった！", "fail");
        } else {
          replaceHeldItem(attacker, targetItem);
          replaceHeldItem(target, attackerItem);
          log(state, `${attacker.name} と ${target.name} は持ち物を入れ替えた！`, "item");
          // Berries whose conditions are already met activate as soon as they
          // are obtained through Trick.
          activateStatusBerry(state, attacker);
          activateStatusBerry(state, target);
          activateHealingBerry(state, attacker);
          activateHealingBerry(state, target);
        }
        break;
      }
      case "destinyBond":
        attacker.volatile.destinyBond = true;
        log(state, `${attacker.name} は相手を道連れにしようとしている！`, "status");
        break;
      case "stagesWithHpCost": {
        const cost = Math.floor(attacker.maxHp * effect.hpCostRatio);
        if (attacker.hp <= cost) log(state, "HPが足りない！", "fail");
        else {
          attacker.hp -= cost;
          Object.entries(effect.stats).forEach(([stat, stages]) => changeStage(state, attacker, stat, stages, attacker));
        }
        break;
      }
      case "screen": {
        const side = state.players[attackerIndex].side;
        const turns = heldItem(attacker)?.id === "light-clay" ? 8 : effect.turns;
        if (effect.screen === "lightScreen") side.lightScreenTurns = turns;
        if (effect.screen === "reflect") side.reflectTurns = turns;
        if (effect.screen === "auroraVeil") side.auroraVeilTurns = turns;
        log(state, `${state.players[attackerIndex].name} の場に${move.name}が張られた！`, "field");
        break;
      }
      case "sideCondition":
        if (effect.condition === "tailwind") {
          state.players[attackerIndex].side.tailwindTurns = effect.turns;
          log(state, `${state.players[attackerIndex].name} の場に追い風が吹き始めた！`, "field");
        }
        break;
      case "tidyUp":
        for (const player of state.players) {
          player.side.stealthRock = false;
          player.side.toxicSpikes = 0;
          player.side.stickyWeb = false;
          for (const mon of player.team) delete mon.volatile.substituteHp;
        }
        changeStage(state, attacker, "attack", 1, attacker);
        changeStage(state, attacker, "speed", 1, attacker);
        log(state, "場がきれいに片付いた！", "field");
        break;
      case "none":
        log(state, "しかし、何も起こらなかった。", "info");
        break;
      default:
        log(state, "しかし、うまく決まらなかった！", "fail");
    }
  }

  function activateMentalHerb(state, mon) {
    if (heldItem(mon)?.id !== "mental-herb") return;
    const keys = ["encore", "torment", "healBlock", "taunt", "infatuation"];
    if (!keys.some((key) => mon.volatile[key])) return;
    consumeItem(state, mon, "mentalCure");
    keys.forEach((key) => delete mon.volatile[key]);
    log(state, `${mon.name} のメンタル系の状態が治った！`, "status");
  }

  function executeSleepTalk(state, attackerIndex, attacker, target, action) {
    if (attacker.status !== "sleep" && !hasAbility(attacker, "comatose")) {
      log(state, "眠っていないので失敗した！", "fail");
      return;
    }
    const candidates = attacker.moves.filter((slot) => slot.id !== "sleep-talk" && !["rest"].includes(slot.id));
    if (!candidates.length) {
      log(state, "出せる技がない！", "fail");
      return;
    }
    const called = candidates[randomInt(state, 0, candidates.length - 1)].id;
    log(state, `ねごとで ${DATA.moves[called].name} が選ばれた！`, "move");
    executeMove(state, { ...action, moveId: called, calledByOtherMove: true }, attackerIndex);
  }

  const STRUGGLE = {
    id: "struggle", name: "わるあがき", typeId: "normal", categoryId: "physical", power: 50,
    accuracy: null, pp: 1, priority: 0, targetId: "oneOpponent",
    flags: { contact: true, sound: false, protectable: true, reflectable: false, snatchable: false },
    effect: { kind: "recoil", damageRatio: 0.25, recoilFromMaxHp: true },
  };

  function selectedMoveForAction(mon, action) {
    if (mon.volatile.chargingMove) return DATA.moves[mon.volatile.chargingMove.moveId];
    if (mon.volatile.rolloutMove) return DATA.moves[mon.volatile.rolloutMove];
    const slot = mon.moves.find((candidate) => candidate.id === action.moveId && candidate.pp > 0);
    if (slot) return DATA.moves[slot.id];
    if (mon.moves.every((candidate) => candidate.pp <= 0)) return STRUGGLE;
    return null;
  }

  function executeMove(state, action, attackerIndex) {
    const attacker = active(state, attackerIndex);
    const targetIndex = opponentIndex(attackerIndex);
    const target = active(state, targetIndex);
    let move = action.calledByOtherMove ? DATA.moves[action.moveId] : selectedMoveForAction(attacker, action);
    if (!move || attacker.fainted) return;

    attacker.volatile.previousMoveFailed = Boolean(attacker.lastMoveFailed);
    const firstTurnEligible = attacker.firstTurnEligible;
    attacker.firstTurnEligible = false;
    const wasCharging = attacker.volatile.chargingMove?.moveId === move.id;
    const calledByOtherMove = Boolean(action.calledByOtherMove);
    if (!calledByOtherMove && !canAct(state, attacker, move)) {
      attacker.lastMoveFailed = true;
      return;
    }
    if (attacker.volatile.destinyBond && move.id !== "destiny-bond") delete attacker.volatile.destinyBond;
    if (attacker.volatile.taunt && move.categoryId === "status") {
      log(state, `${attacker.name} はちょうはつされて ${move.name} を出せない！`, "fail");
      attacker.lastMoveFailed = true;
      return;
    }
    if (hasChoiceItem(attacker) && attacker.choiceLockedMoveId && attacker.choiceLockedMoveId !== move.id && !wasCharging) {
      log(state, `${attacker.name} は ${move.name} を選べない！`, "fail");
      attacker.lastMoveFailed = true;
      return;
    }
    if (!calledByOtherMove && !wasCharging && move.id !== "struggle") {
      const slot = attacker.moves.find((candidate) => candidate.id === move.id);
      if (!slot || slot.pp <= 0) {
        attacker.lastMoveFailed = true;
        log(state, "技のPPが残っていない！", "fail");
        return;
      }
      slot.pp -= 1;
    }

    log(state, `${attacker.name} の ${move.name}！`, "move", { playerId: state.players[attackerIndex].id, pokemon: attacker.uid, moveId: move.id });
    attacker.lastMoveId = move.id;
    attacker.lastMoveFailed = false;
    if (!PROTECT_MOVES.has(move.id)) attacker.protectChain = 0;
    if (hasChoiceItem(attacker) && !attacker.choiceLockedMoveId && move.id !== "struggle") attacker.choiceLockedMoveId = move.id;
    if (heldItem(attacker)?.id === "metronome") {
      if (attacker.metronomeMoveId === move.id) attacker.metronomeCount += 1;
      else {
        attacker.metronomeMoveId = move.id;
        attacker.metronomeCount = 1;
      }
    }

    if (move.effect?.kind === "conditionalDamage") {
      let allowed = true;
      if (move.effect.condition === "usersFirstTurnOut") allowed = firstTurnEligible;
      if (move.effect.condition === "userConsumedBerryThisBattle") {
        const consumed = DATA.items[attacker.lastConsumedItemId];
        allowed = Boolean(consumed && BERRY_CATEGORIES.has(consumed.category));
      }
      if (move.effect.condition === "targetSelectedAttackingMoveAndHasNotActed") {
        const targetAction = state._turnActions?.[state.players[targetIndex].id];
        const selectedTargetMove = targetAction?.type === "move" ? selectedMoveForAction(target, targetAction) : null;
        allowed = Boolean(selectedTargetMove && selectedTargetMove.categoryId !== "status" && !target.volatile.actedThisTurn);
      }
      if (!allowed) {
        attacker.lastMoveFailed = true;
        log(state, "しかし、うまく決まらなかった！", "fail");
        return;
      }
    }

    if (move.effect?.kind === "twoTurnAttack" && !wasCharging) {
      attacker.volatile.chargingMove = { moveId: move.id, invulnerable: move.effect.invulnerable };
      log(state, `${attacker.name} は地中に潜った！`, "status");
      return;
    }
    if (wasCharging) delete attacker.volatile.chargingMove;

    if (target.volatile.chargingMove?.invulnerable === "underground" && !["earthquake", "magnitude"].includes(move.id)) {
      log(state, `${target.name} には当たらなかった！`, "miss");
      attacker.lastMoveFailed = true;
      return;
    }
    if (move.priority > 0 && state.field.terrain === "psychic" && isGrounded(attacker) && isGrounded(target)) {
      log(state, `${target.name} はサイコフィールドに守られている！`, "immune");
      attacker.lastMoveFailed = true;
      return;
    }
    if (target.volatile.protected && move.flags.protectable) {
      log(state, `${target.name} は攻撃から身を守った！`, "protect");
      if (move.flags.contact && target.volatile.protectContactStatus) applyStatus(state, attacker, target.volatile.protectContactStatus, target);
      attacker.lastMoveFailed = true;
      return;
    }

    let actualAttacker = attacker;
    let actualTarget = target;
    let actualAction = action;
    let actualAttackerIndex = attackerIndex;
    if (move.categoryId === "status" && move.flags.reflectable && hasAbility(target, "magic-bounce")) {
      log(state, `${target.name} のマジックミラーで技を跳ね返した！`, "ability");
      actualAttacker = target;
      actualTarget = attacker;
      actualAttackerIndex = targetIndex;
      actualAction = { ...action, playerIndex: targetIndex };
    }
    if (actualTarget.volatile.substituteHp && move.categoryId === "status" && move.targetId === "oneOpponent" && !move.flags.sound) {
      log(state, `${actualTarget.name} のみがわりに防がれた！`, "fail");
      attacker.lastMoveFailed = true;
      return;
    }
    if (move.id === "thunder-wave" && typeEffectiveness("electric", actualTarget) === 0) {
      log(state, `${actualTarget.name} には効果がないようだ…。`, "immune");
      attacker.lastMoveFailed = true;
      return;
    }
    if (!calculateAccuracy(state, actualAttacker, actualTarget, move, actualAttackerIndex)) {
      log(state, `${actualTarget.name} には当たらなかった！`, "miss");
      attacker.lastMoveFailed = true;
      if (move.effect?.kind === "lockedEscalatingDamage") {
        delete attacker.volatile.rolloutMove;
        attacker.volatile.rolloutCount = 0;
      }
      return;
    }

    if (move.categoryId === "status") {
      applyStatusMove(state, actualAttacker, actualTarget, move, actualAction);
      actualAttacker.volatile.actedThisTurn = true;
      return;
    }

    if (move.effect?.kind === "flingHeldItem") {
      const thrown = heldItem(attacker);
      if (!thrown || thrown.flingPower == null || hasAbility(attacker, "sticky-hold") && false) {
        log(state, "投げつけられる持ち物がない！", "fail");
        attacker.lastMoveFailed = true;
        return;
      }
      attacker.volatile.thrownItem = clone(thrown);
      consumeItem(state, attacker, "fling");
    }

    const effectiveness = typeEffectiveness(move.typeId, target);
    if (effectiveness === 0) {
      log(state, `${target.name} には効果がないようだ…。`, "immune");
      attacker.lastMoveFailed = true;
      return;
    }
    const targetHadDestinyBond = Boolean(target.volatile.destinyBond);
    const calculation = calculateDamage(state, attacker, target, move, attackerIndex);
    const result = dealMoveDamage(state, attacker, target, move, calculation);
    applySecondaryEffect(state, attacker, target, move, result, action);
    applyKingsRock(state, attacker, target, move);
    applyContactItems(state, attacker, target, move, action);
    if (!target.fainted && heldItem(target)?.id === "red-card") {
      const replacements = availableSwitches(state, attackerIndex);
      if (replacements.length && !attacker.fainted) {
        consumeItem(state, target, "redCard");
        switchPokemon(state, attackerIndex, replacements[randomInt(state, 0, replacements.length - 1)]);
      }
    }
    const targetSwitchPreference = state._turnActions?.[state.players[targetIndex].id]?.switchPreference;
    applyPostHitItemSwitch(state, targetIndex, target, targetSwitchPreference);
    applyLifeOrb(state, attacker, result.damage > 0);
    if (move.effect?.kind === "damageAndForceRandomSwitch" && !target.fainted && !result.toSubstitute && active(state, targetIndex).uid === target.uid) {
      forceRandomSwitch(state, targetIndex);
    }
    if (move.id === "struggle" && !attacker.fainted) dealDirectDamage(state, attacker, Math.floor(attacker.maxHp / 4), "わるあがきの反動");
    if (attacker.volatile.charge && move.typeId === "electric") delete attacker.volatile.charge;
    if (move.effect?.kind === "lockedEscalatingDamage") {
      attacker.volatile.rolloutCount = (attacker.volatile.rolloutCount || 0) + 1;
      if (attacker.volatile.rolloutCount < move.effect.turns && !target.fainted) attacker.volatile.rolloutMove = move.id;
      else {
        delete attacker.volatile.rolloutMove;
        attacker.volatile.rolloutCount = 0;
      }
    }
    if (target.fainted && targetHadDestinyBond && !attacker.fainted) {
      attacker.hp = 0;
      faint(state, attacker);
      log(state, `${attacker.name} はみちづれになった！`, "faint");
    }
    delete attacker.volatile.previousMoveFailed;
    attacker.volatile.actedThisTurn = true;
    updateBattleOutcome(state);
  }

  function normaliseAction(state, playerIndex, rawAction) {
    const mon = active(state, playerIndex);
    if (rawAction?.type === "switch") return { type: "switch", to: Number(rawAction.to), playerIndex, actorUid: mon.uid };
    let moveId = rawAction?.moveId;
    if (mon.volatile.chargingMove) moveId = mon.volatile.chargingMove.moveId;
    if (mon.volatile.rolloutMove) moveId = mon.volatile.rolloutMove;
    if (mon.volatile.encore && mon.lastMoveId && mon.moves.some((slot) => slot.id === mon.lastMoveId && slot.pp > 0)) moveId = mon.lastMoveId;
    return {
      type: "move",
      moveId,
      switchTo: rawAction?.switchTo == null ? null : Number(rawAction.switchTo),
      switchPreference: rawAction?.switchPreference == null ? null : Number(rawAction.switchPreference),
      playerIndex,
      actorUid: mon.uid,
    };
  }

  function validateAction(state, playerIndex, action) {
    const mon = active(state, playerIndex);
    if (action.type === "switch") {
      if (mon.volatile.trapped && !mon.fainted && heldItem(mon)?.id !== "shed-shell") return "このポケモンは交代できません。";
      if (!availableSwitches(state, playerIndex).includes(Number(action.to))) return "交代先が不正です。";
      return null;
    }
    const selected = selectedMoveForAction(mon, action);
    if (!selected) return "使用できない技です。";
    const needsSwitchTarget = ["damageThenSwitch", "weatherThenSwitch", "switch"].includes(selected.effect?.kind);
    const switchTargets = voluntarySwitches(state, playerIndex);
    if (needsSwitchTarget && switchTargets.length && !switchTargets.includes(Number(action.switchTo))) {
      return `${selected.name}で交代するポケモンを指定してください。`;
    }
    return null;
  }

  function actionPriority(state, action) {
    if (action.type === "switch") return { group: 3, priority: 0, quick: false };
    const mon = active(state, action.playerIndex);
    const move = selectedMoveForAction(mon, action) || STRUGGLE;
    const quick = heldItem(mon)?.id === "quick-claw" && chance(state, 0.2);
    if (quick) log(state, `${mon.name} のせんせいのツメが光った！`, "item");
    return { group: 2, priority: move.priority, quick };
  }

  function sortActions(state, actions) {
    const decorated = actions.map((action) => ({ action, order: actionPriority(state, action), tie: random(state) }));
    decorated.sort((left, right) => {
      if (left.order.group !== right.order.group) return right.order.group - left.order.group;
      if (left.order.priority !== right.order.priority) return right.order.priority - left.order.priority;
      if (left.order.quick !== right.order.quick) return Number(right.order.quick) - Number(left.order.quick);
      const leftSpeed = effectiveSpeed(state, left.action.playerIndex);
      const rightSpeed = effectiveSpeed(state, right.action.playerIndex);
      if (leftSpeed !== rightSpeed) {
        return state.field.trickRoomTurns > 0 ? leftSpeed - rightSpeed : rightSpeed - leftSpeed;
      }
      return left.tie - right.tie;
    });
    return decorated.map(({ action }) => action);
  }

  function updateBattleOutcome(state) {
    const alive = state.players.map((player) => player.team.some((mon) => !mon.fainted && mon.hp > 0));
    if (alive[0] && alive[1]) return false;
    state.phase = "ended";
    state.result = !alive[0] && !alive[1] ? "draw" : "win";
    state.winnerId = alive[0] ? state.players[0].id : alive[1] ? state.players[1].id : null;
    log(state, state.winnerId ? `${state.players.find((player) => player.id === state.winnerId).name} の勝利！` : "引き分け！", "result");
    return true;
  }

  function determineRequiredSwitches(state) {
    if (updateBattleOutcome(state)) return;
    state.requiredSwitches = [0, 1].filter((playerIndex) => active(state, playerIndex).fainted && availableSwitches(state, playerIndex).length);
    state.phase = state.requiredSwitches.length ? "forcedSwitch" : "battle";
  }

  function decrementCounter(object, key) {
    if (!object[key]) return;
    object[key] -= 1;
    if (object[key] <= 0) delete object[key];
  }

  function endTurn(state) {
    for (const playerIndex of orderedPlayerIndexes(state)) {
      const mon = active(state, playerIndex);
      if (mon.fainted) continue;
      if (state.field.weather === "sandstorm" && !mon.typeIds.some((type) => ["rock", "ground", "steel"].includes(type))) {
        dealDirectDamage(state, mon, Math.floor(mon.maxHp / 16), "砂嵐");
      }
      if (mon.fainted) continue;
      if (mon.status === "burn") dealDirectDamage(state, mon, Math.floor(mon.maxHp / 16), "やけど");
      if (mon.status === "poison") dealDirectDamage(state, mon, Math.floor(mon.maxHp / 8), "どく");
      if (mon.status === "badPoison") {
        dealDirectDamage(state, mon, Math.floor(mon.maxHp * mon.toxicCounter / 16), "もうどく");
        mon.toxicCounter = Math.min(15, mon.toxicCounter + 1);
      }
      if (mon.fainted) continue;
      if (mon.volatile.curse) dealDirectDamage(state, mon, Math.floor(mon.maxHp / 4), "のろい");
      if (mon.fainted) continue;
      if (state.field.terrain === "grassy" && isGrounded(mon)) heal(state, mon, Math.floor(mon.maxHp / 16), "グラスフィールド");
      if (heldItem(mon)?.id === "leftovers") heal(state, mon, Math.floor(mon.maxHp / 16), "たべのこし");
      if (mon.volatile.whiteHerbPending && heldItem(mon)?.id === "white-herb") {
        consumeItem(state, mon, "restoreStages");
        for (const stat of STAGE_KEYS) mon.stages[stat] = Math.max(0, mon.stages[stat]);
        delete mon.volatile.whiteHerbPending;
        log(state, `${mon.name} の下がった能力が元に戻った！`, "item");
      }
      if (mon.volatile.yawn) {
        mon.volatile.yawn -= 1;
        if (mon.volatile.yawn <= 0) {
          delete mon.volatile.yawn;
          applyStatus(state, mon, "sleep", null);
        }
      }
      decrementCounter(mon.volatile, "taunt");
      decrementCounter(mon.volatile, "encore");
      decrementCounter(mon.volatile, "healBlock");
      decrementCounter(mon.volatile, "charge");
      delete mon.volatile.protected;
      delete mon.volatile.protectContactStatus;
      delete mon.volatile.flinch;
      delete mon.volatile.roosted;
      delete mon.volatile.movesAfterTarget;
      delete mon.volatile.actedThisTurn;
      mon.turnsActive += 1;
    }
    if (state.field.weatherTurns > 0 && --state.field.weatherTurns <= 0) {
      state.field.weather = null;
      log(state, "天気が元に戻った。", "weather");
    }
    if (state.field.terrainTurns > 0 && --state.field.terrainTurns <= 0) {
      state.field.terrain = null;
      log(state, "フィールドの効果がなくなった。", "terrain");
    }
    if (state.field.trickRoomTurns > 0 && --state.field.trickRoomTurns <= 0) log(state, "ゆがんだ時空が元に戻った！", "field");
    for (const player of state.players) {
      for (const key of ["lightScreenTurns", "reflectTurns", "auroraVeilTurns", "tailwindTurns"]) {
        if (player.side[key] > 0) player.side[key] -= 1;
      }
    }
    updateBattleOutcome(state);
  }

  function resolveForcedSwitch(state, commands) {
    const next = clone(state);
    const requested = [...next.requiredSwitches];
    for (const playerIndex of requested) {
      const player = next.players[playerIndex];
      const action = commands[player.id];
      if (!action || action.type !== "switch") throw new Error(`${player.name} の交代入力が必要です。`);
      const normalised = normaliseAction(next, playerIndex, action);
      const error = validateAction(next, playerIndex, normalised);
      if (error) throw new Error(error);
      switchPokemon(next, playerIndex, normalised.to);
    }
    next.requiredSwitches = [];
    if (next.phase !== "ended") next.phase = "battle";
    return next;
  }

  function resolveTurn(state, commands) {
    if (!state || state.phase === "ended") throw new Error("終了した対戦は進行できません。");
    if (state.phase === "forcedSwitch") return resolveForcedSwitch(state, commands);
    const next = clone(state);
    const actions = next.players.map((player, playerIndex) => {
      if (!commands?.[player.id]) throw new Error(`${player.name} の入力がありません。`);
      const action = normaliseAction(next, playerIndex, commands[player.id]);
      const error = validateAction(next, playerIndex, action);
      if (error) throw new Error(`${player.name}: ${error}`);
      return action;
    });
    next._turnActions = Object.fromEntries(actions.map((action) => [next.players[action.playerIndex].id, action]));
    log(next, `ターン ${next.turn}`, "turn");
    const ordered = sortActions(next, actions);
    ordered.forEach((action, orderIndex) => {
      const mon = active(next, action.playerIndex);
      if (mon.uid !== action.actorUid || mon.fainted || next.phase === "ended") return;
      const foe = active(next, opponentIndex(action.playerIndex));
      mon.volatile.movesAfterTarget = Boolean(foe.volatile.actedThisTurn);
      if (action.type === "switch") switchPokemon(next, action.playerIndex, action.to);
      else executeMove(next, action, action.playerIndex);
      active(next, action.playerIndex).volatile.actedThisTurn = true;
      if (orderIndex === ordered.length - 1) updateBattleOutcome(next);
    });
    if (next.phase !== "ended") endTurn(next);
    if (next.phase !== "ended") {
      next.turn += 1;
      determineRequiredSwitches(next);
    }
    delete next._turnActions;
    return next;
  }

  function legalActions(state, playerId) {
    const playerIndex = playerIndexById(state, playerId);
    if (playerIndex < 0 || state.phase === "ended") return { moves: [], switches: [], forcedSwitch: false };
    const mon = active(state, playerIndex);
    const switches = availableSwitches(state, playerIndex);
    if (state.phase === "forcedSwitch") {
      return { moves: [], switches: state.requiredSwitches.includes(playerIndex) ? switches : [], forcedSwitch: state.requiredSwitches.includes(playerIndex) };
    }
    const forcedMoveId = mon.volatile.chargingMove?.moveId || mon.volatile.rolloutMove || mon.volatile.encore && mon.lastMoveId;
    const moves = mon.moves.every((slot) => slot.pp <= 0) ? [{
      id: "struggle", pp: 1, maxPp: 1, disabled: false, requiresSwitchTarget: false,
    }] : mon.moves.map((slot) => ({
      ...slot,
      disabled: slot.pp <= 0 || Boolean(forcedMoveId && forcedMoveId !== slot.id) || Boolean(hasChoiceItem(mon) && mon.choiceLockedMoveId && mon.choiceLockedMoveId !== slot.id) || Boolean(mon.volatile.taunt && DATA.moves[slot.id].categoryId === "status"),
      requiresSwitchTarget: ["damageThenSwitch", "weatherThenSwitch", "switch"].includes(DATA.moves[slot.id].effect?.kind),
    }));
    return { moves, switches: voluntarySwitches(state, playerIndex), forcedSwitch: false };
  }

  function publicTeam(party) {
    return party.map((build) => {
      const species = DATA.pokemon[build.speciesId];
      return { speciesId: build.speciesId, name: build.nickname || species.name, types: species.types };
    });
  }

  const BattleEngine = Object.freeze({
    version: 2,
    STAT_KEYS: Object.freeze([...STAT_KEYS]),
    hashString,
    calculateStats,
    createDefaultParty,
    migrateParty,
    effortPointsForBuild,
    effortPointToEv,
    legacyEvToEffortPoint,
    validateParty,
    createBattle,
    resolveTurn,
    legalActions,
    typeEffectiveness,
    publicTeam,
    clone,
  });

  global.BattleEngine = BattleEngine;
  if (typeof module !== "undefined" && module.exports) module.exports = BattleEngine;
})(typeof globalThis !== "undefined" ? globalThis : window);
