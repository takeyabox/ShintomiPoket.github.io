/** Firebase Realtime Database transport for deterministic two-device battles. */
(function initialiseFirebaseSync(global) {
  "use strict";

  const FIREBASE_VERSION = "10.14.1";
  const SDK_BASE = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;

  function playerKeyFromName(name) {
    const bytes = new TextEncoder().encode(name.normalize("NFKC").trim());
    let binary = "";
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    return `p_${btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "")}`;
  }

  function validConfig(config) {
    return Boolean(config?.apiKey && config?.projectId && config?.databaseURL && config?.appId);
  }

  function applyBattleAction(room, playerKey, action) {
    if (room.phase !== "battle" || !room.battle) throw new Error("対戦は開始されていません。");
    if (!room.players?.[playerKey]) throw new Error("部屋の参加者ではありません。");
    const battle = room.battle;
    const commandKey = `${battle.phase}-${battle.turn}`;
    room.commands ||= {};
    room.commands[commandKey] ||= {};
    if (room.commands[commandKey][playerKey]) throw new Error("このターンの入力は送信済みです。");
    room.commands[commandKey][playerKey] = action;
    const requiredIds = battle.phase === "forcedSwitch"
      ? battle.requiredSwitches.map((index) => battle.players[index].id)
      : battle.players.map((player) => player.id);
    if (requiredIds.every((id) => room.commands[commandKey][id])) {
      battle.players.forEach((player) => {
        if (!requiredIds.includes(player.id)) room.commands[commandKey][player.id] = { type: "wait" };
      });
      room.battle = global.BattleEngine.resolveTurn(battle, room.commands[commandKey]);
      delete room.commands[commandKey];
      if (room.battle.phase === "ended") room.phase = "result";
    }
    return room;
  }

  class FirebaseBattleRoom {
    constructor(config) {
      this.config = config;
      this.app = null;
      this.auth = null;
      this.database = null;
      this.dbApi = null;
      this.authApi = null;
      this.user = null;
      this.playerName = null;
      this.playerKey = null;
      this.roomNumber = null;
      this.roomRef = null;
      this.unsubscribe = null;
    }

    static isConfigured(config) {
      return validConfig(config);
    }

    async connect(playerName) {
      if (!validConfig(this.config)) throw new Error("Firebase設定が入力されていません。");
      const [appApi, authApi, dbApi] = await Promise.all([
        import(`${SDK_BASE}/firebase-app.js`),
        import(`${SDK_BASE}/firebase-auth.js`),
        import(`${SDK_BASE}/firebase-database.js`),
      ]);
      this.authApi = authApi;
      this.dbApi = dbApi;
      const appName = `shintomi-${this.config.projectId}`;
      this.app = appApi.getApps().find((app) => app.name === appName) || appApi.initializeApp(this.config, appName);
      this.auth = authApi.getAuth(this.app);
      this.database = dbApi.getDatabase(this.app);
      const credentials = await authApi.signInAnonymously(this.auth);
      this.user = credentials.user;
      this.playerName = playerName.normalize("NFKC").trim();
      this.playerKey = playerKeyFromName(this.playerName);
      return { uid: this.user.uid, playerKey: this.playerKey, playerName: this.playerName };
    }

    profileReference() {
      if (!this.user || !this.playerKey) throw new Error("先にログインしてください。");
      return this.dbApi.ref(this.database, `playerProfiles/${this.playerKey}`);
    }

    async savePlayerParty(party) {
      const errors = global.BattleEngine.validateParty(party);
      if (errors.length) throw new Error(errors.slice(0, 3).join(" "));
      const profileRef = this.profileReference();
      await this.dbApi.set(profileRef, {
        schemaVersion: 1,
        playerKey: this.playerKey,
        playerName: this.playerName,
        party: global.BattleEngine.clone(party),
        updatedAt: this.dbApi.serverTimestamp(),
        updatedByUid: this.user.uid,
      });
      return this.loadPlayerParty();
    }

    async loadPlayerParty() {
      const snapshot = await this.dbApi.get(this.profileReference());
      if (!snapshot.exists()) return null;
      const profile = snapshot.val();
      if (profile?.schemaVersion !== 1 || profile?.playerKey !== this.playerKey) {
        throw new Error("Firebaseの編成データの形式が対応していません。");
      }
      const errors = global.BattleEngine.validateParty(profile.party);
      if (errors.length) throw new Error(`Firebaseの編成データが壊れています。${errors[0]}`);
      return { ...profile, party: global.BattleEngine.clone(profile.party) };
    }

    async join(roomNumber, party) {
      const room = Number(roomNumber);
      if (!Number.isInteger(room) || room < 1 || room > 5) throw new Error("部屋番号は1〜5です。");
      if (!this.user) throw new Error("先にログインしてください。");
      this.roomNumber = room;
      this.roomRef = this.dbApi.ref(this.database, `rooms/${room}`);
      let rejection = null;
      const result = await this.dbApi.runTransaction(this.roomRef, (current) => {
        const now = Date.now();
        const next = current || {
          version: 1,
          roomNumber: room,
          phase: "waiting",
          createdAt: now,
          seed: global.BattleEngine.hashString(`${room}:${now}:${this.playerKey}`),
          revision: 0,
          players: {},
          members: {},
          commands: {},
        };
        next.players ||= {};
        next.members ||= {};
        const existingKeys = Object.keys(next.players);
        if (!next.players[this.playerKey] && existingKeys.length >= 2) {
          rejection = "この部屋にはすでに2人います。";
          return;
        }
        next.players[this.playerKey] = {
          id: this.playerKey,
          loginId: this.playerName,
          name: this.playerName,
          ownerUid: this.user.uid,
          online: true,
          joinedAt: next.players[this.playerKey]?.joinedAt || now,
          lastSeenAt: now,
          party,
          publicTeam: global.BattleEngine.publicTeam(party),
          selection: next.players[this.playerKey]?.selection || null,
          rematch: false,
        };
        next.members[this.user.uid] = true;
        const keys = Object.keys(next.players);
        next.hostId = keys.sort((a, b) => next.players[a].joinedAt - next.players[b].joinedAt || a.localeCompare(b))[0];
        if (keys.length === 2 && next.phase === "waiting") next.phase = "teamPreview";
        next.revision = (next.revision || 0) + 1;
        return next;
      }, { applyLocally: false });
      if (!result.committed) throw new Error(rejection || "部屋に入れませんでした。");
      const onlineRef = this.dbApi.ref(this.database, `rooms/${room}/players/${this.playerKey}/online`);
      await this.dbApi.onDisconnect(onlineRef).set(false);
      return result.snapshot.val();
    }

    subscribe(onState, onError) {
      if (!this.roomRef) throw new Error("部屋に入っていません。");
      if (this.unsubscribe) this.unsubscribe();
      this.unsubscribe = this.dbApi.onValue(this.roomRef, (snapshot) => onState(snapshot.val()), onError);
      return this.unsubscribe;
    }

    async updateParty(party) {
      return this.transact((room) => {
        const player = room.players?.[this.playerKey];
        if (!player || room.phase === "battle") throw new Error("現在はパーティーを変更できません。");
        player.party = party;
        player.publicTeam = global.BattleEngine.publicTeam(party);
        player.selection = null;
        return room;
      });
    }

    async submitSelection(selection) {
      if (!Array.isArray(selection) || selection.length !== 3 || new Set(selection).size !== 3) {
        throw new Error("重複しない3体を順番に選んでください。");
      }
      return this.transact((room) => {
        if (room.phase !== "teamPreview") throw new Error("現在は選出できません。");
        const player = room.players?.[this.playerKey];
        if (!player) throw new Error("部屋の参加者ではありません。");
        if (selection.some((index) => !player.party?.[index])) throw new Error("選出データが不正です。");
        player.selection = selection;
        const playerEntries = Object.entries(room.players);
        if (playerEntries.length === 2 && playerEntries.every(([, entry]) => entry.selection?.length === 3)) {
          room.battle = global.BattleEngine.createBattle({
            players: playerEntries.map(([id, entry]) => ({
              id,
              name: entry.name,
              team: entry.selection.map((index) => entry.party[index]),
            })),
            seed: room.seed,
          });
          room.phase = "battle";
          room.commands = {};
        }
        return room;
      });
    }

    async submitAction(action) {
      return this.transact((room) => applyBattleAction(room, this.playerKey, action));
    }

    async requestRematch() {
      return this.transact((room) => {
        const player = room.players?.[this.playerKey];
        if (!player) throw new Error("部屋の参加者ではありません。");
        player.rematch = true;
        const entries = Object.values(room.players);
        if (entries.length === 2 && entries.every((entry) => entry.rematch)) {
          for (const entry of entries) {
            entry.rematch = false;
            entry.selection = null;
          }
          room.battle = null;
          room.commands = {};
          room.seed = global.BattleEngine.hashString(`${room.seed}:${Date.now()}`);
          room.phase = "teamPreview";
        }
        return room;
      });
    }

    async transact(mutator) {
      if (!this.roomRef) throw new Error("部屋に入っていません。");
      const result = await this.dbApi.runTransaction(this.roomRef, (current) => {
        if (!current) return;
        const next = mutator(current);
        if (!next) return;
        next.revision = (next.revision || 0) + 1;
        if (next.players?.[this.playerKey]) {
          next.players[this.playerKey].online = true;
          next.players[this.playerKey].lastSeenAt = Date.now();
        }
        return next;
      }, { applyLocally: false });
      if (!result.committed) throw new Error("同期更新が競合しました。もう一度お試しください。");
      return result.snapshot.val();
    }

    async leave() {
      if (!this.roomRef) return;
      if (this.unsubscribe) this.unsubscribe();
      this.unsubscribe = null;
      try {
        await this.dbApi.runTransaction(this.roomRef, (room) => {
          if (!room?.players?.[this.playerKey]) return room;
          const ownerUid = room.players[this.playerKey].ownerUid;
          delete room.players[this.playerKey];
          if (room.members && ownerUid) delete room.members[ownerUid];
          const keys = Object.keys(room.players);
          if (!keys.length) return null;
          room.hostId = keys[0];
          room.phase = "waiting";
          room.battle = null;
          room.commands = {};
          for (const player of Object.values(room.players)) {
            player.selection = null;
            player.rematch = false;
          }
          room.revision = (room.revision || 0) + 1;
          return room;
        }, { applyLocally: false });
      } finally {
        this.roomRef = null;
        this.roomNumber = null;
      }
    }
  }

  global.FirebaseBattleRoom = FirebaseBattleRoom;
  global.firebasePlayerKey = playerKeyFromName;
  global.FirebaseRoomProtocol = Object.freeze({ playerKeyFromName, applyBattleAction });
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { FirebaseBattleRoom, playerKeyFromName, applyBattleAction };
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
