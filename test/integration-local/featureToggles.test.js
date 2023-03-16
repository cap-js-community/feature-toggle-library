"use strict";

const { singleton } = require("../../src/index");
const featureTogglesModule = require("../../src/featureToggles");
const redisWrapper = require("../../src/redisWrapper");

const { initializeFeatureValues, getFeatureValues, getFeatureStates, getFeatureValue, changeFeatureValue } = singleton;

const featureTogglesLoggerSpy = {
  info: jest.spyOn(featureTogglesModule._._getLogger(), "info"),
  warning: jest.spyOn(featureTogglesModule._._getLogger(), "warning"),
  error: jest.spyOn(featureTogglesModule._._getLogger(), "error"),
};

const redisWrapperLoggerSpy = {
  info: jest.spyOn(redisWrapper._._getLogger(), "info"),
  warning: jest.spyOn(redisWrapper._._getLogger(), "warning"),
  error: jest.spyOn(redisWrapper._._getLogger(), "error"),
};

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

const config = {
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

const featureValues = Object.fromEntries(
  Object.entries(config).map(([key, { fallbackValue }]) => [key, fallbackValue])
);

describe("local integration test", () => {
  beforeAll(async () => {
    await initializeFeatureValues({ config });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("getFeatureValues, getFeatureStates", async () => {
    const featureValuesResult = await getFeatureValues();
    const featureStatesResult = await getFeatureStates();

    expect(featureValuesResult).toStrictEqual(featureValues);

    expect(Object.keys(featureStatesResult)).toEqual(Object.keys(config));
    Object.entries(featureStatesResult).forEach(([key, featureState]) => {
      expect(featureState.config.TYPE).toEqual(config[key].type);
      expect(featureState.fallbackValue).toEqual(config[key].fallbackValue);
    });

    expect(featureStatesResult).toMatchSnapshot();

    expect(redisWrapperLoggerSpy.info.mock.calls).toMatchSnapshot();
    expect(redisWrapperLoggerSpy.warning.mock.calls).toMatchSnapshot();
    expect(redisWrapperLoggerSpy.error.mock.calls).toMatchSnapshot();

    expect(featureTogglesLoggerSpy.info.mock.calls).toMatchSnapshot();
    expect(featureTogglesLoggerSpy.warning.mock.calls).toMatchSnapshot();
    expect(featureTogglesLoggerSpy.error.mock.calls).toMatchSnapshot();
  });

  it("getFeatureValue, changeFeatureValue", async () => {
    const oldValue = getFeatureValue(FEATURE.E);

    const allowedNewValue = 9;
    const forbiddenNewValue = 10;

    const failResult = await changeFeatureValue(FEATURE.E, forbiddenNewValue);
    expect(getFeatureValue(FEATURE.E)).toEqual(oldValue);

    const successResult = await changeFeatureValue(FEATURE.E, allowedNewValue);
    expect(getFeatureValue(FEATURE.E)).toEqual(allowedNewValue);

    expect(failResult).toMatchInlineSnapshot(`
      [
        {
          "errorMessage": "value "{0}" does not match validation regular expression {1}",
          "errorMessageValues": [
            10,
            "^\\d{1}$",
          ],
          "key": "test/feature_e",
        },
      ]
    `);
    expect(successResult).toEqual(undefined);

    expect(redisWrapperLoggerSpy.info.mock.calls).toMatchSnapshot();
    expect(redisWrapperLoggerSpy.warning.mock.calls).toMatchSnapshot();
    expect(redisWrapperLoggerSpy.error.mock.calls).toMatchSnapshot();

    expect(featureTogglesLoggerSpy.info.mock.calls).toMatchSnapshot();
    expect(featureTogglesLoggerSpy.warning.mock.calls).toMatchSnapshot();
    expect(featureTogglesLoggerSpy.error.mock.calls).toMatchSnapshot();
  });
});
