"use strict";

const redisKey = "feature-key";
const redisChannel = "feature-channel";

const FEATURE = {
  A: "/test/feature_a",
  AA: "/test/feature_aa",
  B: "/test/feature_b",
  C: "/test/feature_c",
  D: "/test/feature_d",
  E: "/test/feature_e",
  F: "/test/feature_f",
  G: "/test/feature_g",
  H: "/test/feature_h",
};

const mockConfig = {
  [FEATURE.A]: {
    fallbackValue: false,
    type: "boolean",
  },
  [FEATURE.AA]: {
    fallbackValue: false,
    type: "boolean",
    validations: [{ scopes: ["tenant", "user"] }],
  },
  [FEATURE.B]: {
    fallbackValue: 1,
    type: "number",
  },
  [FEATURE.C]: {
    fallbackValue: "best",
    type: "string",
  },
  [FEATURE.D]: {
    fallbackValue: true,
    type: "boolean",
    validations: [{ regex: "^(?:true)$" }],
  },
  [FEATURE.E]: {
    fallbackValue: 5,
    type: "number",
    validations: [{ scopes: ["component", "layer", "tenant"] }, { regex: "^\\d{1}$" }],
  },
  [FEATURE.F]: {
    fallbackValue: "best",
    type: "string",
    validations: [{ regex: "^(?:best|worst)$" }],
  },
  [FEATURE.G]: {
    active: false,
    fallbackValue: "activeTest",
    type: "string",
  },
  [FEATURE.H]: {
    fallbackValue: "appUrlTest",
    type: "string",
    appUrl: "\\.cfapps\\.sap\\.hana\\.ondemand\\.com$",
  },
};

module.exports = {
  FEATURE,
  mockConfig,
  redisKey,
  redisChannel,
};
