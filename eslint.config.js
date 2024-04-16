"use strict";

const globals = require("globals");
const js = require("@eslint/js");

const jestPlugin = require("eslint-plugin-jest");
const configPrettier = require("eslint-config-prettier");

// https://eslint.org/docs/latest/use/configure/configuration-files
// https://eslint.org/docs/rules/
module.exports = [
  {
    ignores: ["**/node_modules/", "**/temp/", "**/docs/vendor/", "**/docs/_site/"],
  },
  js.configs.recommended,
  jestPlugin.configs["flat/recommended"],
  configPrettier,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: {
        ...globals.node,
        ...globals.es2021,
      },
    },
    rules: {
      "no-unused-vars": [
        "error",
        {
          // argsIgnorePattern: "req|res|next",
          caughtErrors: "none",
        },
      ],
      "no-eval": ["error"],
      "no-implied-eval": ["error"],
      "no-console": ["error"],
      strict: ["error"],
      "no-constant-condition": [
        "error",
        {
          checkLoops: false,
        },
      ],
      // NOTE: the jest intended way of adding __mocks__ in the production code structure is not an option for me and
      //   this is the best alternative I could find.
      "jest/no-mocks-import": ["off"],
    },
  },
];
