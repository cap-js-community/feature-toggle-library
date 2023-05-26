"use strict";

const featuresKey = "feature-key";
const featuresChannel = "feature-channel";

const FEATURE = {
  A: "test/feature_a",
  B: "test/feature_b",
  C: "test/feature_c",
  D: "test/feature_d",
  E: "test/feature_e",
  F: "test/feature_f",
  G: "test/feature_g",
  H: "test/feature_h",
};

const mockConfig = {
  [FEATURE.A]: {
    fallbackValue: false,
    type: "boolean",
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
    validation: "^(?:true)$",
  },
  [FEATURE.E]: {
    fallbackValue: 5,
    type: "number",
    validation: "^\\d{1}$",
  },
  [FEATURE.F]: {
    fallbackValue: "best",
    type: "string",
    validation: "^(?:best|worst)$",
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
  featuresKey,
  featuresChannel,
};
