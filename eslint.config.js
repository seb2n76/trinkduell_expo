// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

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
    files: ["server/**/*.js", "tests/**/*.js"],
    languageOptions: {
      sourceType: "commonjs",
      globals: {
        __dirname: "readonly",
        __filename: "readonly",
        console: "readonly",
        fetch: "readonly",
        module: "writable",
        process: "readonly",
        require: "readonly",
        setInterval: "readonly",
        setTimeout: "readonly",
      },
    },
  },
]);
