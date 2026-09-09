/**
 * Firebase Console > Project settings > Your apps で表示される値を設定します。
 * FirebaseのWeb APIキーは公開用識別子です。アクセス制御はdatabase.rules.jsonで行います。
 */
(function initialiseFirebaseConfig(global) {
  "use strict";

  const CONFIG_KEYS = ["apiKey", "authDomain", "databaseURL", "projectId", "appId"];
  const BUNDLED_CONFIG = Object.freeze({
    apiKey: "AIzaSyAnZ_5BxYUltzBvvx4Hxo9YxK-QnCgoqJg",
    authDomain: "shintomipoket.firebaseapp.com",
    databaseURL: "https://shintomipoket-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "shintomipoket",
    appId: "1:67647610161:web:91bc1730e3fc54d4cee410",
  });

  function cleanFirebaseConfig(config = {}) {
    return Object.fromEntries(CONFIG_KEYS.map((key) => [key, String(config?.[key] || "").trim()]));
  }

  function hasCompleteFirebaseConfig(config) {
    const cleaned = cleanFirebaseConfig(config);
    return CONFIG_KEYS.every((key) => Boolean(cleaned[key]));
  }

  function resolveFirebaseConfig(defaultConfig, savedConfig) {
    const defaults = cleanFirebaseConfig(defaultConfig);
    const saved = cleanFirebaseConfig(savedConfig);
    // A partial/blank value left in origin-specific localStorage must never
    // erase the complete configuration bundled with the published site.
    return hasCompleteFirebaseConfig(saved) ? { ...defaults, ...saved } : defaults;
  }

  const injectedConfig = hasCompleteFirebaseConfig(global.FIREBASE_CONFIG)
    ? global.FIREBASE_CONFIG
    : BUNDLED_CONFIG;
  global.FIREBASE_CONFIG = Object.freeze(resolveFirebaseConfig(BUNDLED_CONFIG, injectedConfig));
  global.resolveFirebaseConfig = resolveFirebaseConfig;
  global.hasCompleteFirebaseConfig = hasCompleteFirebaseConfig;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { BUNDLED_CONFIG, cleanFirebaseConfig, hasCompleteFirebaseConfig, resolveFirebaseConfig };
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
