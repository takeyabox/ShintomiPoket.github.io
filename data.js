/**
 * ShintomiPoket master data.
 *
 * All battle/UI code should read data from GAME_DATA instead of duplicating
 * values.  `null` accuracy means that the move skips the normal accuracy
 * check.  Ratios are stored as fractions (1 / 16, etc.), while multipliers
 * are stored as decimal numbers (1.2, etc.).
 */
(function initialiseGameData(global) {
  "use strict";

  const TYPES = Object.freeze({
    normal: "ノーマル",
    fire: "ほのお",
    water: "みず",
    electric: "でんき",
    grass: "くさ",
    ice: "こおり",
    fighting: "かくとう",
    poison: "どく",
    ground: "じめん",
    flying: "ひこう",
    psychic: "エスパー",
    bug: "むし",
    rock: "いわ",
    ghost: "ゴースト",
    dragon: "ドラゴン",
    dark: "あく",
    steel: "はがね",
    fairy: "フェアリー",
  });

  const MOVE_CATEGORIES = Object.freeze({
    physical: "物理",
    special: "特殊",
    status: "変化",
  });

  const MOVE_TARGETS = Object.freeze({
    self: "使用者",
    oneOpponent: "相手1体",
    oneAny: "任意の1体",
    allOpponents: "相手全体",
    allAdjacent: "自分以外",
    userSide: "味方の場",
    opponentSide: "相手の場",
    field: "全体の場",
  });

  function deepFreeze(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
    return value;
  }

  function indexBy(list, key) {
    const index = {};
    for (const entry of list) {
      const indexKey = entry[key];
      if (Object.hasOwn(index, indexKey)) {
        throw new Error(`マスターデータの ${key}「${indexKey}」が重複しています。`);
      }
      index[indexKey] = entry;
    }
    return Object.freeze(index);
  }

  function move(id, name, typeId, categoryId, power, accuracy, pp, options = {}) {
    const {
      generation = 1,
      priority = 0,
      target = categoryId === "status" ? "self" : "oneOpponent",
      contact = false,
      sound = false,
      protectable = categoryId !== "status" || target === "oneOpponent" || target === "oneAny",
      reflectable = categoryId === "status" && target === "oneOpponent",
      snatchable = false,
      effect = { kind: categoryId === "status" ? "none" : "damage" },
      description = "",
    } = options;

    return deepFreeze({
      id,
      name,
      generation,
      typeId,
      type: TYPES[typeId],
      categoryId,
      category: MOVE_CATEGORIES[categoryId],
      power,
      accuracy,
      pp,
      priority,
      targetId: target,
      target: MOVE_TARGETS[target],
      flags: { contact, sound, protectable, reflectable, snatchable },
      effect,
      description,
    });
  }

  const MOVE_LIST = [
    move("toxic", "どくどく", "poison", "status", null, 90, 10, {
      target: "oneOpponent", effect: { kind: "status", status: "badPoison" },
      description: "相手をもうどく状態にする。どくタイプの使用者が使う場合は必中。",
    }),
    move("acid-spray", "アシッドボム", "poison", "special", 40, 100, 20, {
      generation: 5, effect: { kind: "damageAndStage", target: "target", stat: "specialDefense", stages: -2, chance: 1 },
      description: "100%の確率で相手の特防を2段階下げる。",
    }),
    move("muddy-water", "だくりゅう", "water", "special", 90, 85, 10, {
      generation: 3, target: "allOpponents", effect: { kind: "damageAndStage", target: "target", stat: "accuracy", stages: -1, chance: 0.3 },
      description: "30%の確率で命中率を1段階下げる。",
    }),
    move("flip-turn", "クイックターン", "water", "physical", 60, 100, 20, {
      generation: 8, contact: true, effect: { kind: "damageThenSwitch", switch: "user" },
      description: "攻撃後、使用者を手持ちと交代させる。",
    }),
    move("recover", "じこさいせい", "normal", "status", null, null, 5, {
      snatchable: true, effect: { kind: "heal", target: "user", maxHpRatio: 0.5 },
      description: "最大HPの1/2を回復する。",
    }),
    move("mud-slap", "どろかけ", "ground", "special", 20, 100, 10, {
      generation: 2, effect: { kind: "damageAndStage", target: "target", stat: "accuracy", stages: -1, chance: 1 },
      description: "100%の確率で相手の命中率を1段階下げる。",
    }),
    move("liquidation", "アクアブレイク", "water", "physical", 85, 100, 10, {
      generation: 7, contact: true, effect: { kind: "damageAndStage", target: "target", stat: "defense", stages: -1, chance: 0.2 },
      description: "20%の確率で相手の防御を1段階下げる。",
    }),
    move("poison-jab", "どくづき", "poison", "physical", 80, 100, 20, {
      generation: 4, contact: true, effect: { kind: "damageAndStatus", status: "poison", chance: 0.3 },
      description: "30%の確率で相手をどく状態にする。",
    }),
    move("protect", "まもる", "normal", "status", null, null, 10, {
      generation: 2, priority: 4, protectable: false, effect: { kind: "protect", scope: "mostMoves", consecutivePenalty: true },
      description: "そのターンの技を防ぐ。連続使用すると成功率が下がる。",
    }),
    move("substitute", "みがわり", "normal", "status", null, null, 10, {
      generation: 1, effect: { kind: "substitute", hpCostRatio: 0.25 },
      description: "最大HPの1/4を消費して同量のHPを持つみがわりを作る。",
    }),
    move("gunk-shot", "ダストシュート", "poison", "physical", 120, 80, 5, {
      generation: 4, effect: { kind: "damageAndStatus", status: "poison", chance: 0.3 },
      description: "30%の確率で相手をどく状態にする。",
    }),
    move("sludge-wave", "ヘドロウェーブ", "poison", "special", 95, 100, 10, {
      generation: 5, target: "allAdjacent", effect: { kind: "damageAndStatus", status: "poison", chance: 0.1 },
      description: "10%の確率で相手をどく状態にする。",
    }),
    move("sludge-bomb", "ヘドロばくだん", "poison", "special", 90, 100, 10, {
      generation: 2, effect: { kind: "damageAndStatus", status: "poison", chance: 0.3 },
      description: "30%の確率で相手をどく状態にする。",
    }),
    move("acid-armor", "とける", "poison", "status", null, null, 20, {
      snatchable: true, effect: { kind: "stage", target: "user", stat: "defense", stages: 2 },
      description: "自分の防御を2段階上げる。",
    }),
    move("stockpile", "たくわえる", "normal", "status", null, null, 20, {
      generation: 3, snatchable: true, effect: { kind: "stockpile", maxCount: 3, stagesEachUse: { defense: 1, specialDefense: 1 } },
      description: "たくわえる回数を増やし、防御と特防を1段階ずつ上げる（最大3回）。",
    }),
    move("haze", "くろいきり", "ice", "status", null, null, 30, {
      target: "field", effect: { kind: "resetStages", target: "allPokemon" },
      description: "場にいる全ポケモンの能力ランクを0に戻す。",
    }),
    move("toxic-spikes", "どくびし", "poison", "status", null, null, 20, {
      generation: 4, target: "opponentSide", reflectable: true, effect: { kind: "entryHazard", hazard: "toxicSpikes", maxLayers: 2 },
      description: "相手の場にどくびしを設置する。2回まで重ねられる。",
    }),
    move("rain-dance", "あまごい", "water", "status", null, null, 5, {
      generation: 2, target: "field", effect: { kind: "weather", weather: "rain", turns: 5 },
      description: "5ターンの間、天気を雨にする。",
    }),
    move("baneful-bunker", "トーチカ", "poison", "status", null, null, 10, {
      generation: 7, priority: 4, effect: { kind: "protect", contactStatus: "poison", consecutivePenalty: true },
      description: "技を防ぎ、接触してきた相手をどく状態にする。",
    }),
    move("chilling-water", "ひやみず", "water", "special", 50, 100, 20, {
      generation: 9, effect: { kind: "damageAndStage", target: "target", stat: "attack", stages: -1, chance: 1 },
      description: "100%の確率で相手の攻撃を1段階下げる。",
    }),
    move("rest", "ねむる", "psychic", "status", null, null, 5, {
      effect: { kind: "rest", heal: "full", status: "sleep", sleepTurns: 2 },
      description: "HPと状態異常を全回復し、2ターンねむり状態になる。",
    }),
    move("fling", "なげつける", "dark", "physical", null, 100, 10, {
      generation: 4, effect: { kind: "flingHeldItem", consumesItem: true, powerFromItem: true },
      description: "持ち物を投げつける。威力と追加効果は持ち物で変わり、持ち物を失う。",
    }),
    move("lunge", "とびかかる", "bug", "physical", 80, 100, 15, {
      generation: 7, contact: true, effect: { kind: "damageAndStage", target: "target", stat: "attack", stages: -1, chance: 1 },
      description: "100%の確率で相手の攻撃を1段階下げる。",
    }),
    move("draco-meteor", "りゅうせいぐん", "dragon", "special", 130, 90, 5, {
      generation: 4, effect: { kind: "damageAndStage", target: "user", stat: "specialAttack", stages: -2, chance: 1 },
      description: "攻撃後、自分の特攻が2段階下がる。",
    }),
    move("ice-beam", "れいとうビーム", "ice", "special", 90, 100, 10, {
      effect: { kind: "damageAndStatus", status: "freeze", chance: 0.1 },
      description: "10%の確率で相手をこおり状態にする。",
    }),

    move("double-edge", "すてみタックル", "normal", "physical", 120, 100, 15, {
      contact: true, effect: { kind: "recoil", damageRatio: 1 / 3 }, description: "与えたダメージの1/3を反動で受ける。",
    }),
    move("play-rough", "じゃれつく", "fairy", "physical", 90, 90, 10, {
      generation: 6, contact: true, effect: { kind: "damageAndStage", target: "target", stat: "attack", stages: -1, chance: 0.1 },
      description: "10%の確率で相手の攻撃を1段階下げる。",
    }),
    move("iron-head", "アイアンヘッド", "steel", "physical", 80, 100, 15, {
      generation: 4, contact: true, effect: { kind: "damageAndVolatile", volatile: "flinch", chance: 0.3 },
      description: "30%の確率で相手をひるませる。",
    }),
    move("encore", "アンコール", "normal", "status", null, 100, 5, {
      generation: 2, target: "oneOpponent", effect: { kind: "encore", turns: 3 },
      description: "3ターンの間、相手が最後に使った技しか選べないようにする。",
    }),
    move("hyper-voice", "ハイパーボイス", "normal", "special", 90, 100, 10, {
      generation: 3, target: "allOpponents", sound: true, effect: { kind: "damage" },
      description: "音による攻撃。みがわりを貫通する。",
    }),
    move("belly-drum", "はらだいこ", "normal", "status", null, null, 10, {
      generation: 2, snatchable: true, effect: { kind: "bellyDrum", hpCostRatio: 0.5, stat: "attack", stages: "max" },
      description: "最大HPの1/2を消費し、攻撃ランクを最大まで上げる。",
    }),
    move("baton-pass", "バトンタッチ", "normal", "status", null, null, 40, {
      generation: 2, effect: { kind: "switch", user: true, passStagesAndVolatiles: true },
      description: "能力変化や一部の状態を引き継いで手持ちと交代する。",
    }),
    move("celebrate", "おいわい", "normal", "status", null, null, 40, {
      generation: 6, effect: { kind: "none" }, description: "特別な演出をする。通常の対戦効果はない。",
    }),
    move("stuff-cheeks", "ほおばる", "normal", "status", null, null, 10, {
      generation: 8, effect: { kind: "consumeBerryAndStage", stat: "defense", stages: 2 },
      description: "持っているきのみを食べ、その効果を発動して防御を2段階上げる。",
    }),
    move("swallow", "のみこむ", "normal", "status", null, null, 10, {
      generation: 3, effect: { kind: "swallow", stockpileHealing: { 1: 0.25, 2: 0.5, 3: 1 } },
      description: "たくわえた回数に応じてHPを回復し、たくわえるを解除する。",
    }),
    move("agility", "こうそくいどう", "psychic", "status", null, null, 30, {
      snatchable: true, effect: { kind: "stage", target: "user", stat: "speed", stages: 2 },
      description: "自分の素早さを2段階上げる。",
    }),
    move("speed-swap", "スピードスワップ", "psychic", "status", null, null, 10, {
      generation: 7, target: "oneOpponent", effect: { kind: "swapRawStat", stat: "speed" },
      description: "自分と相手の素早さの実数値を入れ替える。",
    }),
    move("rapid-spin", "こうそくスピン", "normal", "physical", 50, 100, 40, {
      generation: 2, contact: true, effect: { kind: "rapidSpin", clearUserTraps: true, stages: { speed: 1 } },
      description: "自分側の設置物と束縛を解除し、自分の素早さを1段階上げる。",
    }),
    move("pound", "はたく", "normal", "physical", 40, 100, 35, {
      contact: true, effect: { kind: "damage" }, description: "通常の攻撃技。",
    }),

    move("stone-edge", "ストーンエッジ", "rock", "physical", 100, 80, 5, {
      generation: 4, effect: { kind: "damage", criticalStage: 1 }, description: "急所に当たりやすい。",
    }),
    move("wild-charge", "ワイルドボルト", "electric", "physical", 90, 100, 15, {
      generation: 5, contact: true, effect: { kind: "recoil", damageRatio: 0.25 }, description: "与えたダメージの1/4を反動で受ける。",
    }),
    move("charge", "じゅうでん", "electric", "status", null, null, 20, {
      generation: 3, snatchable: true, effect: { kind: "charge", nextElectricMultiplier: 2, stages: { specialDefense: 1 } },
      description: "特防を1段階上げ、次に使うでんき技の威力を2倍にする。",
    }),
    move("bulldoze", "じならし", "ground", "physical", 60, 100, 20, {
      generation: 5, target: "allAdjacent", effect: { kind: "damageAndStage", target: "target", stat: "speed", stages: -1, chance: 1 },
      description: "自分以外を攻撃し、素早さを1段階下げる。",
    }),
    move("rollout", "ころがる", "rock", "physical", 30, 90, 20, {
      generation: 2, contact: true, effect: { kind: "lockedEscalatingDamage", turns: 5, multiplierEachHit: 2, defenseCurlMultiplier: 2 },
      description: "5ターン連続で攻撃し、命中するたび威力が2倍になる。まるくなる後は威力がさらに2倍。",
    }),
    move("defense-curl", "まるくなる", "normal", "status", null, null, 40, {
      snatchable: true, effect: { kind: "stage", target: "user", stat: "defense", stages: 1, marksDefenseCurl: true },
      description: "自分の防御を1段階上げ、ころがるの威力倍増条件を満たす。",
    }),
    move("stomping-tantrum", "じたんだ", "ground", "physical", 75, 100, 10, {
      generation: 7, contact: true, effect: { kind: "conditionalPower", condition: "previousMoveFailed", multiplier: 2 },
      description: "直前に自分の技が失敗していると威力が2倍になる。",
    }),
    move("discharge", "ほうでん", "electric", "special", 80, 100, 15, {
      generation: 4, target: "allAdjacent", effect: { kind: "damageAndStatus", status: "paralysis", chance: 0.3 },
      description: "30%の確率で相手をまひ状態にする。",
    }),
    move("nuzzle", "ほっぺすりすり", "electric", "physical", 20, 100, 20, {
      generation: 6, contact: true, effect: { kind: "damageAndStatus", status: "paralysis", chance: 1 },
      description: "100%の確率で相手をまひ状態にする。",
    }),
    move("stealth-rock", "ステルスロック", "rock", "status", null, null, 20, {
      generation: 4, target: "opponentSide", reflectable: true, effect: { kind: "entryHazard", hazard: "stealthRock", baseMaxHpRatio: 0.125, typeScaled: true },
      description: "相手の場に、交代時いわ相性に応じてダメージを与える岩を設置する。",
    }),
    move("thunder-wave", "でんじは", "electric", "status", null, 90, 20, {
      target: "oneOpponent", effect: { kind: "status", status: "paralysis" }, description: "相手をまひ状態にする。",
    }),
    move("metal-sound", "きんぞくおん", "steel", "status", null, 85, 40, {
      generation: 3, target: "oneOpponent", sound: true, effect: { kind: "stage", target: "target", stat: "specialDefense", stages: -2 },
      description: "相手の特防を2段階下げる音技。",
    }),
    move("electric-terrain", "エレキフィールド", "electric", "status", null, null, 10, {
      generation: 6, target: "field", effect: { kind: "terrain", terrain: "electric", turns: 5 },
      description: "5ターンの間エレキフィールドにする。地面にいるポケモンは眠らず、でんき技が強化される。",
    }),
    move("belch", "ゲップ", "poison", "special", 120, 90, 10, {
      generation: 6, effect: { kind: "conditionalDamage", condition: "userConsumedBerryThisBattle" },
      description: "この対戦中にきのみを食べた使用者だけが成功する。",
    }),
    move("head-smash", "もろはのずつき", "rock", "physical", 150, 80, 5, {
      generation: 4, contact: true, effect: { kind: "recoil", damageRatio: 0.5 }, description: "与えたダメージの1/2を反動で受ける。",
    }),
    move("curse", "のろい", "ghost", "status", null, null, 10, {
      generation: 2, target: "oneOpponent", effect: { kind: "curse", ghost: { hpCostRatio: 0.5, targetDamageRatio: 0.25 }, other: { attack: 1, defense: 1, speed: -1 } },
      description: "ゴーストタイプはHP半分を削って相手をのろう。それ以外は攻撃・防御を上げ、素早さを下げる。",
    }),

    move("psychic-noise", "サイコノイズ", "psychic", "special", 75, 100, 10, {
      generation: 9, sound: true, effect: { kind: "damageAndVolatile", volatile: "healBlock", turns: 2, chance: 1 },
      description: "相手を2ターンの間、回復できない状態にする音技。",
    }),
    move("air-slash", "エアスラッシュ", "flying", "special", 75, 95, 15, {
      generation: 4, effect: { kind: "damageAndVolatile", volatile: "flinch", chance: 0.3 }, description: "30%の確率で相手をひるませる。",
    }),
    move("psychic", "サイコキネシス", "psychic", "special", 90, 100, 10, {
      effect: { kind: "damageAndStage", target: "target", stat: "specialDefense", stages: -1, chance: 0.1 },
      description: "10%の確率で相手の特防を1段階下げる。",
    }),
    move("draining-kiss", "ドレインキッス", "fairy", "special", 50, 100, 10, {
      generation: 6, contact: true, effect: { kind: "drain", damageRatio: 0.75 }, description: "与えたダメージの3/4だけHPを回復する。",
    }),
    move("roost", "はねやすめ", "flying", "status", null, null, 5, {
      generation: 4, snatchable: true, effect: { kind: "roost", maxHpRatio: 0.5, removeFlyingTypeForTurn: true },
      description: "最大HPの1/2を回復し、そのターンはひこうタイプを失う。",
    }),
    move("nasty-plot", "わるだくみ", "dark", "status", null, null, 20, {
      generation: 4, snatchable: true, effect: { kind: "stage", target: "user", stat: "specialAttack", stages: 2 }, description: "自分の特攻を2段階上げる。",
    }),
    move("screech", "いやなおと", "normal", "status", null, 85, 40, {
      target: "oneOpponent", sound: true, effect: { kind: "stage", target: "target", stat: "defense", stages: -2 }, description: "相手の防御を2段階下げる音技。",
    }),
    move("tailwind", "おいかぜ", "flying", "status", null, null, 15, {
      generation: 4, target: "userSide", effect: { kind: "sideCondition", condition: "tailwind", turns: 4, speedMultiplier: 2 },
      description: "4ターンの間、味方の素早さを2倍にする。",
    }),
    move("amnesia", "どわすれ", "psychic", "status", null, null, 20, {
      snatchable: true, effect: { kind: "stage", target: "user", stat: "specialDefense", stages: 2 }, description: "自分の特防を2段階上げる。",
    }),
    move("hurricane", "ぼうふう", "flying", "special", 110, 70, 10, {
      generation: 5, effect: { kind: "weatherAccuracyAndStatus", rainAccuracy: null, sunAccuracy: 50, status: "confusion", chance: 0.3 },
      description: "30%の確率で混乱させる。雨では必中、晴れでは命中率50%。",
    }),
    move("splash", "はねる", "normal", "status", null, null, 40, {
      effect: { kind: "none", failsDuringGravity: true }, description: "通常は何も起こらない。じゅうりょく中は失敗する。",
    }),
    move("luster-purge", "ラスターパージ", "psychic", "special", 95, 100, 5, {
      generation: 3, effect: { kind: "damageAndStage", target: "target", stat: "specialDefense", stages: -1, chance: 0.5 },
      description: "50%の確率で相手の特防を1段階下げる。",
    }),
    move("light-screen", "ひかりのかべ", "psychic", "status", null, null, 30, {
      target: "userSide", effect: { kind: "screen", screen: "lightScreen", turns: 5, singleBattleMultiplier: 0.5, doubleBattleMultiplier: 2 / 3 },
      description: "5ターンの間、味方が受ける特殊ダメージを軽減する。",
    }),
    move("trick-room", "トリックルーム", "psychic", "status", null, null, 5, {
      generation: 4, priority: -7, target: "field", effect: { kind: "room", room: "trickRoom", turns: 5 },
      description: "5ターンの間、同じ優先度では素早さが低い順に行動する。",
    }),
    move("chilly-reception", "さむいギャグ", "ice", "status", null, null, 10, {
      generation: 9, target: "field", effect: { kind: "weatherThenSwitch", weather: "snow", turns: 5, switch: "user" },
      description: "天気を5ターン雪にしてから手持ちと交代する。",
    }),

    move("dark-pulse", "あくのはどう", "dark", "special", 80, 100, 15, {
      generation: 4, effect: { kind: "damageAndVolatile", volatile: "flinch", chance: 0.2 }, description: "20%の確率で相手をひるませる。",
    }),
    move("yawn", "あくび", "normal", "status", null, null, 10, {
      generation: 3, target: "oneOpponent", effect: { kind: "delayedStatus", status: "sleep", delayTurns: 1 },
      description: "次のターン終了時に相手をねむり状態にする。",
    }),
    move("no-retreat", "はいすいのじん", "fighting", "status", null, null, 5, {
      generation: 8, effect: { kind: "stagesAndTrapSelf", stats: { attack: 1, defense: 1, specialAttack: 1, specialDefense: 1, speed: 1 }, once: true },
      description: "全能力を1段階上げるが交代できなくなる。1回だけ成功する。",
    }),
    move("crunch", "かみくだく", "dark", "physical", 80, 100, 15, {
      generation: 2, contact: true, effect: { kind: "damageAndStage", target: "target", stat: "defense", stages: -1, chance: 0.2 },
      description: "20%の確率で相手の防御を1段階下げる。",
    }),
    move("facade", "からげんき", "normal", "physical", 70, 100, 20, {
      generation: 3, contact: true, effect: { kind: "conditionalPower", condition: "userBurnPoisonOrParalysis", multiplier: 2, ignoreBurnAttackDrop: true },
      description: "どく・もうどく・まひ・やけど状態では威力が2倍。やけどの物理威力低下も無視する。",
    }),
    move("taunt", "ちょうはつ", "dark", "status", null, 100, 20, {
      generation: 3, target: "oneOpponent", effect: { kind: "taunt", turns: { min: 3, max: 4 } }, description: "相手が変化技を選べないようにする。",
    }),
    move("hypnosis", "さいみんじゅつ", "psychic", "status", null, 60, 20, {
      target: "oneOpponent", effect: { kind: "status", status: "sleep" }, description: "相手をねむり状態にする。",
    }),
    move("sleep-talk", "ねごと", "normal", "status", null, null, 10, {
      generation: 2, effect: { kind: "callRandomKnownMove", condition: "userAsleep", excludedMoves: ["sleep-talk"] },
      description: "ねむり中に覚えている別の技をランダムに1つ使う。",
    }),
    move("shadow-ball", "シャドーボール", "ghost", "special", 80, 100, 15, {
      generation: 2, effect: { kind: "damageAndStage", target: "target", stat: "specialDefense", stages: -1, chance: 0.2 },
      description: "20%の確率で相手の特防を1段階下げる。",
    }),
    move("sucker-punch", "ふいうち", "dark", "physical", 70, 100, 5, {
      generation: 4, priority: 1, contact: true, effect: { kind: "conditionalDamage", condition: "targetSelectedAttackingMoveAndHasNotActed" },
      description: "相手がまだ行動前で攻撃技を選んでいる時だけ成功する。",
    }),
    move("trick", "トリック", "psychic", "status", null, 100, 10, {
      generation: 3, target: "oneOpponent", effect: { kind: "swapHeldItems" }, description: "自分と相手の持ち物を入れ替える。",
    }),
    move("destiny-bond", "みちづれ", "ghost", "status", null, null, 5, {
      generation: 2, effect: { kind: "destinyBond", untilNextAction: true, consecutiveUseFails: true },
      description: "次に行動するまでに相手の攻撃で倒されると、その相手もひんしにする。連続使用は失敗する。",
    }),
    move("fillet-away", "みをけずる", "normal", "status", null, null, 10, {
      generation: 9, effect: { kind: "stagesWithHpCost", hpCostRatio: 0.5, stats: { attack: 2, specialAttack: 2, speed: 2 } },
      description: "最大HPの1/2を消費し、攻撃・特攻・素早さを2段階ずつ上げる。",
    }),

    move("bug-buzz", "むしのさざめき", "bug", "special", 90, 100, 10, {
      generation: 4, target: "oneOpponent", sound: true, effect: { kind: "damageAndStage", target: "target", stat: "specialDefense", stages: -1, chance: 0.1 },
      description: "10%の確率で特防を1段階下げる音技。みがわりを貫通する。",
    }),
    move("earth-power", "だいちのちから", "ground", "special", 90, 100, 10, {
      generation: 4, effect: { kind: "damageAndStage", target: "target", stat: "specialDefense", stages: -1, chance: 0.1 },
      description: "10%の確率で相手の特防を1段階下げる。",
    }),
    move("u-turn", "とんぼがえり", "bug", "physical", 70, 100, 20, {
      generation: 4, contact: true, effect: { kind: "damageThenSwitch", switch: "user" }, description: "攻撃後、使用者を手持ちと交代させる。",
    }),
    move("quiver-dance", "ちょうのまい", "bug", "status", null, null, 20, {
      generation: 5, snatchable: true, effect: { kind: "stages", target: "user", stats: { specialAttack: 1, specialDefense: 1, speed: 1 } },
      description: "自分の特攻・特防・素早さを1段階ずつ上げる。",
    }),
    move("dig", "あなをほる", "ground", "physical", 80, 100, 10, {
      contact: true, effect: { kind: "twoTurnAttack", invulnerable: "underground", incomingDoublePowerMoves: ["earthquake", "magnitude"] },
      description: "1ターン目に地中へ潜り、2ターン目に攻撃する。",
    }),
    move("megahorn", "メガホーン", "bug", "physical", 120, 85, 10, {
      generation: 2, contact: true, effect: { kind: "damage" }, description: "通常の攻撃技。",
    }),
    move("mud-shot", "マッドショット", "ground", "special", 55, 95, 15, {
      generation: 3, effect: { kind: "damageAndStage", target: "target", stat: "speed", stages: -1, chance: 1 },
      description: "100%の確率で相手の素早さを1段階下げる。",
    }),
    move("sticky-web", "ねばねばネット", "bug", "status", null, null, 20, {
      generation: 6, target: "opponentSide", reflectable: true, effect: { kind: "entryHazard", hazard: "stickyWeb", groundedSwitchInStages: { speed: -1 } },
      description: "相手の場に、接地した交代先の素早さを1段階下げる網を設置する。",
    }),
    move("electroweb", "エレキネット", "electric", "special", 55, 95, 15, {
      generation: 5, target: "allOpponents", effect: { kind: "damageAndStage", target: "target", stat: "speed", stages: -1, chance: 1 },
      description: "相手全体を攻撃し、素早さを1段階下げる。",
    }),
    move("tidy-up", "おかたづけ", "normal", "status", null, null, 10, {
      generation: 9, effect: { kind: "tidyUp", clearBothSides: ["substitute", "spikes", "toxicSpikes", "stealthRock", "stickyWeb"], stages: { attack: 1, speed: 1 } },
      description: "双方のみがわりと設置物を除去し、自分の攻撃と素早さを1段階上げる。",
    }),
    move("tail-glow", "ほたるび", "bug", "status", null, null, 20, {
      generation: 3, snatchable: true, effect: { kind: "stage", target: "user", stat: "specialAttack", stages: 3 }, description: "自分の特攻を3段階上げる。",
    }),
    move("struggle-bug", "むしのていこう", "bug", "special", 50, 100, 20, {
      generation: 5, target: "allOpponents", effect: { kind: "damageAndStage", target: "target", stat: "specialAttack", stages: -1, chance: 1 },
      description: "相手全体を攻撃し、特攻を1段階下げる。",
    }),
    move("first-impression", "であいがしら", "bug", "physical", 90, 100, 10, {
      generation: 7, priority: 2, contact: true, effect: { kind: "conditionalDamage", condition: "usersFirstTurnOut" },
      description: "場に出た最初のターンだけ成功する優先度+2の技。",
    }),
    move("fell-stinger", "とどめばり", "bug", "physical", 50, 100, 25, {
      generation: 6, contact: true, effect: { kind: "damageAndStageOnKo", target: "user", stat: "attack", stages: 3 },
      description: "この技で相手を倒すと自分の攻撃が3段階上がる。",
    }),
    move("pollen-puff", "かふんだんご", "bug", "special", 90, 100, 15, {
      generation: 7, target: "oneAny", effect: { kind: "damageOrHealAlly", allyMaxHpRatio: 0.5 },
      description: "敵には攻撃し、味方を対象にした場合は最大HPの1/2を回復する。",
    }),
    move("breaking-swipe", "ワイドブレーカー", "dragon", "physical", 60, 100, 15, {
      generation: 8, target: "allOpponents", contact: true, effect: { kind: "damageAndStage", target: "target", stat: "attack", stages: -1, chance: 1 },
      description: "相手全体を攻撃し、攻撃を1段階下げる。",
    }),
  ];

  const MOVES = indexBy(MOVE_LIST, "id");
  const MOVES_BY_NAME = indexBy(MOVE_LIST, "name");

  function pokemon(id, name, typeIds, baseStats, abilities, moveNames) {
    const moveIds = moveNames.map((moveName) => {
      const moveData = MOVES_BY_NAME[moveName];
      if (!moveData) throw new Error(`${name} の技「${moveName}」が技データにありません。`);
      return moveData.id;
    });
    return deepFreeze({
      id,
      name,
      typeIds,
      types: typeIds.map((typeId) => TYPES[typeId]),
      baseStats,
      baseStatTotal: Object.values(baseStats).reduce((sum, stat) => sum + stat, 0),
      abilities,
      moveIds,
      moves: moveNames,
    });
  }

  const POKEMON_LIST = [
    pokemon("takasugi-yuki", "高杉 悠希", ["water", "poison"],
      { hp: 93, attack: 95, defense: 92, specialAttack: 95, specialDefense: 95, speed: 85 },
      ["ひとでなし", "どくくぐつ", "トレース"],
      ["どくどく", "アシッドボム", "だくりゅう", "クイックターン", "じこさいせい", "どろかけ", "アクアブレイク", "どくづき", "まもる", "みがわり", "ダストシュート", "ヘドロウェーブ", "ヘドロばくだん", "とける", "たくわえる", "くろいきり", "どくびし", "あまごい", "トーチカ", "ひやみず", "ねむる", "なげつける", "とびかかる", "りゅうせいぐん", "れいとうビーム"]),
    pokemon("takahashi-jun", "高橋 潤", ["fairy", "normal"],
      { hp: 108, attack: 112, defense: 100, specialAttack: 78, specialDefense: 90, speed: 112 },
      ["きょううん", "さいせいりょく", "いかく"],
      ["すてみタックル", "じゃれつく", "じこさいせい", "アイアンヘッド", "まもる", "みがわり", "アンコール", "ハイパーボイス", "はらだいこ", "バトンタッチ", "おいわい", "ほおばる", "たくわえる", "のみこむ", "こうそくいどう", "スピードスワップ", "こうそくスピン", "はたく", "ねむる"]),
    pokemon("takeshige-soma", "竹重 颯真", ["electric", "rock"],
      { hp: 95, attack: 115, defense: 115, specialAttack: 40, specialDefense: 88, speed: 67 },
      ["どんかん", "てんねん", "テクニシャン"],
      ["ストーンエッジ", "ワイルドボルト", "じゅうでん", "アイアンヘッド", "じならし", "のろい", "まもる", "みがわり", "ころがる", "まるくなる", "じたんだ", "ほうでん", "ほっぺすりすり", "ステルスロック", "でんじは", "きんぞくおん", "エレキフィールド", "おいわい", "ゲップ", "ねむる", "もろはのずつき"]),
    pokemon("tanifuji-shoki", "谷藤 匠希", ["psychic", "flying"],
      { hp: 98, attack: 92, defense: 95, specialAttack: 110, specialDefense: 100, speed: 75 },
      ["たんじゅん", "マイペース", "マジックミラー"],
      ["サイコノイズ", "エアスラッシュ", "サイコキネシス", "ドレインキッス", "はねやすめ", "わるだくみ", "いやなおと", "おいかぜ", "まもる", "みがわり", "アンコール", "ハイパーボイス", "どわすれ", "ぼうふう", "はねる", "ラスターパージ", "ひかりのかべ", "ねむる", "さむいギャグ", "ゲップ"]),
    pokemon("natsumi-soma", "夏海 颯真", ["dark", "psychic"],
      { hp: 70, attack: 62, defense: 73, specialAttack: 112, specialDefense: 60, speed: 103 },
      ["ぜったいねむり", "ぎゃくじょう", "ねんちゃく"],
      ["あくのはどう", "ステルスロック", "サイコキネシス", "わるだくみ", "まもる", "みがわり", "ちょうはつ", "さいみんじゅつ", "ねごと", "トリックルーム", "でんじは", "トリック", "みちづれ", "あくび", "ねむる", "シャドーボール", "ふいうち", "ワイドブレーカー", "はいすいのじん", "かみくだく"]),
    pokemon("yoshimoto-soshi", "吉本 綜司", ["bug", "ground"],
      { hp: 80, attack: 84, defense: 70, specialAttack: 77, specialDefense: 64, speed: 96 },
      ["カブトアーマー", "ふくがん", "すなおこし"],
      ["むしのさざめき", "だいちのちから", "とんぼがえり", "ちょうのまい", "あなをほる", "とびかかる", "とんぼがえり", "どろかけ", "メガホーン", "マッドショット", "まもる", "みがわり", "バトンタッチ", "じならし", "ねばねばネット", "エレキネット", "みをけずる", "おかたづけ", "ほたるび", "からげんき", "むしのていこう", "であいがしら", "とどめばり", "かふんだんご", "ワイドブレーカー", "はいすいのじん", "ステルスロック"]),
  ];

  const POKEMON = indexBy(POKEMON_LIST, "id");
  const POKEMON_BY_NAME = indexBy(POKEMON_LIST, "name");

  const FLING_POWER_OVERRIDES = Object.freeze({
    "heat-rock": 60, "life-orb": 30, "kings-rock": 30, "hard-stone": 100,
    "miracle-seed": 30, "iron-ball": 130, "black-glasses": 30, "black-belt": 30,
    "terrain-extender": 60, "rocky-helmet": 60, "damp-rock": 60, "binding-band": 30,
    "mystic-water": 30, magnet: 30, "sharp-beak": 50, "quick-claw": 80,
    "eject-button": 30, "icy-rock": 40, "never-melt-ice": 30, "poison-barb": 70,
    "normal-gem": null, "spell-tag": 30, "light-clay": 30, "scope-lens": 30,
    "twisted-spoon": 30, "metal-coat": 30, metronome: 30, charcoal: 30,
    "fairy-feather": null, "dragon-fang": 70,
  });

  function item(id, name, category, trigger, effect, description, consumable = false) {
    const flingPower = Object.hasOwn(FLING_POWER_OVERRIDES, id) ? FLING_POWER_OVERRIDES[id] : 10;
    const flingEffect = id === "kings-rock" ? { kind: "flinch" }
      : id === "poison-barb" ? { kind: "status", status: "poison" }
        : category.endsWith("Berry") || category === "resistBerry" ? { kind: "activateItemOnTarget" }
          : ["white-herb", "mental-herb"].includes(id) ? { kind: "activateItemOnTarget" }
            : null;
    return deepFreeze({ id, name, category, trigger, consumable, flingPower, flingEffect, effect, description });
  }

  function typeBoostItem(id, name, typeId, description) {
    return item(id, name, "typeBoost", "onCalculateMovePower", {
      kind: "movePowerMultiplier",
      moveTypeId: typeId,
      multiplier: 1.2,
    }, description);
  }

  function terrainSeed(id, name, terrain, stat, description) {
    return item(id, name, "terrainSeed", "onTerrainActive", {
      kind: "consumeAndRaiseStat",
      terrain,
      stat,
      stages: 1,
    }, description, true);
  }

  function resistBerry(id, name, typeId, superEffectiveOnly, description) {
    return item(id, name, "resistBerry", "onBeforeDamage", {
      kind: "typeDamageMultiplier",
      incomingTypeId: typeId,
      superEffectiveOnly,
      multiplier: 0.5,
      uses: 1,
    }, description, true);
  }

  const ITEM_LIST = [
    item("heat-rock", "あついいわ", "weatherExtender", "onWeatherStartedByHolder", {
      kind: "extendWeather", weather: "sun", turns: 8,
    }, "にほんばれ・ひでりによる晴れの持続を8ターンにする。"),
    item("life-orb", "いのちのたま", "damageBoost", "onDamageAndAfterAttack", {
      kind: "lifeOrb", damageMultiplier: 1.3, recoilMaxHpRatio: 0.1, minimumRecoil: 1,
    }, "攻撃技のダメージを1.3倍にし、攻撃後に最大HPの1/10の反動ダメージを受ける。"),
    terrainSeed("electric-seed", "エレキシード", "electric", "defense", "エレキフィールドの時に消費し、防御を1段階上げる。"),
    item("kings-rock", "おうじゃのしるし", "secondaryEffect", "onDamagingMoveHit", {
      kind: "addFlinchChance", chance: 0.1, requiresTargetAbleToFlinch: true,
    }, "攻撃技に10%のひるみ効果を追加する。"),
    item("big-root", "おおきなねっこ", "recoveryBoost", "onCalculateDrainOrPassiveDrain", {
      kind: "drainMultiplier", multiplier: 1.3, liquidOozeDamageMultiplier: 1.3,
      affectedEffects: ["aquaRing", "hornLeech", "gigaDrain", "leechLife", "absorb", "strengthSap", "oblivionWing", "drainingKiss", "drainPunch", "ingrain", "parabolicCharge", "megaDrain", "leechSeed", "dreamEater"],
    }, "吸収技・やどりぎのタネ・アクアリング・ねをはる等の回復量を1.3倍にする。ヘドロえきによるダメージも1.3倍。"),
    typeBoostItem("hard-stone", "かたいいし", "rock", "いわタイプの技の威力を1.2倍にする。"),
    item("focus-sash", "きあいのタスキ", "survival", "onBeforeFaintFromDamage", {
      kind: "surviveAtOneHp", requiresFullHp: true, worksOnOneHitKo: true, uses: 1,
    }, "HP満タン時、ひんしになる攻撃を受けてもHP1で耐える。1度でなくなる。", true),
    typeBoostItem("miracle-seed", "きせきのタネ", "grass", "くさタイプの技の威力を1.2倍にする。"),
    item("shed-shell", "きれいなぬけがら", "switching", "onCheckCanSwitch", {
      kind: "ignoreTrapping", ignoresMoveTraps: true, ignoresAbilityTraps: true,
    }, "技や特性による交代封じを無視して必ず交代できる。"),
    typeBoostItem("silver-powder", "ぎんのこな", "bug", "むしタイプの技の威力を1.2倍にする。"),
    item("iron-ball", "くろいてっきゅう", "statAndGrounding", "onCalculateSpeedAndGrounded", {
      kind: "ironBall", speedMultiplier: 0.5, forceGrounded: true, removesGroundImmunity: true,
    }, "素早さを半分にし、ひこうタイプやふゆう状態でもじめん技が当たるようにする。"),
    typeBoostItem("black-glasses", "くろいメガネ", "dark", "あくタイプの技の威力を1.2倍にする。"),
    typeBoostItem("black-belt", "くろおび", "fighting", "かくとうタイプの技の威力を1.2倍にする。"),
    terrainSeed("grassy-seed", "グラスシード", "grassy", "defense", "グラスフィールドの時に消費し、防御を1段階上げる。"),
    item("terrain-extender", "グランドコート", "terrainExtender", "onTerrainStartedByHolder", {
      kind: "extendTerrain", terrains: ["electric", "psychic", "grassy", "misty"], turns: 8,
    }, "使用者が展開したフィールドの持続を8ターンにする。"),
    item("wide-lens", "こうかくレンズ", "accuracy", "onCalculateAccuracy", {
      kind: "accuracyMultiplier", multiplier: 1.1,
    }, "使用する技の命中率を1.1倍にする。"),
    item("choice-scarf", "こだわりスカーフ", "choice", "onCalculateSpeedAndChooseMove", {
      kind: "choiceItem", stat: "speed", statMultiplier: 1.5, lockToFirstMove: true, ignoredWhileDynamaxed: true,
    }, "素早さを1.5倍にするが、最初に選んだ技しか使えなくなる。ダイマックス中は効果がない。"),
    item("rocky-helmet", "ゴツゴツメット", "contactPunish", "onHitByContactMove", {
      kind: "damageAttacker", attackerMaxHpRatio: 1 / 6,
    }, "接触技を受けた時、攻撃した相手にその最大HPの1/6のダメージを与える。"),
    terrainSeed("psychic-seed", "サイコシード", "psychic", "specialDefense", "サイコフィールドの時に消費し、特防を1段階上げる。"),
    item("smooth-rock", "さらさらいわ", "weatherExtender", "onWeatherStartedByHolder", {
      kind: "extendWeather", weather: "sandstorm", turns: 8,
    }, "すなあらし・すなおこしによる砂嵐の持続を8ターンにする。"),
    item("damp-rock", "しめったいわ", "weatherExtender", "onWeatherStartedByHolder", {
      kind: "extendWeather", weather: "rain", turns: 8,
    }, "あまごい・あめふらしによる雨の持続を8ターンにする。"),
    item("binding-band", "しめつけバンド", "residualDamage", "onBindingDamage", {
      kind: "bindingDamageRatio", targetMaxHpRatio: 1 / 6, normalRatio: 1 / 8,
      affectedMoves: ["whirlpool", "clamp", "thunderCage", "bind", "sandTomb", "snapTrap", "fireSpin", "wrap", "magmaStorm", "infestation"],
    }, "束縛技の毎ターンダメージを相手の最大HPの1/8から1/6にする。"),
    typeBoostItem("silk-scarf", "シルクのスカーフ", "normal", "ノーマルタイプの技の威力を1.2倍にする。"),
    item("white-herb", "しろいハーブ", "statRestore", "onTurnEndAfterStatDrop", {
      kind: "restoreNegativeStages", restoreToAtLeast: 0, uses: 1,
    }, "能力ランクが下がったターンの終了時に、下がったランクを元に戻す。1度でなくなる。", true),
    typeBoostItem("mystic-water", "しんぴのしずく", "water", "みずタイプの技の威力を1.2倍にする。"),
    typeBoostItem("magnet", "じしゃく", "electric", "でんきタイプの技の威力を1.2倍にする。"),
    typeBoostItem("sharp-beak", "するどいくちばし", "flying", "ひこうタイプの技の威力を1.2倍にする。"),
    item("quick-claw", "せんせいのツメ", "turnOrder", "onDetermineTurnOrder", {
      kind: "priorityBracketChance", chance: 0.2, bracket: "movePriorityThenQuickClawThenSpeed",
    }, "20%の確率で、技の優先度が同じ相手より素早さに関係なく先に行動する。"),
    item("expert-belt", "たつじんのおび", "damageBoost", "onCalculateDamage", {
      kind: "conditionalDamageMultiplier", condition: "superEffective", multiplier: 1.2,
    }, "効果抜群の技で与えるダメージを1.2倍にする。"),
    item("leftovers", "たべのこし", "passiveRecovery", "onTurnEnd", {
      kind: "heal", maxHpRatio: 1 / 16, minimum: 1,
    }, "毎ターン終了時に最大HPの1/16を回復する。"),
    item("eject-button", "だっしゅつボタン", "switching", "onAfterHitByMove", {
      kind: "forceHolderSwitch", chooser: "holder", uses: 1,
    }, "技を受けた後、持ち主を手持ちと交代させる。1度でなくなる。", true),
    item("muscle-band", "ちからのハチマキ", "damageBoost", "onCalculateMovePower", {
      kind: "categoryPowerMultiplier", categoryId: "physical", multiplier: 1.1,
    }, "物理技の威力を1.1倍にする。"),
    item("icy-rock", "つめたいいわ", "weatherExtender", "onWeatherStartedByHolder", {
      kind: "extendWeather", weather: "snow", turns: 8, sourceMoves: ["snowscape", "chillyReception"], sourceAbility: "snowWarning",
    }, "ゆきげしき・さむいギャグ・ゆきふらしによる雪の持続を8ターンにする。"),
    typeBoostItem("never-melt-ice", "とけないこおり", "ice", "こおりタイプの技の威力を1.2倍にする。"),
    typeBoostItem("poison-barb", "どくバリ", "poison", "どくタイプの技の威力を1.2倍にする。"),
    item("normal-gem", "ノーマルジュエル", "gem", "onBeforeNormalMove", {
      kind: "consumeForMovePower", moveTypeId: "normal", multiplier: 1.3, uses: 1,
    }, "ノーマルタイプの技を使う時に消費し、その技の威力を1.3倍にする。", true),
    typeBoostItem("spell-tag", "のろいのおふだ", "ghost", "ゴーストタイプの技の威力を1.2倍にする。"),
    item("bright-powder", "ひかりのこな", "evasion", "onCalculateIncomingAccuracy", {
      kind: "incomingAccuracyMultiplier", multiplier: 0.9,
    }, "相手が自分に使う技の命中率を0.9倍にする。"),
    item("light-clay", "ひかりのねんど", "screenExtender", "onScreenStartedByHolder", {
      kind: "extendScreen", screens: ["lightScreen", "reflect", "auroraVeil"], turns: 8,
    }, "ひかりのかべ・リフレクター・オーロラベールの持続を8ターンにする。"),
    item("scope-lens", "ピントレンズ", "critical", "onCalculateCriticalStage", {
      kind: "criticalStage", stages: 1,
    }, "急所ランクを1段階上げる。"),
    item("air-balloon", "ふうせん", "groundImmunity", "onGroundImmunityAndAfterHit", {
      kind: "airBalloon", grantsGroundImmunity: true, popsAfterDamagingHit: true,
    }, "じめん技を無効化する。攻撃技を受けると割れて効果を失う。", true),
    item("zoom-lens", "フォーカスレンズ", "accuracy", "onCalculateAccuracy", {
      kind: "conditionalAccuracyMultiplier", condition: "movesAfterTarget", multiplier: 1.2,
    }, "そのターン相手より後に行動する時、技の命中率を1.2倍にする。"),
    typeBoostItem("twisted-spoon", "まがったスプーン", "psychic", "エスパータイプの技の威力を1.2倍にする。"),
    terrainSeed("misty-seed", "ミストシード", "misty", "specialDefense", "ミストフィールドの時に消費し、特防を1段階上げる。"),
    typeBoostItem("metal-coat", "メタルコート", "steel", "はがねタイプの技の威力を1.2倍にする。"),
    item("metronome", "メトロノーム", "consecutiveMoveBoost", "onCalculateDamage", {
      kind: "sameMoveDamageMultiplier", initialMultiplier: 1, increment: 0.2, maximumMultiplier: 2, resetOnDifferentMove: true,
    }, "同じ技を連続で使うたびダメージ倍率が0.2ずつ上がる（最大2倍）。別の技でリセット。"),
    item("mental-herb", "メンタルハーブ", "volatileCure", "onInflictedWithMentalEffect", {
      kind: "cureVolatiles", conditions: ["encore", "torment", "healBlock", "taunt", "infatuation"], uses: 1,
    }, "アンコール・いちゃもん・かいふくふうじ・ちょうはつ・メロメロを治す。1度でなくなる。", true),
    typeBoostItem("charcoal", "もくたん", "fire", "ほのおタイプの技の威力を1.2倍にする。"),
    item("wise-glasses", "ものしりメガネ", "damageBoost", "onCalculateMovePower", {
      kind: "categoryPowerMultiplier", categoryId: "special", multiplier: 1.1,
    }, "特殊技の威力を1.1倍にする。"),
    typeBoostItem("soft-sand", "やわらかいすな", "ground", "じめんタイプの技の威力を1.2倍にする。"),
    typeBoostItem("fairy-feather", "ようせいのハネ", "fairy", "フェアリータイプの技の威力を1.2倍にする。"),
    typeBoostItem("dragon-fang", "りゅうのキバ", "dragon", "ドラゴンタイプの技の威力を1.2倍にする。"),
    item("red-card", "レッドカード", "forcedSwitch", "onAfterHitByOpponent", {
      kind: "forceAttackerSwitch", randomReplacement: true, requiresHolderSurvive: true, failsAgainstDynamax: true, uses: 1,
    }, "攻撃技を受けて生き残ると、相手をランダムな手持ちへ強制交代させる。1度でなくなる。", true),

    resistBerry("passho-berry", "イトケのみ", "water", true, "効果抜群のみず技のダメージを1度だけ半分にする。"),
    resistBerry("payapa-berry", "ウタンのみ", "psychic", true, "効果抜群のエスパー技のダメージを1度だけ半分にする。"),
    resistBerry("occa-berry", "オッカのみ", "fire", true, "効果抜群のほのお技のダメージを1度だけ半分にする。"),
    item("sitrus-berry", "オボンのみ", "healingBerry", "onHpAtOrBelowThreshold", {
      kind: "thresholdHeal", thresholdMaxHpRatio: 0.5, healMaxHpRatio: 0.25, uses: 1,
    }, "HPが最大HPの半分以下になると、最大HPの1/4を回復する。", true),
    item("chesto-berry", "カゴのみ", "statusBerry", "onStatusInflicted", {
      kind: "cureStatus", statuses: ["sleep"], uses: 1,
    }, "ねむり状態になると自分で治す。", true),
    resistBerry("kasib-berry", "カシブのみ", "ghost", true, "効果抜群のゴースト技のダメージを1度だけ半分にする。"),
    item("persim-berry", "キーのみ", "volatileBerry", "onConfusionInflicted", {
      kind: "cureVolatile", condition: "confusion", uses: 1,
    }, "混乱状態になると自分で治す。", true),
    item("cheri-berry", "クラボのみ", "statusBerry", "onStatusInflicted", {
      kind: "cureStatus", statuses: ["paralysis"], uses: 1,
    }, "まひ状態になると自分で治す。", true),
    resistBerry("shuca-berry", "シュカのみ", "ground", true, "効果抜群のじめん技のダメージを1度だけ半分にする。"),
    resistBerry("wacan-berry", "ソクノのみ", "electric", true, "効果抜群のでんき技のダメージを1度だけ半分にする。"),
    resistBerry("tanga-berry", "タンガのみ", "bug", true, "効果抜群のむし技のダメージを1度だけ半分にする。"),
    item("rawst-berry", "チーゴのみ", "statusBerry", "onStatusInflicted", {
      kind: "cureStatus", statuses: ["burn"], uses: 1,
    }, "やけど状態になると自分で治す。", true),
    item("aspear-berry", "ナナシのみ", "statusBerry", "onStatusInflicted", {
      kind: "cureStatus", statuses: ["freeze"], uses: 1,
    }, "こおり状態になると自分で治す。", true),
    resistBerry("colbur-berry", "ナモのみ", "dark", true, "効果抜群のあく技のダメージを1度だけ半分にする。"),
    resistBerry("haban-berry", "ハバンのみ", "dragon", true, "効果抜群のドラゴン技のダメージを1度だけ半分にする。"),
    resistBerry("coba-berry", "バコウのみ", "flying", true, "効果抜群のひこう技のダメージを1度だけ半分にする。"),
    resistBerry("kebia-berry", "ビアーのみ", "poison", true, "効果抜群のどく技のダメージを1度だけ半分にする。"),
    resistBerry("chilan-berry", "ホズのみ", "normal", false, "ノーマル技のダメージを1度だけ半分にする。"),
    item("pecha-berry", "モモンのみ", "statusBerry", "onStatusInflicted", {
      kind: "cureStatus", statuses: ["poison", "badPoison"], uses: 1,
    }, "どく・もうどく状態になると自分で治す。", true),
    resistBerry("yache-berry", "ヤチェのみ", "ice", true, "効果抜群のこおり技のダメージを1度だけ半分にする。"),
    resistBerry("chople-berry", "ヨプのみ", "fighting", true, "効果抜群のかくとう技のダメージを1度だけ半分にする。"),
    resistBerry("charti-berry", "ヨロギのみ", "rock", true, "効果抜群のいわ技のダメージを1度だけ半分にする。"),
    item("lum-berry", "ラムのみ", "statusBerry", "onStatusOrConfusionInflicted", {
      kind: "cureStatusOrVolatile", statuses: ["paralysis", "sleep", "poison", "badPoison", "burn", "freeze"], volatiles: ["confusion"], uses: 1,
    }, "状態異常または混乱状態になると自分で治す。", true),
    resistBerry("babiri-berry", "リリバのみ", "steel", true, "効果抜群のはがね技のダメージを1度だけ半分にする。"),
    resistBerry("rindo-berry", "リンドのみ", "grass", true, "効果抜群のくさ技のダメージを1度だけ半分にする。"),
    resistBerry("roseli-berry", "ロゼルのみ", "fairy", true, "効果抜群のフェアリー技のダメージを1度だけ半分にする。"),
  ];

  const ITEMS = indexBy(ITEM_LIST, "id");
  const ITEMS_BY_NAME = indexBy(ITEM_LIST, "name");

  // Only non-neutral matchups are listed. Missing pairs have a multiplier of 1.
  const TYPE_CHART = deepFreeze({
    normal: { rock: 0.5, ghost: 0, steel: 0.5 },
    fire: { fire: 0.5, water: 0.5, grass: 2, ice: 2, bug: 2, rock: 0.5, dragon: 0.5, steel: 2 },
    water: { fire: 2, water: 0.5, grass: 0.5, ground: 2, rock: 2, dragon: 0.5 },
    electric: { water: 2, electric: 0.5, grass: 0.5, ground: 0, flying: 2, dragon: 0.5 },
    grass: { fire: 0.5, water: 2, grass: 0.5, poison: 0.5, ground: 2, flying: 0.5, bug: 0.5, rock: 2, dragon: 0.5, steel: 0.5 },
    ice: { fire: 0.5, water: 0.5, grass: 2, ice: 0.5, ground: 2, flying: 2, dragon: 2, steel: 0.5 },
    fighting: { normal: 2, ice: 2, poison: 0.5, flying: 0.5, psychic: 0.5, bug: 0.5, rock: 2, ghost: 0, dark: 2, steel: 2, fairy: 0.5 },
    poison: { grass: 2, poison: 0.5, ground: 0.5, rock: 0.5, ghost: 0.5, steel: 0, fairy: 2 },
    ground: { fire: 2, electric: 2, grass: 0.5, poison: 2, flying: 0, bug: 0.5, rock: 2, steel: 2 },
    flying: { electric: 0.5, grass: 2, fighting: 2, bug: 2, rock: 0.5, steel: 0.5 },
    psychic: { fighting: 2, poison: 2, psychic: 0.5, dark: 0, steel: 0.5 },
    bug: { fire: 0.5, grass: 2, fighting: 0.5, poison: 0.5, flying: 0.5, psychic: 2, ghost: 0.5, dark: 2, steel: 0.5, fairy: 0.5 },
    rock: { fire: 2, ice: 2, fighting: 0.5, ground: 0.5, flying: 2, bug: 2, steel: 0.5 },
    ghost: { normal: 0, psychic: 2, ghost: 2, dark: 0.5 },
    dragon: { dragon: 2, steel: 0.5, fairy: 0 },
    dark: { fighting: 0.5, psychic: 2, ghost: 2, dark: 0.5, fairy: 0.5 },
    steel: { fire: 0.5, water: 0.5, electric: 0.5, ice: 2, rock: 2, steel: 0.5, fairy: 2 },
    fairy: { fire: 0.5, fighting: 2, poison: 0.5, dragon: 2, dark: 2, steel: 0.5 },
  });

  function nature(id, name, increasedStat = null, decreasedStat = null) {
    return deepFreeze({ id, name, increasedStat, decreasedStat });
  }

  const NATURE_LIST = [
    nature("hardy", "がんばりや"), nature("lonely", "さみしがり", "attack", "defense"),
    nature("brave", "ゆうかん", "attack", "speed"), nature("adamant", "いじっぱり", "attack", "specialAttack"),
    nature("naughty", "やんちゃ", "attack", "specialDefense"), nature("bold", "ずぶとい", "defense", "attack"),
    nature("docile", "すなお"), nature("relaxed", "のんき", "defense", "speed"),
    nature("impish", "わんぱく", "defense", "specialAttack"), nature("lax", "のうてんき", "defense", "specialDefense"),
    nature("timid", "おくびょう", "speed", "attack"), nature("hasty", "せっかち", "speed", "defense"),
    nature("serious", "まじめ"), nature("jolly", "ようき", "speed", "specialAttack"),
    nature("naive", "むじゃき", "speed", "specialDefense"), nature("modest", "ひかえめ", "specialAttack", "attack"),
    nature("mild", "おっとり", "specialAttack", "defense"), nature("quiet", "れいせい", "specialAttack", "speed"),
    nature("bashful", "てれや"), nature("rash", "うっかりや", "specialAttack", "specialDefense"),
    nature("calm", "おだやか", "specialDefense", "attack"), nature("gentle", "おとなしい", "specialDefense", "defense"),
    nature("sassy", "なまいき", "specialDefense", "speed"), nature("careful", "しんちょう", "specialDefense", "specialAttack"),
    nature("quirky", "きまぐれ"),
  ];
  const NATURES = indexBy(NATURE_LIST, "id");
  const NATURES_BY_NAME = indexBy(NATURE_LIST, "name");

  function ability(id, name, effects, description) {
    return deepFreeze({ id, name, effects, description });
  }

  const ABILITY_LIST = [
    ability("merciless", "ひとでなし", [{ kind: "alwaysCritical", condition: "targetPoisoned" }], "どく・もうどく状態の相手への攻撃が必ず急所に当たる。"),
    ability("poison-puppeteer", "どくくぐつ", [{ kind: "confuseWhenUserPoisonsTarget" }], "自分の技で相手をどく・もうどく状態にした時、その相手を混乱させる。"),
    ability("trace", "トレース", [{ kind: "copyOpponentAbilityOnEntry" }], "場に出た時、相手の特性をコピーする。"),
    ability("super-luck", "きょううん", [{ kind: "criticalStage", stages: 1 }], "急所ランクが1段階上がる。"),
    ability("regenerator", "さいせいりょく", [{ kind: "healOnSwitchOut", maxHpRatio: 1 / 3 }], "手持ちに戻る時、最大HPの1/3を回復する。"),
    ability("intimidate", "いかく", [{ kind: "lowerOpponentStatOnEntry", stat: "attack", stages: -1 }], "場に出た時、相手の攻撃を1段階下げる。"),
    ability("oblivious", "どんかん", [{ kind: "mentalImmunity", conditions: ["infatuation", "taunt", "intimidate"] }], "メロメロ・ちょうはつ・いかくを無効化する。"),
    ability("unaware", "てんねん", [{ kind: "ignoreOpponentStagesDuringDamage" }], "ダメージ計算時、相手の能力ランク変化を無視する。"),
    ability("technician", "テクニシャン", [{ kind: "lowPowerMoveMultiplier", maximumPower: 60, multiplier: 1.5 }], "威力60以下の技の威力を1.5倍にする。"),
    ability("simple", "たんじゅん", [{ kind: "stageChangeMultiplier", multiplier: 2 }], "自分への能力ランク変化量が2倍になる。"),
    ability("own-tempo", "マイペース", [{ kind: "volatileImmunity", conditions: ["confusion", "intimidate"] }], "混乱状態といかくを無効化する。"),
    ability("magic-bounce", "マジックミラー", [{ kind: "reflectStatusMoves" }], "相手から受ける反射可能な変化技を相手に跳ね返す。"),
    ability("comatose", "ぜったいねむり", [{ kind: "comatose" }, { kind: "majorStatusImmunity" }], "常にねむり状態として扱われるが行動でき、他の状態異常にならない。"),
    ability("berserk", "ぎゃくじょう", [{ kind: "raiseStatWhenCrossingHalfHp", stat: "specialAttack", stages: 1 }], "攻撃でHPが半分以下になった時、特攻が1段階上がる。"),
    ability("sticky-hold", "ねんちゃく", [{ kind: "preventHeldItemRemoval" }], "持ち物を奪われたり交換されたりしない。"),
    ability("battle-armor", "カブトアーマー", [{ kind: "preventCriticalHits" }], "相手の攻撃が急所に当たらない。"),
    ability("compound-eyes", "ふくがん", [{ kind: "accuracyMultiplier", multiplier: 1.3 }], "使用する技の命中率を1.3倍にする。"),
    ability("sand-stream", "すなおこし", [{ kind: "weatherOnEntry", weather: "sandstorm", turns: 5 }], "場に出た時、天気を5ターン砂嵐にする。"),
  ];
  const ABILITIES = indexBy(ABILITY_LIST, "id");
  const ABILITIES_BY_NAME = indexBy(ABILITY_LIST, "name");

  const BATTLE_RULES = deepFreeze({
    format: "single-6-pick-3",
    level: 50,
    partySize: 6,
    selectionSize: 3,
    movesPerPokemon: 4,
    defaultIv: 31,
    maxEvPerStat: 252,
    maxTotalEv: 510,
    speciesClause: true,
    itemClause: true,
    maxStatStage: 6,
    minStatStage: -6,
  });

  const GAME_DATA = deepFreeze({
    schemaVersion: 1,
    battleRuleset: "scarlet-violet",
    source: {
      pokemon: "docs/pokemon_data.csv",
      items: "docs/item.md",
      moveParameters: "PokeAPI moves.csv（2026-09-09参照）",
    },
    types: TYPES,
    moveCategories: MOVE_CATEGORIES,
    moveTargets: MOVE_TARGETS,
    typeChart: TYPE_CHART,
    natures: NATURES,
    naturesByName: NATURES_BY_NAME,
    natureList: NATURE_LIST,
    abilities: ABILITIES,
    abilitiesByName: ABILITIES_BY_NAME,
    abilityList: ABILITY_LIST,
    battleRules: BATTLE_RULES,
    pokemon: POKEMON,
    pokemonByName: POKEMON_BY_NAME,
    pokemonList: POKEMON_LIST,
    moves: MOVES,
    movesByName: MOVES_BY_NAME,
    moveList: MOVE_LIST,
    items: ITEMS,
    itemsByName: ITEMS_BY_NAME,
    itemList: ITEM_LIST,
  });

  // Browser globals.  The upper-case aliases keep future scripts concise and
  // make it clear that these are immutable master-data collections.
  global.GAME_DATA = GAME_DATA;
  global.POKEMON_DATA = POKEMON;
  global.MOVE_DATA = MOVES;
  global.ITEM_DATA = ITEMS;
  global.ABILITY_DATA = ABILITIES;
  global.gameData = GAME_DATA;
  global.pokemonData = POKEMON_LIST;
  global.moveData = MOVE_LIST;
  global.itemData = ITEM_LIST;

  // CommonJS export makes data validation possible without a browser.
  if (typeof module !== "undefined" && module.exports) {
    module.exports = GAME_DATA;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
