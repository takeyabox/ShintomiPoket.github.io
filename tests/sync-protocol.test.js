const test = require("node:test");
const assert = require("node:assert/strict");

require("../data.js");
const engine = require("../battle-engine.js");
const {
  FirebaseBattleRoom,
  applyBattleAction,
  applyTeamSelection,
  configFingerprint,
  normaliseRoomState,
  playerKeyFromName,
  removePlayerFromRoom,
  validConfig,
} = require("../firebase-sync.js");

function firebaseRoundTrip(value) {
  function prune(current) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      const result = current.map((entry) => prune(entry));
      return result.some((entry) => entry !== undefined)
        ? result.map((entry) => entry === undefined ? null : entry)
        : undefined;
    }
    if (typeof current !== "object") return current;
    const entries = Object.entries(current)
      .map(([key, entry]) => [key, prune(entry)])
      .filter(([, entry]) => entry !== undefined);
    return entries.length ? Object.fromEntries(entries) : undefined;
  }
  return structuredClone(prune(value));
}

function previewRoomState() {
  const party = engine.createDefaultParty();
  return {
    version: 1,
    roomNumber: 1,
    phase: "teamPreview",
    seed: 808,
    revision: 1,
    commands: {},
    members: { uidOne: true, uidTwo: true },
    players: {
      one: { id: "one", name: "ONE", ownerUid: "uidOne", joinedAt: 1, party, publicTeam: engine.publicTeam(party) },
      two: { id: "two", name: "TWO", ownerUid: "uidTwo", joinedAt: 2, party: engine.clone(party), publicTeam: engine.publicTeam(party) },
    },
  };
}

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

test("Firebase config requires all web authentication fields", () => {
  const complete = {
    apiKey: "key",
    authDomain: "example.firebaseapp.com",
    databaseURL: "https://example.firebasedatabase.app",
    projectId: "example",
    appId: "app",
  };
  assert.equal(validConfig(complete), true);
  assert.equal(validConfig({ ...complete, authDomain: "" }), false);
});

test("corrected Firebase config receives a different app fingerprint", () => {
  const first = { apiKey: "wrong", authDomain: "example.firebaseapp.com", databaseURL: "db", projectId: "example", appId: "app" };
  const corrected = { ...first, apiKey: "correct" };
  assert.equal(configFingerprint(first), configFingerprint({ ...first }));
  assert.notEqual(configFingerprint(first), configFingerprint(corrected));
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

test("two Firebase-shaped selections start a battle and restore stripped engine fields", () => {
  const room = previewRoomState();
  applyTeamSelection(room, "one", [0, 2, 4]);
  const afterFirstDevice = firebaseRoundTrip(room);
  // RTDB may expose indexed values as a numeric-key object rather than Array.
  afterFirstDevice.players.one.selection = { 0: 0, 1: 2, 2: 4 };
  const secondDevice = normaliseRoomState(afterFirstDevice);
  applyTeamSelection(secondDevice, "two", { 0: 1, 1: 3, 2: 5 });
  assert.equal(secondDevice.phase, "battle");
  assert.equal(secondDevice.battle.players[0].team.length, 3);
  assert.equal(secondDevice.battle.players[1].team.length, 3);

  const storedBattle = firebaseRoundTrip(secondDevice);
  assert.equal(storedBattle.battle.players[0].team[0].volatile, undefined);
  assert.equal(storedBattle.battle.requiredSwitches, undefined);
  const restored = normaliseRoomState(storedBattle);
  assert.deepEqual(restored.battle.players[0].team[0].volatile, {});
  assert.deepEqual(restored.battle.requiredSwitches, []);
  assert.doesNotThrow(() => engine.legalActions(restored.battle, "one"));
  const firstMove = engine.legalActions(restored.battle, "one").moves.find((move) => !move.disabled).id;
  const secondMove = engine.legalActions(restored.battle, "two").moves.find((move) => !move.disabled).id;
  applyBattleAction(restored, "one", { type: "move", moveId: firstMove });
  applyBattleAction(restored, "two", { type: "move", moveId: secondMove });
  assert.equal(restored.battle.turn, 2);
});

test("declining reconnection removes the player and resets the opponent room", () => {
  const room = previewRoomState();
  applyTeamSelection(room, "one", [0, 1, 2]);
  applyTeamSelection(room, "two", [3, 4, 5]);
  const remaining = removePlayerFromRoom(room, "one");
  assert.equal(remaining.phase, "waiting");
  assert.equal(remaining.battle, undefined);
  assert.deepEqual(Object.keys(remaining.players), ["two"]);
  assert.deepEqual(Object.keys(remaining.members), ["uidTwo"]);
  assert.equal(remaining.players.two.selection, undefined);
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

test("legacy cloud parties are migrated when loaded", async () => {
  const party = engine.createDefaultParty();
  party.forEach((build) => {
    delete build.effortPoints;
    build.evs = { hp: 252, attack: 0, defense: 0, specialAttack: 0, specialDefense: 0, speed: 0 };
  });
  const key = playerKeyFromName("竹重 颯真");
  const legacy = profileClient({ schemaVersion: 1, playerKey: key, playerName: "竹重 颯真", party });
  const loaded = await legacy.client.loadPlayerParty();
  assert.equal(loaded.schemaVersion, 2);
  assert.equal(loaded.party[0].effortPoints.hp, 32);
  assert.equal("evs" in loaded.party[0], false);
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
