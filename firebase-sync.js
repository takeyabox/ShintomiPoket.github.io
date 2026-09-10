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
    return Boolean(config?.apiKey && config?.authDomain && config?.projectId && config?.databaseURL && config?.appId);
  }

  function configFingerprint(config) {
    const source = ["apiKey", "authDomain", "databaseURL", "projectId", "appId"]
      .map((key) => String(config?.[key] || "").trim())
      .join("|");
    let hash = 2166136261;
    for (let index = 0; index < source.length; index += 1) {
      hash ^= source.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  /**
   * Realtime Database removes null values and empty arrays/objects. It can also
   * return array-like values as objects with numeric keys. Restore the stable
   * shape expected by the deterministic battle engine at the transport edge.
   */
  function indexedValues(value) {
    if (Array.isArray(value)) return value.filter((entry) => entry !== null && entry !== undefined);
    if (!value || typeof value !== "object") return [];
    return Object.keys(value)
      .filter((key) => /^\d+$/.test(key))
      .sort((left, right) => Number(left) - Number(right))
      .map((key) => value[key])
      .filter((entry) => entry !== null && entry !== undefined);
  }

  function normaliseSelection(value) {
    return indexedValues(value)
      .map((index) => Number(index))
      .filter((index) => Number.isInteger(index));
  }

  function normaliseBattleState(battle) {
    if (!battle || typeof battle !== "object") return battle;
    const next = global.BattleEngine.clone(battle);
    next.players = indexedValues(next.players);
    next.requiredSwitches = normaliseSelection(next.requiredSwitches);
    next.log = indexedValues(next.log);
    next.field = {
      weather: null,
      weatherTurns: 0,
      terrain: null,
      terrainTurns: 0,
      trickRoomTurns: 0,
      ...(next.field || {}),
    };
    for (const player of next.players) {
      player.team = indexedValues(player.team);
      player.side = {
        stealthRock: false,
        toxicSpikes: 0,
        stickyWeb: false,
        lightScreenTurns: 0,
        reflectTurns: 0,
        auroraVeilTurns: 0,
        tailwindTurns: 0,
        ...(player.side || {}),
      };
      for (const pokemon of player.team) {
        pokemon.typeIds = indexedValues(pokemon.typeIds);
        pokemon.moves = indexedValues(pokemon.moves);
        pokemon.stages = {
          attack: 0,
          defense: 0,
          specialAttack: 0,
          specialDefense: 0,
          speed: 0,
          accuracy: 0,
          evasion: 0,
          ...(pokemon.stages || {}),
        };
        pokemon.volatile = { ...(pokemon.volatile || {}) };
      }
    }
    return next;
  }

  function normaliseRoomState(room) {
    if (!room || typeof room !== "object") return room;
    const next = global.BattleEngine.clone(room);
    next.players = next.players && typeof next.players === "object" ? next.players : {};
    next.members = next.members && typeof next.members === "object" ? next.members : {};
    next.commands = next.commands && typeof next.commands === "object" ? next.commands : {};
    for (const player of Object.values(next.players)) {
      player.party = indexedValues(player.party);
      player.publicTeam = indexedValues(player.publicTeam);
      if (player.selection !== undefined && player.selection !== null) {
        const selection = normaliseSelection(player.selection);
        if (selection.length) player.selection = selection;
        else delete player.selection;
      }
    }
    if (next.battle) next.battle = normaliseBattleState(next.battle);
    return next;
  }

  function cleanRoomMembers(room) {
    room.members ||= {};
    const ownerUids = new Set(Object.values(room.players || {}).map((player) => player.ownerUid).filter(Boolean));
    for (const uid of Object.keys(room.members)) {
      if (!ownerUids.has(uid)) delete room.members[uid];
    }
  }

  function removePlayerFromRoom(room, playerKey) {
    if (!room?.players?.[playerKey]) return room;
    delete room.players[playerKey];
    cleanRoomMembers(room);
    const keys = Object.keys(room.players);
    if (!keys.length) return null;
    room.hostId = keys.sort((left, right) => room.players[left].joinedAt - room.players[right].joinedAt || left.localeCompare(right))[0];
    room.phase = "waiting";
    delete room.battle;
    room.commands = {};
    for (const player of Object.values(room.players)) {
      delete player.selection;
      player.rematch = false;
    }
    room.revision = (room.revision || 0) + 1;
    return room;
  }

  function applyTeamSelection(room, playerKey, selection) {
    if (room.phase !== "teamPreview") throw new Error("現在は選出できません。");
    const selected = normaliseSelection(selection);
    if (selected.length !== 3 || new Set(selected).size !== 3) {
      throw new Error("重複しない3体を順番に選んでください。");
    }
    const player = room.players?.[playerKey];
    if (!player) throw new Error("部屋の参加者ではありません。");
    const party = indexedValues(player.party);
    if (selected.some((index) => index < 0 || !party[index])) throw new Error("選出データが不正です。");
    player.party = party;
    player.selection = selected;

    const playerEntries = Object.entries(room.players || {});
    const ready = playerEntries.length === 2 && playerEntries.every(([, entry]) => {
      const entryParty = indexedValues(entry.party);
      const entrySelection = normaliseSelection(entry.selection);
      return entrySelection.length === 3
        && new Set(entrySelection).size === 3
        && entrySelection.every((index) => index >= 0 && Boolean(entryParty[index]));
    });
    if (!ready) return room;

    room.battle = global.BattleEngine.createBattle({
      players: playerEntries.map(([id, entry]) => {
        const entryParty = indexedValues(entry.party);
        const entrySelection = normaliseSelection(entry.selection);
        entry.party = entryParty;
        entry.selection = entrySelection;
        return {
          id,
          name: entry.name,
          team: entrySelection.map((index) => entryParty[index]),
        };
      }),
      seed: room.seed,
    });
    room.phase = "battle";
    room.commands = {};
    return room;
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
      this.disconnectRegistration = null;
      this.unsubscribeConnection = null;
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
      // Firebase apps keep their initial options for their lifetime. Including
      // every option in the name prevents a failed config attempt from being
      // silently reused after the player corrects the form.
      const appName = `shintomi-${this.config.projectId}-${configFingerprint(this.config)}`;
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
      const migratedParty = global.BattleEngine.migrateParty(party);
      const errors = global.BattleEngine.validateParty(migratedParty);
      if (errors.length) throw new Error(errors.slice(0, 3).join(" "));
      const profileRef = this.profileReference();
      await this.dbApi.set(profileRef, {
        schemaVersion: 2,
        playerKey: this.playerKey,
        playerName: this.playerName,
        party: global.BattleEngine.clone(migratedParty),
        updatedAt: this.dbApi.serverTimestamp(),
        updatedByUid: this.user.uid,
      });
      return this.loadPlayerParty();
    }

    async loadPlayerParty() {
      const snapshot = await this.dbApi.get(this.profileReference());
      if (!snapshot.exists()) return null;
      const profile = snapshot.val();
      if (![1, 2].includes(profile?.schemaVersion) || profile?.playerKey !== this.playerKey) {
        throw new Error("Firebaseの編成データの形式が対応していません。");
      }
      const migratedParty = global.BattleEngine.migrateParty(profile.party);
      const errors = global.BattleEngine.validateParty(migratedParty);
      if (errors.length) throw new Error(`Firebaseの編成データが壊れています。${errors[0]}`);
      return { ...profile, schemaVersion: 2, party: global.BattleEngine.clone(migratedParty) };
    }

    async join(roomNumber, party) {
      const room = Number(roomNumber);
      if (!Number.isInteger(room) || room < 1 || room > 5) throw new Error("部屋番号は1〜5です。");
      if (!this.user) throw new Error("先にログインしてください。");
      this.roomNumber = room;
      this.roomRef = this.dbApi.ref(this.database, `rooms/${room}`);
      let rejection = null;
      const joinedParty = global.BattleEngine.migrateParty(party);
      const partyErrors = global.BattleEngine.validateParty(joinedParty);
      if (partyErrors.length) throw new Error(partyErrors.slice(0, 3).join(" "));
      const result = await this.dbApi.runTransaction(this.roomRef, (current) => {
        const now = Date.now();
        const next = normaliseRoomState(current) || {
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
        for (const [key, existingPlayer] of Object.entries(next.players)) {
          if (!existingPlayer?.id || indexedValues(existingPlayer.party).length !== 6) {
            delete next.players[key];
          }
        }
        cleanRoomMembers(next);
        const existingKeys = Object.keys(next.players);
        if (!next.players[this.playerKey] && existingKeys.length >= 2) {
          rejection = "この部屋にはすでに2人います。";
          return;
        }
        const existingPlayer = next.players[this.playerKey];
        if (existingPlayer?.ownerUid && existingPlayer.ownerUid !== this.user.uid) {
          delete next.members[existingPlayer.ownerUid];
        }
        next.players[this.playerKey] = {
          id: this.playerKey,
          loginId: this.playerName,
          name: this.playerName,
          ownerUid: this.user.uid,
          online: true,
          joinedAt: existingPlayer?.joinedAt || now,
          lastSeenAt: now,
          party: joinedParty,
          publicTeam: global.BattleEngine.publicTeam(joinedParty),
          selection: existingPlayer?.selection || null,
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
      if (this.disconnectRegistration) {
        try { await this.disconnectRegistration.cancel(); } catch { /* The previous connection may already be gone. */ }
      }
      this.disconnectRegistration = this.dbApi.onDisconnect(onlineRef);
      await this.disconnectRegistration.set(false);
      return normaliseRoomState(result.snapshot.val());
    }

    subscribe(onState, onError) {
      if (!this.roomRef) throw new Error("部屋に入っていません。");
      if (this.unsubscribe) this.unsubscribe();
      this.unsubscribe = this.dbApi.onValue(this.roomRef, (snapshot) => {
        try {
          onState(normaliseRoomState(snapshot.val()));
        } catch (error) {
          if (onError) onError(error);
          else throw error;
        }
      }, onError);
      return this.unsubscribe;
    }

    pauseSubscription() {
      if (this.unsubscribe) this.unsubscribe();
      this.unsubscribe = null;
    }

    monitorConnection(onState, onError) {
      if (!this.database) throw new Error("先にログインしてください。");
      if (this.unsubscribeConnection) this.unsubscribeConnection();
      const connectionRef = this.dbApi.ref(this.database, ".info/connected");
      this.unsubscribeConnection = this.dbApi.onValue(connectionRef, (snapshot) => onState(snapshot.val() === true), onError);
      return this.unsubscribeConnection;
    }

    async inspectRoom(roomNumber) {
      const room = Number(roomNumber);
      if (!this.user) throw new Error("先にログインしてください。");
      if (!Number.isInteger(room) || room < 1 || room > 5) throw new Error("部屋番号は1〜5です。");
      const snapshot = await this.dbApi.get(this.dbApi.ref(this.database, `rooms/${room}`));
      return snapshot.exists() ? normaliseRoomState(snapshot.val()) : null;
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
      const selected = normaliseSelection(selection);
      if (selected.length !== 3 || new Set(selected).size !== 3) {
        throw new Error("重複しない3体を順番に選んでください。");
      }
      return this.transact((room) => applyTeamSelection(room, this.playerKey, selected));
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
        const next = mutator(normaliseRoomState(current));
        if (!next) return;
        next.revision = (next.revision || 0) + 1;
        if (next.players?.[this.playerKey]) {
          next.players[this.playerKey].online = true;
          next.players[this.playerKey].lastSeenAt = Date.now();
        }
        return next;
      }, { applyLocally: false });
      if (!result.committed) throw new Error("同期更新が競合しました。もう一度お試しください。");
      return normaliseRoomState(result.snapshot.val());
    }

    async abandonRoom(roomNumber, party = null) {
      const room = Number(roomNumber);
      if (!this.user) throw new Error("先にログインしてください。");
      if (!Number.isInteger(room) || room < 1 || room > 5) throw new Error("部屋番号は1〜5です。");
      if (this.roomNumber === room) this.pauseSubscription();
      if (this.disconnectRegistration) {
        try { await this.disconnectRegistration.cancel(); } catch { /* Retry is handled by the transaction. */ }
        this.disconnectRegistration = null;
      }
      const targetRef = this.dbApi.ref(this.database, `rooms/${room}`);
      try {
        await this.dbApi.runTransaction(targetRef, (current) => {
          if (!current) return current;
          return removePlayerFromRoom(normaliseRoomState(current), this.playerKey);
        }, { applyLocally: false });
      } catch (error) {
        const permissionDenied = /permission[_-]denied/i.test(error?.code || error?.message || "");
        if (!permissionDenied || !party) throw error;
        // Anonymous auth may have been recreated after browser storage was
        // cleared. Reclaim the same player-name slot, then remove it cleanly.
        await this.join(room, party);
        await this.leave();
        return;
      }
      if (this.roomNumber === room) {
        this.roomRef = null;
        this.roomNumber = null;
      }
    }

    async leave() {
      if (!this.roomRef) return;
      this.pauseSubscription();
      if (this.disconnectRegistration) {
        try { await this.disconnectRegistration.cancel(); } catch { /* The server transaction remains authoritative. */ }
        this.disconnectRegistration = null;
      }
      try {
        await this.dbApi.runTransaction(this.roomRef, (room) => {
          if (!room) return room;
          return removePlayerFromRoom(normaliseRoomState(room), this.playerKey);
        }, { applyLocally: false });
      } finally {
        this.roomRef = null;
        this.roomNumber = null;
      }
    }
  }

  global.FirebaseBattleRoom = FirebaseBattleRoom;
  global.firebasePlayerKey = playerKeyFromName;
  global.FirebaseRoomProtocol = Object.freeze({
    playerKeyFromName,
    applyBattleAction,
    applyTeamSelection,
    normaliseRoomState,
    normaliseSelection,
    removePlayerFromRoom,
    validConfig,
    configFingerprint,
  });
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      FirebaseBattleRoom,
      playerKeyFromName,
      applyBattleAction,
      applyTeamSelection,
      normaliseRoomState,
      normaliseSelection,
      removePlayerFromRoom,
      validConfig,
      configFingerprint,
    };
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
