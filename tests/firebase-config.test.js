const test = require("node:test");
const assert = require("node:assert/strict");

const {
  BUNDLED_CONFIG,
  hasCompleteFirebaseConfig,
  resolveFirebaseConfig,
} = require("../firebase-config.js");

test("blank saved values cannot erase the bundled GitHub Pages config", () => {
  const staleSavedConfig = {
    apiKey: "",
    authDomain: "",
    databaseURL: "",
    projectId: "",
    appId: "",
  };
  assert.equal(hasCompleteFirebaseConfig(staleSavedConfig), false);
  assert.deepEqual(resolveFirebaseConfig(BUNDLED_CONFIG, staleSavedConfig), BUNDLED_CONFIG);
});

test("a complete manually saved config overrides the bundled config", () => {
  const saved = {
    apiKey: "manual-key",
    authDomain: "manual.firebaseapp.com",
    databaseURL: "https://manual.firebasedatabase.app",
    projectId: "manual",
    appId: "manual-app",
  };
  assert.deepEqual(resolveFirebaseConfig(BUNDLED_CONFIG, saved), saved);
});
