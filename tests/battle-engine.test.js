const test = require("node:test");
const assert = require("node:assert/strict");

require("../data.js");
const engine = require("../battle-engine.js");

function defaultTeams() {
  const partyA = engine.createDefaultParty();
  const partyB = engine.createDefaultParty();
  return [partyA.slice(0, 3), partyB.slice(3, 6)];
}

function battleWith(teamA, teamB, seed = 12345) {
  return engine.createBattle({
    players: [
      { id: "player-a", name: "PLAYER A", team: teamA },
      { id: "player-b", name: "PLAYER B", team: teamB },
    ],
    seed,
  });
}

test("master data and default party are valid", () => {
  assert.equal(GAME_DATA.pokemonList.length, 6);
  assert.equal(GAME_DATA.moveList.length, 99);
  assert.equal(GAME_DATA.itemList.length, 79);
  assert.deepEqual(engine.validateParty(engine.createDefaultParty()), []);
});

test("stat and type calculations follow level 50 rules", () => {
  const build = engine.createDefaultParty()[0];
  const stats = engine.calculateStats(build.speciesId, build);
  assert.deepEqual(stats, { hp: 168, attack: 115, defense: 112, specialAttack: 115, specialDefense: 115, speed: 105 });
  const target = { typeIds: ["water", "poison"], volatile: {}, itemId: null, itemConsumed: false };
  assert.equal(engine.typeEffectiveness("electric", target), 2);
  assert.equal(engine.typeEffectiveness("fighting", { ...target, typeIds: ["ghost"] }), 0);
});

test("same seed and commands always produce identical state", () => {
  const [teamA, teamB] = defaultTeams();
  teamA[0] = { ...teamA[0], moveIds: ["muddy-water"] };
  teamB[0] = { ...teamB[0], moveIds: ["psychic"] };
  const initial = battleWith(teamA, teamB, 987654321);
  const commands = {
    "player-a": { type: "move", moveId: "muddy-water" },
    "player-b": { type: "move", moveId: "psychic" },
  };
  assert.deepEqual(engine.resolveTurn(initial, commands), engine.resolveTurn(initial, commands));
});

test("damage, poison immunity and guaranteed Poison-type Toxic work", () => {
  const all = engine.createDefaultParty();
  const teamA = [
    { ...all[0], moveIds: ["toxic", "muddy-water"] },
    all[1], all[2],
  ];
  const teamB = [
    { ...all[1], moveIds: ["celebrate"] },
    all[3], all[5],
  ];
  let state = battleWith(teamA, teamB, 11);
  state = engine.resolveTurn(state, {
    "player-a": { type: "move", moveId: "toxic" },
    "player-b": { type: "move", moveId: "celebrate" },
  });
  assert.equal(state.players[1].team[0].status, "badPoison");
  state = engine.resolveTurn(state, {
    "player-a": { type: "move", moveId: "muddy-water" },
    "player-b": { type: "move", moveId: "celebrate" },
  });
  assert.ok(state.players[1].team[0].hp < state.players[1].team[0].maxHp);
});

test("Focus Sash survives a lethal hit exactly once", () => {
  const all = engine.createDefaultParty();
  const attacker = { ...all[2], moveIds: ["head-smash"] };
  const defender = { ...all[4], moveIds: ["nasty-plot"], itemId: "focus-sash" };
  const state = battleWith([attacker, all[0], all[1]], [defender, all[3], all[5]], 77);
  state.players[0].team[0].stats.attack = 9999;
  const next = engine.resolveTurn(state, {
    "player-a": { type: "move", moveId: "head-smash" },
    "player-b": { type: "move", moveId: "nasty-plot" },
  });
  assert.equal(next.players[1].team[0].hp, 1);
  assert.equal(next.players[1].team[0].itemConsumed, true);
});

test("fainted active Pokemon requires and accepts a replacement", () => {
  const [teamA, teamB] = defaultTeams();
  const state = battleWith(teamA, teamB);
  state.players[0].team[0].hp = 0;
  state.players[0].team[0].fainted = true;
  state.phase = "forcedSwitch";
  state.requiredSwitches = [0];
  const next = engine.resolveTurn(state, { "player-a": { type: "switch", to: 1 } });
  assert.equal(next.phase, "battle");
  assert.equal(next.players[0].active, 1);
});

test("every configured move effect can execute without corrupting state", () => {
  const defaults = engine.createDefaultParty();
  for (const move of GAME_DATA.moveList) {
    const ownerIndex = GAME_DATA.pokemonList.findIndex((species) => species.moveIds.includes(move.id));
    const order = [ownerIndex, ...defaults.map((_, index) => index).filter((index) => index !== ownerIndex)].slice(0, 3);
    const teamA = order.map((index, slot) => ({ ...defaults[index], moveIds: slot === 0 ? [move.id] : defaults[index].moveIds }));
    const otherOrder = defaults.map((_, index) => index).filter((index) => !order.includes(index)).concat(order).slice(0, 3);
    const teamB = otherOrder.map((index) => defaults[index]);
    const state = battleWith(teamA, teamB, 2468);
    assert.doesNotThrow(() => engine.resolveTurn(state, {
      "player-a": { type: "move", moveId: move.id, switchTo: 1, switchPreference: 1, opponentSwitchPreference: 1 },
      "player-b": { type: "move", moveId: teamB[0].moveIds[0], switchTo: 1, switchPreference: 1, opponentSwitchPreference: 1 },
    }), move.name);
  }
});
