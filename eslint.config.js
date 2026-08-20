// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");
const globals = require("globals");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
  },
  {
    // The backend and its tests are plain CommonJS running on Node, not
    // React Native. Without this, every `__dirname`/`process`/`require` is
    // reported as an undefined global — which is why `npx eslint` never
    // reached zero errors even though nothing was actually wrong.
    //
    // Bewusst die vollständige Liste aus `globals` statt einer eigenen:
    // eine handgepflegte Aufzählung ist erst bei `Buffer` wieder aufgelaufen,
    // und der nächste Node-Global (URL, structuredClone, …) würde denselben
    // Fehlalarm auslösen.
    files: ["server/**/*.js", "tests/**/*.js", "scripts/**/*.js"],
    languageOptions: {
      sourceType: "commonjs",
      globals: globals.node,
    },
  },
]);
