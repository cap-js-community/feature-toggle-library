"use strict";

//NOTE: if a local redis is running when these integration tests are performed, then they will not work. we rely on
// and test only the local mode here.

let featureTogglesLoggerSpy, redisWrapperLoggerSpy;
let initializeFeatureValues,
  getFeatureStates,
  getFeatureValue,
  changeFeatureValue,
  resetFeatureValue,
  registerFeatureValueValidation,
  validateFeatureValue;

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

describe("local integration test", () => {
  beforeEach(async () => {
    jest.resetModules();
    ({
      singleton: {
        initializeFeatureValues,
        getFeatureStates,
        getFeatureValue,
        changeFeatureValue,
        resetFeatureValue,
        registerFeatureValueValidation,
        validateFeatureValue,
      },
    } = require("../../src/"));

    const featureTogglesModule = require("../../src/featureToggles");
    featureTogglesLoggerSpy = {
      info: jest.spyOn(featureTogglesModule._._getLogger(), "info"),
      warning: jest.spyOn(featureTogglesModule._._getLogger(), "warning"),
      error: jest.spyOn(featureTogglesModule._._getLogger(), "error"),
    };

    const redisWrapper = require("../../src/redisWrapper");
    redisWrapperLoggerSpy = {
      info: jest.spyOn(redisWrapper._._getLogger(), "info"),
      warning: jest.spyOn(redisWrapper._._getLogger(), "warning"),
      error: jest.spyOn(redisWrapper._._getLogger(), "error"),
    };

    await initializeFeatureValues({ config });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("getFeatureValues, getFeatureStates", async () => {
    const featureStatesResult = await getFeatureStates();

    expect(Object.keys(featureStatesResult)).toEqual(Object.keys(config));
    Object.entries(featureStatesResult).forEach(([key, featureState]) => {
      expect(featureState.config.TYPE).toEqual(config[key].type);
      expect(featureState.fallbackValue).toEqual(config[key].fallbackValue);
    });

    expect(featureStatesResult).toMatchSnapshot();

    expect(redisWrapperLoggerSpy.info.mock.calls).toMatchInlineSnapshot(`[]`);
    expect(redisWrapperLoggerSpy.warning.mock.calls).toMatchInlineSnapshot(`
      [
        [
          "%s | %O",
          "caught error event: connect ECONNREFUSED 127.0.0.1:6379",
          {
            "clientName": "main",
          },
        ],
      ]
    `);
    expect(featureTogglesLoggerSpy.error).toHaveBeenCalledTimes(0);

    expect(featureTogglesLoggerSpy.info.mock.calls).toMatchInlineSnapshot(`
      [
        [
          "finished initialization with %i feature toggle%s with %s",
          8,
          "s",
          "NO_REDIS",
        ],
      ]
    `);
    expect(featureTogglesLoggerSpy.warning.mock.calls).toMatchInlineSnapshot(`
      [
        [
          "error during initialization, using fallback values",
        ],
      ]
    `);
    expect(featureTogglesLoggerSpy.error).toHaveBeenCalledTimes(0);
  });

  it("getFeatureValue, changeFeatureValue without scopes", async () => {
    const oldValue = getFeatureValue(FEATURE.E);

    const newValue = 9;
    const forbiddenNewValue = 10;

    expect(await changeFeatureValue(FEATURE.E, forbiddenNewValue)).toMatchSnapshot();
    expect(getFeatureValue(FEATURE.E)).toEqual(oldValue);

    expect(await changeFeatureValue(FEATURE.E, newValue)).toBeUndefined();
    expect(getFeatureStates()[FEATURE.E].stateScopedValues).toMatchInlineSnapshot(`
      {
        "//": 9,
      }
    `);
    expect(getFeatureValue(FEATURE.E)).toEqual(newValue);

    expect(redisWrapperLoggerSpy.info.mock.calls).toMatchInlineSnapshot(`[]`);
    expect(redisWrapperLoggerSpy.warning.mock.calls).toMatchSnapshot();
    expect(redisWrapperLoggerSpy.error.mock.calls).toMatchInlineSnapshot(`[]`);
    expect(featureTogglesLoggerSpy.info.mock.calls).toMatchInlineSnapshot(`
      [
        [
          "finished initialization with %i feature toggle%s with %s",
          8,
          "s",
          "NO_REDIS",
        ],
      ]
    `);
    expect(featureTogglesLoggerSpy.warning.mock.calls).toMatchInlineSnapshot(`
      [
        [
          "error during initialization, using fallback values",
        ],
        [
          "error during change remote feature values, switching to local update",
        ],
      ]
    `);
    expect(featureTogglesLoggerSpy.error.mock.calls).toMatchInlineSnapshot(`[]`);
  });

  it("getFeatureValue, changeFeatureValue with scopes", async () => {
    const rootOldValue = getFeatureValue(FEATURE.E);

    const scopeMap = { component: "c1", tenant: "t1" };
    const subScopeMap = { layer: "l1", component: "c1", tenant: "t1" };
    const superScopeMap = { tenant: "t1" };

    const rootNewValue = 1;
    const superScopeNewValue = 2;
    const scopeNewValue = 3;
    const subScopeNewValue = 4;
    const forbiddenNewValue = 10;

    expect(await changeFeatureValue(FEATURE.E, forbiddenNewValue, scopeMap)).toMatchSnapshot();
    expect(getFeatureStates()[FEATURE.E].stateScopedValues).toMatchInlineSnapshot(`undefined`);
    expect(getFeatureValue(FEATURE.E, scopeMap)).toEqual(rootOldValue);
    expect(getFeatureValue(FEATURE.E, subScopeMap)).toEqual(rootOldValue);
    expect(getFeatureValue(FEATURE.E, superScopeMap)).toEqual(rootOldValue);
    expect(getFeatureValue(FEATURE.E)).toEqual(rootOldValue);

    expect(await changeFeatureValue(FEATURE.E, scopeNewValue, scopeMap)).toBeUndefined();
    expect(getFeatureStates()[FEATURE.E].stateScopedValues).toMatchInlineSnapshot(`
      {
        "component::c1##tenant::t1": 3,
      }
    `);
    expect(getFeatureValue(FEATURE.E, subScopeMap)).toEqual(scopeNewValue);
    expect(getFeatureValue(FEATURE.E, scopeMap)).toEqual(scopeNewValue);
    expect(getFeatureValue(FEATURE.E, superScopeMap)).toEqual(rootOldValue);
    expect(getFeatureValue(FEATURE.E)).toEqual(rootOldValue);

    expect(await changeFeatureValue(FEATURE.E, superScopeNewValue, superScopeMap)).toBeUndefined();
    expect(getFeatureStates()[FEATURE.E].stateScopedValues).toMatchInlineSnapshot(`
      {
        "component::c1##tenant::t1": 3,
        "tenant::t1": 2,
      }
    `);
    expect(getFeatureValue(FEATURE.E, subScopeMap)).toEqual(scopeNewValue);
    expect(getFeatureValue(FEATURE.E, scopeMap)).toEqual(scopeNewValue);
    expect(getFeatureValue(FEATURE.E, superScopeMap)).toEqual(superScopeNewValue);
    expect(getFeatureValue(FEATURE.E)).toEqual(rootOldValue);

    expect(await changeFeatureValue(FEATURE.E, subScopeNewValue, subScopeMap)).toBeUndefined();
    expect(getFeatureStates()[FEATURE.E].stateScopedValues).toMatchInlineSnapshot(`
      {
        "component::c1##layer::l1##tenant::t1": 4,
        "component::c1##tenant::t1": 3,
        "tenant::t1": 2,
      }
    `);
    expect(getFeatureValue(FEATURE.E, subScopeMap)).toEqual(subScopeNewValue);
    expect(getFeatureValue(FEATURE.E, scopeMap)).toEqual(scopeNewValue);
    expect(getFeatureValue(FEATURE.E, superScopeMap)).toEqual(superScopeNewValue);
    expect(getFeatureValue(FEATURE.E)).toEqual(rootOldValue);

    expect(await changeFeatureValue(FEATURE.E, rootNewValue)).toBeUndefined();
    expect(getFeatureStates()[FEATURE.E].stateScopedValues).toMatchInlineSnapshot(`
      {
        "//": 1,
        "component::c1##layer::l1##tenant::t1": 4,
        "component::c1##tenant::t1": 3,
        "tenant::t1": 2,
      }
    `);
    expect(getFeatureValue(FEATURE.E, subScopeMap)).toEqual(subScopeNewValue);
    expect(getFeatureValue(FEATURE.E, scopeMap)).toEqual(scopeNewValue);
    expect(getFeatureValue(FEATURE.E, superScopeMap)).toEqual(superScopeNewValue);
    expect(getFeatureValue(FEATURE.E)).toEqual(rootNewValue);

    expect(redisWrapperLoggerSpy.info.mock.calls).toMatchInlineSnapshot(`[]`);
    expect(redisWrapperLoggerSpy.warning.mock.calls).toMatchSnapshot();
    expect(redisWrapperLoggerSpy.error.mock.calls).toMatchInlineSnapshot(`[]`);
    expect(featureTogglesLoggerSpy.info.mock.calls).toMatchInlineSnapshot(`
      [
        [
          "finished initialization with %i feature toggle%s with %s",
          8,
          "s",
          "NO_REDIS",
        ],
      ]
    `);
    expect(featureTogglesLoggerSpy.warning.mock.calls).toMatchSnapshot();
    expect(featureTogglesLoggerSpy.error.mock.calls).toMatchInlineSnapshot(`[]`);
  });

  it("getFeatureValue, changeFeatureValue with scopes and clearSubScopes, resetFeatureValue", async () => {
    const scopeMap = { component: "c1", tenant: "t1" };
    const subScopeMap = { layer: "l1", component: "c1", tenant: "t1" };
    const superScopeMap = { tenant: "t1" };

    const rootOldValue = getFeatureValue(FEATURE.E);
    const rootNewValue = 1;
    const superScopeNewValue = 2;
    const scopeNewValue = 3;
    const subScopeNewValue = 4;

    expect(await changeFeatureValue(FEATURE.E, scopeNewValue, scopeMap)).toBeUndefined();
    expect(await changeFeatureValue(FEATURE.E, superScopeNewValue, superScopeMap)).toBeUndefined();
    expect(await changeFeatureValue(FEATURE.E, subScopeNewValue, subScopeMap)).toBeUndefined();
    expect(await changeFeatureValue(FEATURE.E, rootNewValue)).toBeUndefined();
    expect(getFeatureStates()[FEATURE.E].stateScopedValues).toMatchInlineSnapshot(`
      {
        "//": 1,
        "component::c1##layer::l1##tenant::t1": 4,
        "component::c1##tenant::t1": 3,
        "tenant::t1": 2,
      }
    `);
    expect(getFeatureValue(FEATURE.E, subScopeMap)).toEqual(subScopeNewValue);
    expect(getFeatureValue(FEATURE.E, scopeMap)).toEqual(scopeNewValue);
    expect(getFeatureValue(FEATURE.E, superScopeMap)).toEqual(superScopeNewValue);
    expect(getFeatureValue(FEATURE.E)).toEqual(rootNewValue);

    expect(await changeFeatureValue(FEATURE.E, scopeNewValue, scopeMap, { clearSubScopes: true })).toBeUndefined();
    expect(getFeatureStates()[FEATURE.E].stateScopedValues).toMatchInlineSnapshot(`
      {
        "//": 1,
        "component::c1##tenant::t1": 3,
        "tenant::t1": 2,
      }
    `);
    expect(getFeatureValue(FEATURE.E, subScopeMap)).toEqual(scopeNewValue);
    expect(getFeatureValue(FEATURE.E, scopeMap)).toEqual(scopeNewValue);
    expect(getFeatureValue(FEATURE.E, superScopeMap)).toEqual(superScopeNewValue);
    expect(getFeatureValue(FEATURE.E)).toEqual(rootNewValue);

    expect(await resetFeatureValue(FEATURE.E)).toBeUndefined();
    expect(getFeatureStates()[FEATURE.E].stateScopedValues).toMatchInlineSnapshot(`undefined`);
    expect(getFeatureValue(FEATURE.E, subScopeMap)).toEqual(rootOldValue);
    expect(getFeatureValue(FEATURE.E, scopeMap)).toEqual(rootOldValue);
    expect(getFeatureValue(FEATURE.E, superScopeMap)).toEqual(rootOldValue);
    expect(getFeatureValue(FEATURE.E)).toEqual(rootOldValue);

    expect(redisWrapperLoggerSpy.info.mock.calls).toMatchInlineSnapshot(`[]`);
    expect(redisWrapperLoggerSpy.warning.mock.calls).toMatchSnapshot();
    expect(redisWrapperLoggerSpy.error.mock.calls).toMatchInlineSnapshot(`[]`);
    expect(featureTogglesLoggerSpy.info.mock.calls).toMatchInlineSnapshot(`
      [
        [
          "finished initialization with %i feature toggle%s with %s",
          8,
          "s",
          "NO_REDIS",
        ],
      ]
    `);
    expect(featureTogglesLoggerSpy.warning.mock.calls).toMatchSnapshot();
    expect(featureTogglesLoggerSpy.error.mock.calls).toMatchInlineSnapshot(`[]`);
  });

  it("registerFeatureValueValidation, validateFeatureValue", async () => {
    const successfulValidator = () => undefined;
    const failingValidator1 = () => {
      throw new Error("bla1");
    };
    const failingValidator2 = () => {
      throw new Error("bla2");
    };

    registerFeatureValueValidation(FEATURE.C, successfulValidator);
    expect(await validateFeatureValue(FEATURE.C, "")).toMatchInlineSnapshot(`[]`);
    registerFeatureValueValidation(FEATURE.C, failingValidator1);
    expect(await validateFeatureValue(FEATURE.C, "")).toMatchInlineSnapshot(`
      [
        {
          "errorMessage": "registered validator "{0}" failed for value "{1}" with error {2}",
          "errorMessageValues": [
            "failingValidator1",
            "",
            "bla1",
          ],
          "key": "test/feature_c",
        },
      ]
    `);
    registerFeatureValueValidation(FEATURE.C, failingValidator2);
    expect(await validateFeatureValue(FEATURE.C, "")).toMatchInlineSnapshot(`
      [
        {
          "errorMessage": "registered validator "{0}" failed for value "{1}" with error {2}",
          "errorMessageValues": [
            "failingValidator1",
            "",
            "bla1",
          ],
          "key": "test/feature_c",
        },
        {
          "errorMessage": "registered validator "{0}" failed for value "{1}" with error {2}",
          "errorMessageValues": [
            "failingValidator2",
            "",
            "bla2",
          ],
          "key": "test/feature_c",
        },
      ]
    `);
  });
});
