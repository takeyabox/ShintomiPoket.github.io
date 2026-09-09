const test = require("node:test");
const assert = require("node:assert/strict");

require("../data.js");
const engine = require("../battle-engine.js");
const { FirebaseBattleRoom, applyBattleAction, playerKeyFromName } = require("../firebase-sync.js");

function roomState() {
  const party = engine.createDefaultParty();
  const battle = engine.createBattle({
    players: [
      { id: "one", name: "ONE", team: party.slice(0, 3) },
      { id: "two", name: "TWO", team: party.slice(3, 6) },
    ],
    seed: 404,
  });
  return {
    phase: "battle",
    battle,
    commands: {},
    players: { one: { id: "one" }, two: { id: "two" } },
  };
}

test("Japanese player names produce stable Firebase-safe keys", () => {
  const key = playerKeyFromName(" 竹重 颯真 ");
  assert.equal(key, playerKeyFromName("竹重 颯真"));
  assert.match(key, /^p_[A-Za-z0-9_-]+$/);
});

test("a turn advances only after both device commands arrive", () => {
  const room = roomState();
  applyBattleAction(room, "one", { type: "move", moveId: "toxic" });
  assert.equal(room.battle.turn, 1);
  assert.ok(room.commands["battle-1"].one);
  applyBattleAction(room, "two", { type: "move", moveId: "psychic" });
  assert.equal(room.battle.turn, 2);
  assert.equal(room.commands["battle-1"], undefined);
});

test("the same device cannot overwrite a submitted turn command", () => {
  const room = roomState();
  applyBattleAction(room, "one", { type: "move", moveId: "toxic" });
  assert.throws(() => applyBattleAction(room, "one", { type: "move", moveId: "muddy-water" }), /送信済み/);
});

function profileClient(initialProfile = null) {
  let stored = initialProfile;
  const client = new FirebaseBattleRoom({});
  client.user = { uid: "anonymous-device-uid" };
  client.playerName = "竹重 颯真";
  client.playerKey = playerKeyFromName(client.playerName);
  client.database = {};
  client.dbApi = {
    ref: (_database, path) => path,
    serverTimestamp: () => 1_725_000_000_000,
    set: async (path, value) => {
      assert.equal(path, `playerProfiles/${client.playerKey}`);
      stored = structuredClone(value);
    },
    get: async (path) => {
      assert.equal(path, `playerProfiles/${client.playerKey}`);
      return {
        exists: () => stored !== null,
        val: () => structuredClone(stored),
      };
    },
  };
  return { client, stored: () => stored };
}

test("a valid party is saved under the normalized player-name key", async () => {
  const party = engine.createDefaultParty();
  const fake = profileClient();
  const profile = await fake.client.savePlayerParty(party);
  assert.equal(profile.playerName, "竹重 颯真");
  assert.equal(profile.playerKey, playerKeyFromName("竹重 颯真"));
  assert.equal(profile.updatedByUid, "anonymous-device-uid");
  assert.deepEqual(profile.party, party);
  party[0].natureId = "adamant";
  assert.notEqual(fake.stored().party[0].natureId, "adamant");
});

test("a second device can load a profile by using the same player name", async () => {
  const party = engine.createDefaultParty();
  party[0].natureId = "adamant";
  const first = profileClient();
  await first.client.savePlayerParty(party);
  const second = profileClient(first.stored());
  second.client.user = { uid: "another-anonymous-device" };
  const loaded = await second.client.loadPlayerParty();
  assert.equal(loaded.party[0].natureId, "adamant");
});

test("missing or invalid cloud profiles are handled safely", async () => {
  const missing = profileClient();
  assert.equal(await missing.client.loadPlayerParty(), null);
  const invalid = profileClient({
    schemaVersion: 1,
    playerKey: playerKeyFromName("竹重 颯真"),
    playerName: "竹重 颯真",
    party: [],
  });
  await assert.rejects(() => invalid.client.loadPlayerParty(), /壊れています/);
});
