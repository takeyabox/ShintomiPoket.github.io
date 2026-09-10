(function initialiseApplication(global) {
  "use strict";

  const DATA = global.GAME_DATA;
  const ENGINE = global.BattleEngine;
  const STORAGE = {
    name: "shintomi-player-name",
    party: "shintomi-party-v1",
    firebase: "shintomi-firebase-config",
    room: "shintomi-active-room",
  };
  const STAT_LABELS = { hp: "HP", attack: "攻撃", defense: "防御", specialAttack: "特攻", specialDefense: "特防", speed: "素早" };
  const TYPE_COLORS = {
    normal: "#8f98a1", fire: "#df6a3a", water: "#4c8dc9", electric: "#d7ae31", grass: "#5e9d55", ice: "#68b8be",
    fighting: "#c4554d", poison: "#8e5eae", ground: "#b58a4d", flying: "#7898c5", psychic: "#d66182", bug: "#869a3b",
    rock: "#9d8958", ghost: "#665d91", dragon: "#5a69ad", dark: "#54545d", steel: "#728d9b", fairy: "#c477a4",
  };

  const state = {
    screen: "login",
    playerName: "",
    playerKey: null,
    party: loadParty(),
    client: null,
    room: null,
    roomNumber: null,
    roomSummaries: {},
    lobbySubscribed: false,
    localMode: false,
    selection: [],
    actionPending: false,
    commandTab: "moves",
    pendingSwitchMoveId: null,
    toastTimer: null,
    cloudBusy: false,
    cloudDirty: false,
    pendingReconnect: null,
    connectionOnline: false,
    connectionSeenOnline: false,
    roomDisconnected: false,
  };

  const elements = Object.fromEntries([
    "loginScreen", "teamScreen", "roomsScreen", "previewScreen", "battleScreen", "resultScreen",
    "loginForm", "playerName", "firebaseSettings", "firebaseConfigReset", "loginMessage", "localDemoButton", "connectionPill", "connectionText",
    "cloudControls", "cloudSaveState", "cloudLoadButton", "cloudSaveButton",
    "partyGrid", "partyMessage", "toRoomsButton", "resetPartyButton", "backToTeamButton", "roomGrid", "roomMessage",
    "waitingCard", "waitingRoomNumber", "leaveWaitingButton", "myPreviewTeam", "opponentPreviewTeam", "selectionCount",
    "clearSelectionButton", "submitSelectionButton", "previewMessage", "opponentName", "myName", "opponentOrbs", "playerOrbs",
    "opponentStatus", "playerStatus", "fieldEffects", "turnNumber", "battleSyncState", "commandPanel", "battleLog", "battleMessage",
    "leaveBattleButton", "resultEmblem", "resultTitle", "resultDescription", "rematchButton", "leaveResultButton", "resultMessage",
    "reconnectDialog", "reconnectTitle", "reconnectDescription", "reconnectOpponent", "reconnectButton", "discardReconnectButton", "reconnectMessage",
    "homeButton", "toast",
  ].map((id) => [id, document.getElementById(id)]));

  function safeJsonParse(value, fallback) {
    try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
  }

  function loadParty() {
    const saved = safeJsonParse(localStorage.getItem(STORAGE.party), null);
    const migrated = ENGINE.migrateParty(saved);
    if (!migrated || ENGINE.validateParty(migrated).length) return ENGINE.createDefaultParty();
    return migrated;
  }

  function saveParty() {
    localStorage.setItem(STORAGE.party, JSON.stringify(state.party));
  }

  function showScreen(name) {
    state.screen = name;
    document.querySelectorAll(".screen").forEach((screen) => screen.classList.toggle("is-active", screen.id === `${name}Screen`));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function setConnection(label, mode = "offline") {
    elements.connectionText.textContent = label;
    elements.connectionPill.dataset.state = mode;
  }

  function showCloudControls(visible) {
    elements.cloudControls.hidden = !visible;
  }

  function setCloudStatus(label, mode = "idle") {
    elements.cloudSaveState.textContent = label;
    elements.cloudControls.dataset.state = mode;
  }

  function setCloudBusy(busy, label = "通信中…") {
    state.cloudBusy = busy;
    elements.cloudLoadButton.disabled = busy;
    elements.cloudSaveButton.disabled = busy;
    if (busy) setCloudStatus(label, "busy");
  }

  function formatCloudTime(timestamp) {
    if (!Number.isFinite(Number(timestamp))) return "保存済み";
    return new Intl.DateTimeFormat("ja-JP", {
      month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
    }).format(new Date(Number(timestamp)));
  }

  function markPartyDirty() {
    state.cloudDirty = true;
    if (state.client && !state.localMode) setCloudStatus("未保存の変更", "dirty");
  }

  async function savePartyToFirebase({ notify = true } = {}) {
    if (!state.client || state.localMode) throw new Error("オンラインログインが必要です。");
    const errors = ENGINE.validateParty(state.party);
    if (errors.length) {
      const error = new Error(errors.slice(0, 3).join(" "));
      setCloudStatus("編成エラー", "error");
      if (notify) toast(error.message);
      throw error;
    }
    setCloudBusy(true, "保存中…");
    try {
      const profile = await state.client.savePlayerParty(state.party);
      state.cloudDirty = false;
      setCloudStatus(`${formatCloudTime(profile.updatedAt)} 保存`, "saved");
      if (notify) toast(`${state.playerName} の編成をFirebaseへ保存しました`);
      return profile;
    } catch (error) {
      setCloudStatus("保存エラー", "error");
      if (notify) toast(firebaseFriendlyError(error));
      throw error;
    } finally {
      setCloudBusy(false);
    }
  }

  async function loadPartyFromFirebase({ automatic = false } = {}) {
    if (!state.client || state.localMode) throw new Error("オンラインログインが必要です。");
    if (!automatic && state.cloudDirty && !window.confirm("この端末の未保存の変更を破棄して、Firebaseの編成をロードしますか？")) return null;
    setCloudBusy(true, "読込中…");
    try {
      const profile = await state.client.loadPlayerParty();
      if (!profile) {
        state.cloudDirty = true;
        setCloudStatus("保存データなし", "dirty");
        if (!automatic) toast(`「${state.playerName}」の保存編成はまだありません`);
        return null;
      }
      state.party = profile.party;
      saveParty();
      state.cloudDirty = false;
      setCloudStatus(`${formatCloudTime(profile.updatedAt)} 保存`, "saved");
      if (state.screen === "team") renderParty();

      let currentBattleUnchanged = false;
      if (state.room && state.room.phase === "battle") {
        currentBattleUnchanged = true;
      } else if (state.room) {
        try {
          await state.client.updateParty(state.party);
        } catch (error) {
          if (state.room?.phase === "battle") currentBattleUnchanged = true;
          else throw error;
        }
      }
      if (automatic) toast("Firebaseから編成を自動ロードしました");
      else if (currentBattleUnchanged) toast("編成をロードしました。対戦中のチームは変わりません");
      else toast("Firebaseから編成をロードしました");
      return profile;
    } catch (error) {
      setCloudStatus("読込エラー", "error");
      if (!automatic) toast(firebaseFriendlyError(error));
      throw error;
    } finally {
      setCloudBusy(false);
    }
  }

  function message(element, text = "", success = false) {
    element.textContent = text;
    element.classList.toggle("success", success);
  }

  function toast(text) {
    elements.toast.textContent = text;
    elements.toast.classList.add("show");
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => elements.toast.classList.remove("show"), 2400);
  }

  function roomPhaseLabel(room) {
    if (room?.phase === "battle") return `ターン ${room.battle?.turn || 1}・対戦中`;
    if (room?.phase === "result") return "対戦結果";
    if (room?.phase === "teamPreview") return "3体選出中";
    return "対戦相手を待機中";
  }

  function setReconnectButtonsEnabled(enabled) {
    elements.reconnectButton.disabled = !enabled;
    elements.discardReconnectButton.disabled = !enabled;
    if (!enabled) message(elements.reconnectMessage, "通信が戻ると選択できます。");
  }

  function showReconnectPrompt(roomNumber, room, reason = "saved") {
    const opponent = Object.values(room?.players || {}).find((player) => player.id !== state.playerKey);
    state.pendingReconnect = { roomNumber: Number(roomNumber), room, reason };
    elements.reconnectTitle.textContent = `ROOM ${roomNumber} に復帰しますか？`;
    elements.reconnectDescription.textContent = reason === "disconnect"
      ? "通信が切断されました。Firebaseに保存された対戦状態へ復帰するか、この部屋から退出するかを選んでください。"
      : reason === "unverified"
        ? "前回の部屋情報を確認できませんでした。再接続を試すか、この端末の復帰情報を破棄するかを選んでください。"
        : "前回の部屋がFirebaseに残っています。続きから復帰するか、この部屋から退出するかを選んでください。";
    elements.reconnectOpponent.textContent = `${roomPhaseLabel(room)}${opponent ? ` ／ 相手: ${opponent.name}` : ""}`;
    message(elements.reconnectMessage, "", true);
    setReconnectButtonsEnabled(state.connectionOnline && reason !== "unverified");
    if (!elements.reconnectDialog.open) {
      if (typeof elements.reconnectDialog.showModal === "function") elements.reconnectDialog.showModal();
      else elements.reconnectDialog.setAttribute("open", "");
    }
  }

  function closeReconnectPrompt() {
    if (!elements.reconnectDialog.open) return;
    if (typeof elements.reconnectDialog.close === "function") elements.reconnectDialog.close();
    else elements.reconnectDialog.removeAttribute("open");
  }

  function clearExpiredRoom(roomNumber) {
    state.pendingReconnect = null;
    state.roomDisconnected = false;
    state.room = null;
    state.roomNumber = null;
    state.selection = [];
    state.actionPending = false;
    state.pendingSwitchMoveId = null;
    localStorage.removeItem(STORAGE.room);
    closeReconnectPrompt();
    setConnection(`${state.playerName}・オンライン`, "online");
    renderParty();
    showScreen("team");
    toast(`ROOM ${roomNumber} は期限切れ、または接続者不在のため削除されました`);
  }

  async function verifyPendingReconnect() {
    const pending = state.pendingReconnect;
    if (!pending || !state.connectionOnline) return;
    setReconnectButtonsEnabled(false);
    message(elements.reconnectMessage, "部屋の接続状態を確認しています…", true);
    try {
      const savedRoom = await state.client.inspectRoom(pending.roomNumber);
      if (state.pendingReconnect !== pending) return;
      const stillParticipant = Boolean(savedRoom?.players?.[state.playerKey]);
      const hasOnlinePlayers = global.FirebaseRoomProtocol.roomHasOnlinePlayers(savedRoom);
      if (!savedRoom || !stillParticipant || !hasOnlinePlayers) {
        if (!savedRoom || !hasOnlinePlayers) {
          try { await state.client.deleteRoomIfEmpty(pending.roomNumber); } catch { /* Cloud cleanup remains authoritative. */ }
        }
        clearExpiredRoom(pending.roomNumber);
        return;
      }
      showReconnectPrompt(pending.roomNumber, savedRoom, pending.reason);
      setReconnectButtonsEnabled(true);
      message(elements.reconnectMessage, "相手の接続を確認しました。復帰するか退出するかを選んでください。", true);
    } catch (error) {
      setReconnectButtonsEnabled(false);
      message(elements.reconnectMessage, firebaseFriendlyError(error));
    }
  }

  function handleConnectionState(connected) {
    state.connectionOnline = connected;
    if (connected) {
      state.connectionSeenOnline = true;
      if (state.pendingReconnect) {
        void verifyPendingReconnect();
      }
      return;
    }
    if (state.pendingReconnect) {
      setReconnectButtonsEnabled(false);
      return;
    }
    if (!state.connectionSeenOnline || state.localMode || !state.roomNumber || !state.room) return;
    state.roomDisconnected = true;
    state.client?.pauseSubscription();
    setConnection(`ROOM ${state.roomNumber}・通信切断`, "error");
    showReconnectPrompt(state.roomNumber, state.room, "disconnect");
  }

  function startConnectionMonitor() {
    state.connectionOnline = false;
    state.connectionSeenOnline = false;
    state.client.monitorConnection(handleConnectionState, (error) => {
      setConnection("接続状態を確認できません", "error");
      toast(firebaseFriendlyError(error));
    });
  }

  async function reconnectToRoom() {
    if (!state.pendingReconnect || !state.connectionOnline) return;
    const pending = state.pendingReconnect;
    setReconnectButtonsEnabled(false);
    message(elements.reconnectMessage, "部屋へ復帰しています…", true);
    try {
      await joinRoom(pending.roomNumber);
      state.pendingReconnect = null;
      state.roomDisconnected = false;
      closeReconnectPrompt();
      toast(`ROOM ${pending.roomNumber} に復帰しました`);
    } catch (error) {
      setReconnectButtonsEnabled(state.connectionOnline);
      message(elements.reconnectMessage, firebaseFriendlyError(error));
    }
  }

  async function discardReconnect() {
    if (!state.pendingReconnect || !state.connectionOnline) return;
    const pending = state.pendingReconnect;
    setReconnectButtonsEnabled(false);
    message(elements.reconnectMessage, "部屋から退出しています…", true);
    try {
      await state.client.abandonRoom(pending.roomNumber, state.party);
      state.pendingReconnect = null;
      state.roomDisconnected = false;
      state.room = null;
      state.roomNumber = null;
      state.selection = [];
      state.actionPending = false;
      state.pendingSwitchMoveId = null;
      localStorage.removeItem(STORAGE.room);
      closeReconnectPrompt();
      setConnection(`${state.playerName}・オンライン`, "online");
      renderParty();
      showScreen("team");
      toast(`ROOM ${pending.roomNumber} から退出しました`);
    } catch (error) {
      setReconnectButtonsEnabled(state.connectionOnline);
      message(elements.reconnectMessage, firebaseFriendlyError(error));
    }
  }

  function option(value, label, selected = false) {
    return `<option value="${escapeHtml(value)}"${selected ? " selected" : ""}>${escapeHtml(label)}</option>`;
  }

  function currentFirebaseConfig() {
    const stored = safeJsonParse(localStorage.getItem(STORAGE.firebase), {});
    return global.resolveFirebaseConfig(global.FIREBASE_CONFIG, stored);
  }

  function populateLogin() {
    elements.playerName.value = localStorage.getItem(STORAGE.name) || "";
    const config = currentFirebaseConfig();
    for (const key of ["apiKey", "projectId", "databaseURL", "appId", "authDomain"]) {
      const input = elements.loginForm.elements.namedItem(key);
      if (input) input.value = config[key] || "";
    }
  }

  function readConfigForm() {
    return Object.fromEntries(["apiKey", "projectId", "databaseURL", "appId", "authDomain"].map((key) => [key, elements.loginForm.elements.namedItem(key).value.trim()]));
  }

  function resetFirebaseConfig() {
    localStorage.removeItem(STORAGE.firebase);
    populateLogin();
    message(elements.loginMessage, "公開サイトに設定済みのFirebase構成を読み込み直しました。", true);
  }

  async function onlineLogin(event) {
    event.preventDefault();
    const playerName = elements.playerName.value.normalize("NFKC").trim();
    if (!playerName) return message(elements.loginMessage, "プレイヤー名を入力してください。");
    const config = readConfigForm();
    if (!global.FirebaseBattleRoom.isConfigured(config)) {
      elements.firebaseSettings.open = true;
      return message(elements.loginMessage, "オンライン対戦にはFirebaseの5項目をすべて入力してください。");
    }
    message(elements.loginMessage, "Firebaseへ接続しています…", true);
    elements.loginForm.querySelector("button[type=submit]").disabled = true;
    try {
      state.client = new global.FirebaseBattleRoom(config);
      const session = await state.client.connect(playerName);
      state.playerName = session.playerName;
      state.playerKey = session.playerKey;
      state.localMode = false;
      localStorage.setItem(STORAGE.name, state.playerName);
      localStorage.setItem(STORAGE.firebase, JSON.stringify(config));
      setConnection(`${state.playerName}・オンライン`, "online");
      showCloudControls(true);
      startConnectionMonitor();
      let cloudLoadError = null;
      try {
        await loadPartyFromFirebase({ automatic: true });
      } catch (error) {
        cloudLoadError = firebaseFriendlyError(error);
      }
      const previousRoom = Number(localStorage.getItem(STORAGE.room));
      renderParty();
      showScreen("team");
      if (previousRoom >= 1 && previousRoom <= 5) {
        try {
          const savedRoom = await state.client.inspectRoom(previousRoom);
          if (!savedRoom?.players?.[state.playerKey]) {
            localStorage.removeItem(STORAGE.room);
          } else if (!global.FirebaseRoomProtocol.roomHasOnlinePlayers(savedRoom)) {
            try { await state.client.deleteRoomIfEmpty(previousRoom); } catch { /* Cloud cleanup remains authoritative. */ }
            clearExpiredRoom(previousRoom);
          } else {
            showReconnectPrompt(previousRoom, savedRoom);
          }
        } catch (error) {
          cloudLoadError ||= firebaseFriendlyError(error);
          showReconnectPrompt(previousRoom, null, "unverified");
          setReconnectButtonsEnabled(false);
          message(elements.reconnectMessage, "部屋の状態を確認できないため復帰できません。通信またはFirebase設定を確認してください。");
        }
      }
      if (cloudLoadError) toast(cloudLoadError);
    } catch (error) {
      state.client = null;
      showCloudControls(false);
      setConnection("接続エラー", "error");
      message(elements.loginMessage, firebaseFriendlyError(error));
    } finally {
      elements.loginForm.querySelector("button[type=submit]").disabled = false;
    }
  }

  function firebaseFriendlyError(error) {
    const text = error?.message || String(error);
    if (/auth\/configuration-not-found|CONFIGURATION_NOT_FOUND/i.test(text)) return "Firebase Authenticationが未設定です。Firebase ConsoleでAuthenticationの利用を開始し、匿名ログインを有効にしてください。";
    if (/auth\/invalid-api-key|API key not valid|API_KEY_INVALID/i.test(text)) return "FirebaseのAPI Keyがこのプロジェクトと一致していません。接続設定を確認してください。";
    if (/auth\/unauthorized-domain/i.test(text)) return `Firebase Authenticationの承認済みドメインに「${global.location?.hostname || "公開ドメイン"}」を追加してください。`;
    if (/network|fetch|import|Failed to load/i.test(text)) return "Firebaseへ接続できません。ネットワークと設定を確認してください。";
    if (/auth\/operation-not-allowed/i.test(text)) return "Firebase ConsoleのAuthentication > ログイン方法で匿名ログインを有効にしてください。";
    if (/permission_denied|permission-denied/i.test(text)) return "Realtime Databaseのルールを設定してください。";
    return text;
  }

  function startLocalMode() {
    const playerName = elements.playerName.value.normalize("NFKC").trim() || "PLAYER";
    state.playerName = playerName;
    state.playerKey = "local-player";
    state.localMode = true;
    state.client = null;
    state.cloudDirty = false;
    showCloudControls(false);
    localStorage.setItem(STORAGE.name, playerName);
    setConnection(`${playerName}・ローカル`, "waiting");
    renderParty();
    showScreen("team");
  }

  function statPreview(build) {
    const stats = ENGINE.calculateStats(build.speciesId, build);
    return Object.entries(stats).map(([key, value]) => `<span>${STAT_LABELS[key]} <b>${value}</b></span>`).join("");
  }

  function renderParty() {
    elements.partyGrid.innerHTML = state.party.map((build, index) => {
      const species = DATA.pokemon[build.speciesId];
      const moveIds = [...build.moveIds, null, null, null, null].slice(0, 4);
      const natureOptions = DATA.natureList.map((nature) => option(nature.id, nature.name, nature.id === build.natureId)).join("");
      const abilityOptions = species.abilities.map((name) => {
        const ability = DATA.abilitiesByName[name];
        return option(ability.id, name, ability.id === build.abilityId);
      }).join("");
      const itemOptions = option("", "持たせない", !build.itemId) + DATA.itemList.map((item) => option(item.id, item.name, item.id === build.itemId)).join("");
      const availableMoves = [...new Set(species.moveIds)];
      const moveSelectors = moveIds.map((selected, moveIndex) => `<label>技 ${moveIndex + 1}<select class="move-select" data-index="${index}" data-move-index="${moveIndex}">${option("", "なし", !selected)}${availableMoves.map((id) => {
        const move = DATA.moves[id];
        return option(id, `${move.name}｜${move.type} ${move.category}`, id === selected);
      }).join("")}</select></label>`).join("");
      const effortPoints = ENGINE.effortPointsForBuild(build);
      const evInputs = ENGINE.STAT_KEYS.map((stat) => `<label>${STAT_LABELS[stat]}<input class="ev-input" data-index="${index}" data-stat="${stat}" type="number" min="0" max="${DATA.battleRules.maxEffortPointsPerStat}" step="1" value="${Number(effortPoints[stat]) || 0}" inputmode="numeric"></label>`).join("");
      const totalEv = Object.values(effortPoints).reduce((sum, value) => sum + (Number(value) || 0), 0);
      return `<details class="party-card panel" data-index="${index}"${index === 0 ? " open" : ""}>
        <summary><span class="species-number">0${index + 1}</span><span class="species-icon" style="--type-color:${TYPE_COLORS[species.typeIds[0]]}">${escapeHtml(species.name.split(" ")[0].slice(0, 1))}</span><span class="species-title"><strong>${escapeHtml(species.name)}</strong><span class="type-tags">${species.types.map((type) => `<i class="type-tag">${type}</i>`).join("")}</span></span></summary>
        <div class="party-editor">
          <div class="editor-row"><label>性格<select class="nature-select" data-index="${index}">${natureOptions}</select></label><label>特性<select class="ability-select" data-index="${index}">${abilityOptions}</select></label><label>持ち物<select class="item-select" data-index="${index}">${itemOptions}</select></label></div>
          <div class="moves-editor"><strong>MOVES</strong>${moveSelectors}</div>
          <div class="ev-editor"><strong>EFFORT POINTS｜実数値</strong>${evInputs}</div>
          <div class="stat-preview" id="statPreview${index}">${statPreview(build)}<span class="ev-total">実数値 <b id="evTotal${index}">${totalEv}</b> / ${DATA.battleRules.maxTotalEffortPoints}</span></div>
        </div>
      </details>`;
    }).join("");
    message(elements.partyMessage, "");
  }

  function updatePartyFromControl(control) {
    const index = Number(control.dataset.index);
    const build = state.party[index];
    if (!build) return;
    if (control.classList.contains("nature-select")) build.natureId = control.value;
    if (control.classList.contains("ability-select")) build.abilityId = control.value;
    if (control.classList.contains("item-select")) build.itemId = control.value || null;
    let effortLimitReached = false;
    if (control.classList.contains("ev-input")) {
      build.effortPoints ||= ENGINE.effortPointsForBuild(build);
      const stat = control.dataset.stat;
      const requested = clampNumber(control.value, 0, DATA.battleRules.maxEffortPointsPerStat);
      const otherTotal = ENGINE.STAT_KEYS.reduce((sum, key) => sum + (key === stat ? 0 : Number(build.effortPoints[key]) || 0), 0);
      const available = Math.max(0, DATA.battleRules.maxTotalEffortPoints - otherTotal);
      build.effortPoints[stat] = Math.min(requested, available);
      control.value = build.effortPoints[stat];
      effortLimitReached = build.effortPoints[stat] !== requested;
    }
    if (control.classList.contains("move-select")) {
      const card = control.closest(".party-card");
      build.moveIds = [...card.querySelectorAll(".move-select")].map((select) => select.value).filter(Boolean);
    }
    const preview = document.getElementById(`statPreview${index}`);
    const totalEv = Object.values(ENGINE.effortPointsForBuild(build)).reduce((sum, value) => sum + Number(value || 0), 0);
    if (preview) preview.innerHTML = `${statPreview(build)}<span class="ev-total">実数値 <b id="evTotal${index}">${totalEv}</b> / ${DATA.battleRules.maxTotalEffortPoints}</span>`;
    message(elements.partyMessage, effortLimitReached ? `努力値実数は合計${DATA.battleRules.maxTotalEffortPoints}までです。残りポイントに合わせて調整しました。` : "");
    saveParty();
    markPartyDirty();
  }

  function clampNumber(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, Math.floor(Number(value) || 0)));
  }

  function resetParty() {
    if (!window.confirm("保存中の技・性格・努力値・持ち物を初期化しますか？")) return;
    state.party = ENGINE.createDefaultParty();
    saveParty();
    markPartyDirty();
    renderParty();
    toast("編成を初期化しました");
  }

  async function proceedToRooms() {
    const errors = ENGINE.validateParty(state.party);
    if (errors.length) return message(elements.partyMessage, errors.slice(0, 3).join(" "));
    saveParty();
    elements.toRoomsButton.disabled = true;
    try {
      if (!state.localMode) await savePartyToFirebase({ notify: false });
      renderRooms();
      showScreen("rooms");
      if (!state.localMode) toast(`${state.playerName} の編成を保存しました`);
    } catch (error) {
      message(elements.partyMessage, firebaseFriendlyError(error));
    } finally {
      elements.toRoomsButton.disabled = false;
    }
  }

  function startLobbySubscription() {
    if (state.localMode || !state.client || state.lobbySubscribed) return;
    state.lobbySubscribed = true;
    try {
      state.client.subscribeLobby((summaries) => {
        state.roomSummaries = summaries;
        if (state.screen === "rooms" && !state.room) renderRooms();
      }, (error) => {
        if (state.screen === "rooms" && !state.room) message(elements.roomMessage, firebaseFriendlyError(error));
      });
    } catch (error) {
      state.lobbySubscribed = false;
      message(elements.roomMessage, firebaseFriendlyError(error));
    }
  }

  function lobbyStatus(summary) {
    if (!summary) return { label: "状況を取得中…", state: "loading" };
    if (!summary.players.length) return { label: "空室・入室できます", state: "open" };
    if (summary.players.some((player) => !player.online)) return { label: "接続復帰を待機中", state: "disconnected" };
    if (summary.phase === "waiting") return { label: "対戦相手を待機中", state: "waiting" };
    if (summary.phase === "teamPreview") return { label: "3体選出中", state: "busy" };
    if (summary.phase === "battle") return { label: `対戦中・ターン ${summary.turn}`, state: "busy" };
    if (summary.phase === "result") return { label: "対戦終了・再戦待ち", state: "busy" };
    return { label: "状態を確認できません", state: "disconnected" };
  }

  function renderRooms() {
    elements.roomGrid.hidden = false;
    elements.waitingCard.hidden = true;
    elements.roomGrid.innerHTML = [1, 2, 3, 4, 5].map((room) => {
      const summary = state.localMode ? { phase: "empty", players: [] } : state.roomSummaries[room];
      const status = state.localMode ? { label: "CPU戦を開始できます", state: "open" } : lobbyStatus(summary);
      const players = summary?.players || [];
      const full = players.length >= 2;
      const unavailable = (!state.localMode && !summary) || full || players.some((player) => !player.online);
      const playerList = players.length
        ? players.map((player) => `<b class="room-player-name" data-online="${player.online}">${escapeHtml(player.name)}${player.online ? "" : "（切断中）"}</b>`).join("")
        : `<b class="room-player-empty">${summary ? "プレイヤーはいません" : "プレイヤー情報を取得中"}</b>`;
      const suffix = full ? "・満室" : unavailable ? "" : " →";
      return `<button class="room-button" data-room="${room}" type="button"${unavailable ? " disabled" : ""}><small><span>ROOM 0${room}</span><em>${summary ? players.length : "—"} / 2</em></small><strong>${room}番の部屋</strong><span class="room-player-list">${playerList}</span><span class="room-status" data-state="${status.state}">${escapeHtml(status.label)}${suffix}</span></button>`;
    }).join("");
    message(elements.roomMessage, state.localMode ? "ローカルモードでは選んだ部屋ですぐCPU戦を開始します。" : "");
    startLobbySubscription();
  }

  async function joinRoom(roomNumber) {
    message(elements.roomMessage, "部屋へ接続しています…", true);
    if (state.localMode) {
      startLocalPreview(roomNumber);
      return;
    }
    const joinedRoom = await state.client.join(roomNumber, state.party);
    state.roomNumber = Number(roomNumber);
    localStorage.setItem(STORAGE.room, String(roomNumber));
    handleRoomState(joinedRoom);
    state.client.subscribe(handleRoomState, (error) => {
      setConnection("同期エラー", "error");
      const target = state.screen === "preview" ? elements.previewMessage
        : state.screen === "rooms" ? elements.roomMessage
          : elements.battleMessage;
      message(target, firebaseFriendlyError(error));
    });
  }

  function makeBotParty() {
    const party = ENGINE.createDefaultParty();
    const plans = [
      ["muddy-water", "poison-jab", "recover", "toxic"],
      ["double-edge", "play-rough", "iron-head", "recover"],
      ["stone-edge", "wild-charge", "iron-head", "thunder-wave"],
      ["psychic", "air-slash", "roost", "nasty-plot"],
      ["dark-pulse", "psychic", "nasty-plot", "sucker-punch"],
      ["bug-buzz", "earth-power", "quiver-dance", "megahorn"],
    ];
    const items = ["leftovers", "choice-scarf", "focus-sash", "life-orb", "sitrus-berry", "rocky-helmet"];
    return party.map((build, index) => ({ ...build, moveIds: plans[index], itemId: items[index] }));
  }

  function startLocalPreview(roomNumber) {
    const botParty = makeBotParty();
    state.roomNumber = Number(roomNumber);
    state.room = {
      roomNumber: Number(roomNumber), phase: "teamPreview", seed: ENGINE.hashString(`${state.playerName}:${roomNumber}`), commands: {},
      players: {
        "local-player": { id: "local-player", name: state.playerName, online: true, party: state.party, publicTeam: ENGINE.publicTeam(state.party), selection: null },
        "local-rival": { id: "local-rival", name: "RIVAL CPU", online: true, party: botParty, publicTeam: ENGINE.publicTeam(botParty), selection: [3, 4, 5] },
      },
    };
    handleRoomState(state.room);
  }

  function handleRoomState(room) {
    if (!room) {
      const removedRoomNumber = state.roomNumber;
      state.room = null;
      state.roomNumber = null;
      localStorage.removeItem(STORAGE.room);
      renderRooms();
      showScreen("rooms");
      if (removedRoomNumber) toast(`ROOM ${removedRoomNumber} は期限切れ、または接続者不在のため終了しました`);
      return;
    }
    state.room = room;
    state.roomNumber = room.roomNumber;
    const players = Object.values(room.players || {});
    const opponent = players.find((player) => player.id !== state.playerKey);
    if (!state.localMode) setConnection(opponent?.online ? `ROOM ${room.roomNumber}・同期中` : `ROOM ${room.roomNumber}・相手待ち`, opponent?.online ? "online" : "waiting");
    if (room.phase === "waiting" || players.length < 2) {
      showScreen("rooms");
      elements.roomGrid.hidden = true;
      elements.waitingCard.hidden = false;
      elements.waitingRoomNumber.textContent = room.roomNumber;
      return;
    }
    if (room.phase === "teamPreview") {
      state.pendingSwitchMoveId = null;
      state.selection = room.players[state.playerKey]?.selection ? [...room.players[state.playerKey].selection] : [];
      renderPreview();
      showScreen("preview");
      return;
    }
    if (room.phase === "battle" && room.battle) {
      state.actionPending = hasPendingCommand(room);
      renderBattle();
      showScreen("battle");
      if (state.localMode) advanceLocalForcedSwitchIfNeeded();
      return;
    }
    if (room.phase === "result" || room.battle?.phase === "ended") {
      renderResult();
      showScreen("result");
    }
  }

  function hasPendingCommand(room) {
    const battle = room.battle;
    if (!battle) return false;
    return Boolean(room.commands?.[`${battle.phase}-${battle.turn}`]?.[state.playerKey]);
  }

  function previewMon(teamEntry, index, selectable) {
    const species = DATA.pokemon[teamEntry.speciesId];
    const order = selectable ? state.selection.indexOf(index) : -1;
    const content = `<span class="preview-icon" style="--type-color:${TYPE_COLORS[species.typeIds[0]]}">${escapeHtml(species.name.slice(0, 1))}</span><span><strong>${escapeHtml(teamEntry.name)}</strong><small>${species.types.join(" / ")}</small></span>${order >= 0 ? `<b class="selection-order">${order + 1}</b>` : ""}`;
    return selectable
      ? `<button type="button" class="preview-mon${order >= 0 ? " selected" : ""}" data-select-index="${index}">${content}</button>`
      : `<div class="preview-mon">${content}</div>`;
  }

  function renderPreview() {
    const mine = state.room.players[state.playerKey];
    const opponent = Object.values(state.room.players).find((player) => player.id !== state.playerKey);
    elements.myPreviewTeam.innerHTML = mine.publicTeam.map((entry, index) => previewMon(entry, index, true)).join("");
    elements.opponentPreviewTeam.innerHTML = opponent.publicTeam.map((entry, index) => previewMon(entry, index, false)).join("");
    elements.selectionCount.textContent = state.selection.length;
    elements.submitSelectionButton.disabled = state.selection.length !== 3 || Boolean(mine.selection);
    message(elements.previewMessage, mine.selection ? "選出を送信しました。相手の決定を待っています…" : "", true);
  }

  function toggleSelection(index) {
    const existing = state.selection.indexOf(index);
    if (existing >= 0) state.selection.splice(existing, 1);
    else if (state.selection.length < 3) state.selection.push(index);
    renderPreview();
  }

  async function submitSelection() {
    if (state.selection.length !== 3) return;
    elements.submitSelectionButton.disabled = true;
    try {
      if (state.localMode) {
        state.room.players[state.playerKey].selection = [...state.selection];
        const entries = Object.entries(state.room.players);
        state.room.battle = ENGINE.createBattle({ players: entries.map(([id, player]) => ({ id, name: player.name, team: player.selection.map((index) => player.party[index]) })), seed: state.room.seed });
        state.room.phase = "battle";
        handleRoomState(state.room);
      } else {
        await state.client.submitSelection(state.selection);
      }
    } catch (error) {
      message(elements.previewMessage, firebaseFriendlyError(error));
      elements.submitSelectionButton.disabled = false;
    }
  }

  function conditionLabel(mon) {
    const status = { poison: "どく", badPoison: "もうどく", burn: "やけど", paralysis: "まひ", sleep: "ねむり", freeze: "こおり" }[mon.status];
    const volatile = [];
    if (mon.volatile.confusionTurns) volatile.push("こんらん");
    if (mon.volatile.taunt) volatile.push("ちょうはつ");
    if (mon.volatile.substituteHp) volatile.push(`みがわり ${mon.volatile.substituteHp}`);
    return [status, ...volatile].filter(Boolean).join("・") || "正常";
  }

  function renderPokemonStatus(mon, own) {
    const percent = Math.max(0, Math.round(mon.hp / mon.maxHp * 100));
    const hpColor = percent > 50 ? "#82d173" : percent > 20 ? "#ffc857" : "#ed5d68";
    const ownAbility = own ? DATA.abilities[mon.copiedAbilityId || mon.abilityId]?.name || "—" : null;
    const ownItem = own ? DATA.items[mon.itemConsumed ? null : mon.itemId]?.name || "なし" : null;
    const privateDetails = own ? ` · 特性 ${escapeHtml(ownAbility)} · 持ち物 ${escapeHtml(ownItem)}` : "";
    return `<div class="pokemon-name-line"><h3>${escapeHtml(mon.name)}</h3><span>Lv.${mon.level}</span></div><div class="type-tags">${mon.typeIds.map((id) => `<i class="type-tag">${DATA.types[id]}</i>`).join("")}</div><div class="hp-track"><i style="--hp:${percent}%;--hp-color:${hpColor}"></i></div><div class="hp-label"><span>HP</span><b>${own ? `${mon.hp} / ${mon.maxHp}` : `${percent}%`}</b></div><div class="condition-row">${escapeHtml(conditionLabel(mon))}${privateDetails}</div>`;
  }

  function renderOrbs(team) {
    return team.map((mon) => `<i class="${mon.fainted ? "fainted" : ""}" title="${escapeHtml(mon.name)}"></i>`).join("");
  }

  function renderFieldEffects(battle, myIndex) {
    const labels = [];
    if (battle.field.weather) labels.push(`${{ rain: "雨", sun: "晴れ", sandstorm: "砂嵐", snow: "雪" }[battle.field.weather]} ${battle.field.weatherTurns}`);
    if (battle.field.terrain) labels.push(`${{ electric: "エレキ", psychic: "サイコ", grassy: "グラス", misty: "ミスト" }[battle.field.terrain]}フィールド ${battle.field.terrainTurns}`);
    if (battle.field.trickRoomTurns) labels.push(`トリックルーム ${battle.field.trickRoomTurns}`);
    const mine = battle.players[myIndex].side;
    const foe = battle.players[myIndex === 0 ? 1 : 0].side;
    if (mine.stealthRock || mine.toxicSpikes || mine.stickyWeb) labels.push("自分側に設置物");
    if (foe.stealthRock || foe.toxicSpikes || foe.stickyWeb) labels.push("相手側に設置物");
    return labels.map((label) => `<span>${escapeHtml(label)}</span>`).join("");
  }

  function renderBattle() {
    const battle = state.room.battle;
    const myIndex = battle.players.findIndex((player) => player.id === state.playerKey);
    if (myIndex < 0) return;
    const foeIndex = myIndex === 0 ? 1 : 0;
    const mine = battle.players[myIndex];
    const foe = battle.players[foeIndex];
    const myMon = mine.team[mine.active];
    const foeMon = foe.team[foe.active];
    elements.myName.textContent = mine.name;
    elements.opponentName.textContent = foe.name;
    elements.playerOrbs.innerHTML = renderOrbs(mine.team);
    elements.opponentOrbs.innerHTML = renderOrbs(foe.team);
    elements.playerStatus.innerHTML = renderPokemonStatus(myMon, true);
    elements.opponentStatus.innerHTML = renderPokemonStatus(foeMon, false);
    elements.fieldEffects.innerHTML = renderFieldEffects(battle, myIndex);
    elements.turnNumber.textContent = battle.turn;
    elements.battleSyncState.textContent = state.actionPending ? "相手の入力を待っています" : battle.phase === "forcedSwitch" ? "交代してください" : "行動を選んでください";
    renderCommands(battle, mine, myIndex);
    elements.battleLog.innerHTML = battle.log.map((entry) => `<div class="log-entry" data-type="${escapeHtml(entry.type)}"><b>${String(entry.turn).padStart(2, "0")}</b><span>${escapeHtml(entry.message)}</span></div>`).join("");
    elements.battleLog.scrollTop = elements.battleLog.scrollHeight;
    message(elements.battleMessage, "");
  }

  function renderCommands(battle, mine, myIndex) {
    if (state.actionPending) {
      elements.commandPanel.innerHTML = `<div class="waiting-command"><div><strong>入力を送信しました</strong><span>両者の入力が揃うとターンが進みます。</span></div></div>`;
      return;
    }
    const legal = ENGINE.legalActions(battle, state.playerKey);
    if (battle.phase === "forcedSwitch" && !legal.forcedSwitch) {
      elements.commandPanel.innerHTML = `<div class="waiting-command"><div><strong>相手が交代中です</strong><span>同期が完了するまでお待ちください。</span></div></div>`;
      return;
    }
    const switches = legal.switches.map((index) => ({ index, mon: mine.team[index] }));
    const switchButtons = (mode = "normal") => switches.map(({ index, mon }) => `<button class="switch-button" ${mode === "pivot" ? "data-action-pivot-switch" : "data-action-switch"}="${index}" type="button"><strong>${escapeHtml(mon.name)}</strong><span class="move-meta"><span>${mon.typeIds.map((id) => DATA.types[id]).join(" / ")}</span><span>HP ${mon.hp}/${mon.maxHp}</span></span></button>`).join("");
    if (legal.forcedSwitch) {
      elements.commandPanel.innerHTML = `<div class="command-title"><span>交代するポケモン</span><span>SWITCH</span></div><div class="switch-list">${switchButtons()}</div>`;
      bindCommandButtons();
      return;
    }
    const pendingMove = legal.moves.find((slot) => slot.id === state.pendingSwitchMoveId && slot.requiresSwitchTarget && !slot.disabled);
    if (state.pendingSwitchMoveId && !pendingMove) state.pendingSwitchMoveId = null;
    if (pendingMove && switches.length) {
      const move = DATA.moves[pendingMove.id];
      elements.commandPanel.innerHTML = `<div class="command-title switch-choice-title"><span>${escapeHtml(move.name)}の交代先</span><button class="text-button" data-cancel-pivot type="button">技選択に戻る</button></div><div class="switch-list">${switchButtons("pivot")}</div>`;
      bindCommandButtons();
      return;
    }
    const moveButtons = legal.moves.map((slot) => {
      const move = DATA.moves[slot.id] || { name: "わるあがき", type: "ノーマル", category: "物理", typeId: "normal", power: 50 };
      return `<button class="move-button" style="--move-color:${TYPE_COLORS[move.typeId]}" data-action-move="${slot.id}" type="button"${slot.disabled ? " disabled" : ""}><strong>${escapeHtml(move.name)}</strong><span class="move-meta"><span>${move.type}・${move.category}</span><span>PP ${slot.pp}/${slot.maxPp}</span></span></button>`;
    }).join("");
    elements.commandPanel.innerHTML = `<div class="command-title"><span>${state.commandTab === "moves" ? "技を選ぶ" : "交代する"}</span><span>${escapeHtml(mine.team[mine.active].name)}</span></div><div class="console-tabs"><button type="button" data-command-tab="moves" class="${state.commandTab === "moves" ? "active" : ""}">技</button><button type="button" data-command-tab="switches" class="${state.commandTab === "switches" ? "active" : ""}">交代</button></div><div class="${state.commandTab === "moves" ? "move-grid" : "switch-list"}">${state.commandTab === "moves" ? moveButtons : switchButtons() || "<p>交代できるポケモンがいません。</p>"}</div>`;
    bindCommandButtons();
  }

  function bindCommandButtons() {
    elements.commandPanel.querySelectorAll("[data-command-tab]").forEach((button) => button.addEventListener("click", () => {
      state.pendingSwitchMoveId = null;
      state.commandTab = button.dataset.commandTab;
      renderBattle();
    }));
    elements.commandPanel.querySelectorAll("[data-action-move]").forEach((button) => button.addEventListener("click", () => {
      const legal = ENGINE.legalActions(state.room.battle, state.playerKey);
      const slot = legal.moves.find((move) => move.id === button.dataset.actionMove);
      if (slot?.requiresSwitchTarget && legal.switches.length) {
        state.pendingSwitchMoveId = slot.id;
        renderBattle();
        return;
      }
      submitBattleAction({ type: "move", moveId: button.dataset.actionMove });
    }));
    elements.commandPanel.querySelectorAll("[data-action-pivot-switch]").forEach((button) => button.addEventListener("click", () => {
      const to = Number(button.dataset.actionPivotSwitch);
      submitBattleAction({ type: "move", moveId: state.pendingSwitchMoveId, switchTo: to, switchPreference: to });
    }));
    elements.commandPanel.querySelectorAll("[data-cancel-pivot]").forEach((button) => button.addEventListener("click", () => {
      state.pendingSwitchMoveId = null;
      renderBattle();
    }));
    elements.commandPanel.querySelectorAll("[data-action-switch]").forEach((button) => button.addEventListener("click", () => submitBattleAction({ type: "switch", to: Number(button.dataset.actionSwitch) })));
  }

  function chooseBotAction(battle) {
    const bot = battle.players.find((player) => player.id === "local-rival");
    const legal = ENGINE.legalActions(battle, bot.id);
    if (legal.forcedSwitch) return { type: "switch", to: legal.switches[0] };
    const candidates = legal.moves.filter((move) => !move.disabled);
    const attacking = candidates.filter((slot) => DATA.moves[slot.id]?.categoryId !== "status");
    const pool = attacking.length ? attacking : candidates;
    const choice = pool[ENGINE.hashString(`${battle.seed}:${battle.turn}:${bot.team[bot.active].uid}`) % pool.length];
    return { type: "move", moveId: choice.id, switchTo: legal.switches[0], switchPreference: legal.switches[0] };
  }

  async function submitBattleAction(action) {
    if (state.actionPending) return;
    state.pendingSwitchMoveId = null;
    state.actionPending = true;
    renderBattle();
    try {
      if (state.localMode) {
        const battle = state.room.battle;
        const commands = { [state.playerKey]: action };
        const botRequired = battle.phase !== "forcedSwitch" || battle.requiredSwitches.some((index) => battle.players[index].id === "local-rival");
        if (botRequired) commands["local-rival"] = chooseBotAction(battle);
        state.room.battle = ENGINE.resolveTurn(battle, commands);
        state.room.phase = state.room.battle.phase === "ended" ? "result" : "battle";
        state.actionPending = false;
        handleRoomState(state.room);
      } else {
        await state.client.submitAction(action);
      }
    } catch (error) {
      state.actionPending = false;
      renderBattle();
      message(elements.battleMessage, firebaseFriendlyError(error));
    }
  }

  function advanceLocalForcedSwitchIfNeeded() {
    const battle = state.room.battle;
    if (battle.phase !== "forcedSwitch") return;
    const myIndex = battle.players.findIndex((player) => player.id === state.playerKey);
    const botIndex = battle.players.findIndex((player) => player.id === "local-rival");
    if (!battle.requiredSwitches.includes(myIndex) && battle.requiredSwitches.includes(botIndex)) {
      state.room.battle = ENGINE.resolveTurn(battle, { "local-rival": chooseBotAction(battle) });
      handleRoomState(state.room);
    }
  }

  function renderResult() {
    const battle = state.room.battle;
    const won = battle.winnerId === state.playerKey;
    const draw = battle.result === "draw";
    elements.resultEmblem.textContent = draw ? "DRAW" : won ? "WIN" : "LOSE";
    elements.resultTitle.textContent = draw ? "引き分け" : won ? "勝利！" : "敗北";
    elements.resultDescription.textContent = draw ? "両者とも戦えるポケモンがいなくなりました。" : won ? "最後の一手まで読み切りました。" : "編成を見直して、もう一度挑みましょう。";
    const mine = state.room.players[state.playerKey];
    elements.rematchButton.disabled = Boolean(mine?.rematch);
    message(elements.resultMessage, mine?.rematch ? "再戦を申し込みました。相手を待っています…" : "", true);
  }

  async function requestRematch() {
    try {
      if (state.localMode) {
        for (const player of Object.values(state.room.players)) player.selection = player.id === "local-rival" ? [3, 4, 5] : null;
        state.room.battle = null;
        state.room.phase = "teamPreview";
        state.selection = [];
        handleRoomState(state.room);
      } else await state.client.requestRematch();
    } catch (error) { message(elements.resultMessage, firebaseFriendlyError(error)); }
  }

  async function leaveRoom() {
    try {
      if (state.client) await state.client.leave();
    } catch (error) {
      toast(firebaseFriendlyError(error));
    } finally {
      state.room = null;
      state.roomNumber = null;
      state.selection = [];
      state.actionPending = false;
      state.pendingSwitchMoveId = null;
      state.roomDisconnected = false;
      state.pendingReconnect = null;
      localStorage.removeItem(STORAGE.room);
      closeReconnectPrompt();
      setConnection(state.localMode ? `${state.playerName}・ローカル` : `${state.playerName}・オンライン`, state.localMode ? "waiting" : "online");
      renderRooms();
      showScreen("rooms");
    }
  }

  function bindEvents() {
    elements.loginForm.addEventListener("submit", onlineLogin);
    elements.firebaseConfigReset.addEventListener("click", resetFirebaseConfig);
    elements.localDemoButton.addEventListener("click", startLocalMode);
    elements.partyGrid.addEventListener("change", (event) => updatePartyFromControl(event.target));
    elements.cloudSaveButton.addEventListener("click", () => savePartyToFirebase().catch(() => {}));
    elements.cloudLoadButton.addEventListener("click", () => loadPartyFromFirebase().catch(() => {}));
    elements.resetPartyButton.addEventListener("click", resetParty);
    elements.toRoomsButton.addEventListener("click", proceedToRooms);
    elements.backToTeamButton.addEventListener("click", () => { renderParty(); showScreen("team"); });
    elements.roomGrid.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-room]");
      if (!button) return;
      try { await joinRoom(button.dataset.room); } catch (error) { message(elements.roomMessage, firebaseFriendlyError(error)); }
    });
    elements.leaveWaitingButton.addEventListener("click", leaveRoom);
    elements.myPreviewTeam.addEventListener("click", (event) => {
      const button = event.target.closest("[data-select-index]");
      if (button && !state.room.players[state.playerKey].selection) toggleSelection(Number(button.dataset.selectIndex));
    });
    elements.clearSelectionButton.addEventListener("click", () => { state.selection = []; renderPreview(); });
    elements.submitSelectionButton.addEventListener("click", submitSelection);
    elements.leaveBattleButton.addEventListener("click", async () => { if (window.confirm("対戦を終了して部屋を出ますか？")) await leaveRoom(); });
    elements.rematchButton.addEventListener("click", requestRematch);
    elements.leaveResultButton.addEventListener("click", leaveRoom);
    elements.reconnectButton.addEventListener("click", reconnectToRoom);
    elements.discardReconnectButton.addEventListener("click", discardReconnect);
    elements.reconnectDialog.addEventListener("cancel", (event) => event.preventDefault());
    elements.homeButton.addEventListener("click", async () => {
      if (state.room && !window.confirm("現在の部屋から退出しますか？")) return;
      if (state.room) await leaveRoom();
      else showScreen(state.playerName ? "team" : "login");
    });
    window.addEventListener("beforeunload", () => saveParty());
  }

  populateLogin();
  bindEvents();
  setConnection("未接続", "offline");
})(typeof globalThis !== "undefined" ? globalThis : window);
