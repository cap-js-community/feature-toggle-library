"use strict";

//NOTE: if a local redis is running when these integration tests are performed, then they will not work. we rely on
// and test only the local mode here.

const fs = jest.requireActual("fs");
jest.mock("fs", () => ({ readFile: jest.fn() }));

const { stateFromInfo } = require("../__common__/fromInfo");

let featureTogglesLoggerSpy;
let redisWrapperLoggerSpy;
let initializeFeatures;
let getFeatureInfo;
let getFeaturesInfos;
let getFeatureValue;
let changeFeatureValue;
let resetFeatureValue;
let registerFeatureValueValidation;
let validateFeatureValue;

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

describe("local integration test", () => {
  beforeEach(async () => {
    jest.resetModules();
    ({
      singleton: {
        initializeFeatures,
        getFeatureInfo,
        getFeaturesInfos,
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
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("init", () => {
    it("init fails resolving for bad config paths", async () => {
      const { readFile: readFileSpy } = require("fs");
      readFileSpy.mockImplementationOnce(fs.readFile);
      await expect(initializeFeatures({ configFile: "fantasy_name" })).rejects.toMatchInlineSnapshot(
        `[FeatureTogglesError: initialization aborted, could not resolve configuration: ENOENT: no such file or directory, open 'fantasy_name']`
      );
    });

    it("init fails processing for bad formats", async () => {
      const badConfig = { ...config, bla: undefined };
      await expect(initializeFeatures({ config: badConfig })).rejects.toMatchInlineSnapshot(
        `[FeatureTogglesError: initialization aborted, could not process configuration: Cannot read properties of undefined (reading 'type')]`
      );
    });
  });

  describe("validations", () => {
    it("two regex validations", async () => {
      await initializeFeatures({
        config: {
          [FEATURE.A]: {
            fallbackValue: "fallback",
            type: "string",
            validations: [{ regex: "^foo" }, { regex: "bar$" }],
          },
        },
      });
      expect(await changeFeatureValue(FEATURE.A, "foo")).toMatchInlineSnapshot(`
        [
          {
            "errorMessage": "value "{0}" does not match validation regular expression {1}",
            "errorMessageValues": [
              "foo",
              "/bar$/",
            ],
            "featureKey": "test/feature_a",
            "scopeKey": "//",
          },
        ]
      `);
      expect(await changeFeatureValue(FEATURE.A, "bar")).toMatchInlineSnapshot(`
        [
          {
            "errorMessage": "value "{0}" does not match validation regular expression {1}",
            "errorMessageValues": [
              "bar",
              "/^foo/",
            ],
            "featureKey": "test/feature_a",
            "scopeKey": "//",
          },
        ]
      `);
      expect(await changeFeatureValue(FEATURE.A, "foobar")).toBeUndefined();
    });

    it("custom module validations just module from CWD", async () => {
      jest.mock("./virtual-validator-just-module", () => jest.fn(), { virtual: true });
      const mockValidator = require("./virtual-validator-just-module");
      await initializeFeatures({
        config: {
          [FEATURE.A]: {
            fallbackValue: "fallback",
            type: "string",
            validations: [{ module: "./test/integration-local/virtual-validator-just-module" }],
          },
        },
      });

      expect(mockValidator).toHaveBeenCalledTimes(1);
      expect(mockValidator).toHaveBeenCalledWith("fallback", undefined, undefined);
    });

    it("custom module validations with call from CWD", async () => {
      jest.mock("./virtual-validator-with-call", () => ({ validator: jest.fn() }), { virtual: true });
      const { validator: mockValidator } = require("./virtual-validator-with-call");
      await initializeFeatures({
        config: {
          [FEATURE.A]: {
            fallbackValue: "fallback",
            type: "string",
            validations: [{ module: "./test/integration-local/virtual-validator-with-call", call: "validator" }],
          },
        },
      });

      expect(mockValidator).toHaveBeenCalledTimes(1);
      expect(mockValidator).toHaveBeenCalledWith("fallback", undefined, undefined);
    });

    it("custom module validations just module from CONFIG_DIR", async () => {
      jest.mock("./virtual-validator-just-module", () => jest.fn(), { virtual: true });
      const mockValidator = require("./virtual-validator-just-module");
      const { readFile: readFileSpy } = require("fs");

      const config = {
        [FEATURE.A]: {
          fallbackValue: "fallback",
          type: "string",
          validations: [{ module: "$CONFIG_DIR/virtual-validator-just-module" }],
        },
      };
      const configBuffer = Buffer.from(JSON.stringify(config));
      readFileSpy.mockImplementationOnce((filepath, callback) => callback(null, configBuffer));
      await initializeFeatures({
        configFile: "./test/integration-local/virtual-config.json",
      });

      expect(mockValidator).toHaveBeenCalledTimes(1);
      expect(mockValidator).toHaveBeenCalledWith("fallback", undefined, undefined);
    });

    it("custom module validations with call from CONFIG_DIR", async () => {
      jest.mock("./virtual-validator-with-call", () => ({ validator: jest.fn() }), { virtual: true });
      const { validator: mockValidator } = require("./virtual-validator-with-call");
      const { readFile: readFileSpy } = require("fs");

      const config = {
        [FEATURE.A]: {
          fallbackValue: "fallback",
          type: "string",
          validations: [{ module: "$CONFIG_DIR/virtual-validator-with-call", call: "validator" }],
        },
      };
      const configBuffer = Buffer.from(JSON.stringify(config));
      readFileSpy.mockImplementationOnce((filepath, callback) => callback(null, configBuffer));
      await initializeFeatures({
        configFile: "./test/integration-local/virtual-config.json",
      });

      expect(mockValidator).toHaveBeenCalledTimes(1);
      expect(mockValidator).toHaveBeenCalledWith("fallback", undefined, undefined);
    });
  });

  describe("common config init", () => {
    beforeEach(async () => {
      await initializeFeatures({ config });
    });

    it("getFeatureValues, getFeaturesInfos", async () => {
      const featureStatesResult = await getFeaturesInfos();

      expect(Object.keys(featureStatesResult)).toEqual(Object.keys(config));
      Object.entries(featureStatesResult).forEach(([key, featureState]) => {
        expect(featureState.config.TYPE).toEqual(config[key].type);
        expect(featureState.fallbackValue).toEqual(config[key].fallbackValue);
      });

      expect(featureStatesResult).toMatchSnapshot();

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
      expect(featureTogglesLoggerSpy.warning).toHaveBeenCalledTimes(0);
      expect(featureTogglesLoggerSpy.error).toHaveBeenCalledTimes(0);
      expect(redisWrapperLoggerSpy.info).toHaveBeenCalledTimes(0);
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
    });

    it("getFeatureValue, changeFeatureValue without scopes", async () => {
      const oldValue = getFeatureValue(FEATURE.E);

      const newValue = 9;
      const forbiddenNewValue = 10;

      expect(await changeFeatureValue(FEATURE.E, forbiddenNewValue)).toMatchSnapshot();
      expect(getFeatureValue(FEATURE.E)).toEqual(oldValue);

      expect(await changeFeatureValue(FEATURE.E, newValue)).toBeUndefined();
      expect(stateFromInfo(getFeatureInfo(FEATURE.E))).toMatchInlineSnapshot(`
              {
                "rootValue": 9,
              }
          `);
      expect(getFeatureValue(FEATURE.E)).toEqual(newValue);

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
      expect(featureTogglesLoggerSpy.warning).toHaveBeenCalledTimes(0);
      expect(featureTogglesLoggerSpy.error).toHaveBeenCalledTimes(0);
      expect(redisWrapperLoggerSpy.info).toHaveBeenCalledTimes(0);
      expect(redisWrapperLoggerSpy.warning.mock.calls).toMatchSnapshot();
      expect(redisWrapperLoggerSpy.error).toHaveBeenCalledTimes(0);
    });

    it("getFeatureValue with bad scopes", async () => {
      const oldRootValue = 5;
      const trapValue = 9;
      const badScopeMap1 = null; // not an object
      const badScopeMap2 = { tanent: "undefined" }; // scope that is not allowed
      const badScopeMap3 = { tenant: undefined, layer: undefined };
      const trapScopeMap = { tenant: "undefined", layer: "undefined" };

      expect(await changeFeatureValue(FEATURE.E, trapValue, badScopeMap1)).toMatchInlineSnapshot(`
        [
          {
            "errorMessage": "scopeMap must be undefined or an object",
            "featureKey": "test/feature_e",
          },
        ]
      `);
      expect(await changeFeatureValue(FEATURE.E, trapValue, badScopeMap2)).toMatchInlineSnapshot(`
        [
          {
            "errorMessage": "scope "{0}" is not allowed",
            "errorMessageValues": [
              "tanent",
            ],
            "featureKey": "test/feature_e",
          },
        ]
      `);
      expect(await changeFeatureValue(FEATURE.E, trapValue, badScopeMap3)).toMatchInlineSnapshot(`
        [
          {
            "errorMessage": "scope "{0}" has invalid type {1}, must be string",
            "errorMessageValues": [
              "tenant",
              "undefined",
            ],
            "featureKey": "test/feature_e",
          },
        ]
      `);
      expect(await changeFeatureValue(FEATURE.E, trapValue, trapScopeMap)).toMatchInlineSnapshot(`undefined`);
      expect(getFeatureValue(FEATURE.E, badScopeMap1)).toEqual(oldRootValue);
      expect(getFeatureValue(FEATURE.E, badScopeMap2)).toEqual(oldRootValue);
      expect(getFeatureValue(FEATURE.E, badScopeMap3)).toEqual(oldRootValue);
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
      expect(stateFromInfo(getFeatureInfo(FEATURE.E))).toMatchInlineSnapshot(`{}`);
      expect(getFeatureValue(FEATURE.E, scopeMap)).toEqual(rootOldValue);
      expect(getFeatureValue(FEATURE.E, subScopeMap)).toEqual(rootOldValue);
      expect(getFeatureValue(FEATURE.E, superScopeMap)).toEqual(rootOldValue);
      expect(getFeatureValue(FEATURE.E)).toEqual(rootOldValue);

      expect(await changeFeatureValue(FEATURE.E, scopeNewValue, scopeMap)).toBeUndefined();
      expect(stateFromInfo(getFeatureInfo(FEATURE.E))).toMatchInlineSnapshot(`
              {
                "scopedValues": {
                  "component::c1##tenant::t1": 3,
                },
              }
          `);
      expect(getFeatureValue(FEATURE.E, subScopeMap)).toEqual(scopeNewValue);
      expect(getFeatureValue(FEATURE.E, scopeMap)).toEqual(scopeNewValue);
      expect(getFeatureValue(FEATURE.E, superScopeMap)).toEqual(rootOldValue);
      expect(getFeatureValue(FEATURE.E)).toEqual(rootOldValue);

      expect(await changeFeatureValue(FEATURE.E, superScopeNewValue, superScopeMap)).toBeUndefined();
      expect(stateFromInfo(getFeatureInfo(FEATURE.E))).toMatchInlineSnapshot(`
              {
                "scopedValues": {
                  "component::c1##tenant::t1": 3,
                  "tenant::t1": 2,
                },
              }
          `);
      expect(getFeatureValue(FEATURE.E, subScopeMap)).toEqual(scopeNewValue);
      expect(getFeatureValue(FEATURE.E, scopeMap)).toEqual(scopeNewValue);
      expect(getFeatureValue(FEATURE.E, superScopeMap)).toEqual(superScopeNewValue);
      expect(getFeatureValue(FEATURE.E)).toEqual(rootOldValue);

      expect(await changeFeatureValue(FEATURE.E, subScopeNewValue, subScopeMap)).toBeUndefined();
      expect(stateFromInfo(getFeatureInfo(FEATURE.E))).toMatchInlineSnapshot(`
              {
                "scopedValues": {
                  "component::c1##layer::l1##tenant::t1": 4,
                  "component::c1##tenant::t1": 3,
                  "tenant::t1": 2,
                },
              }
          `);
      expect(getFeatureValue(FEATURE.E, subScopeMap)).toEqual(subScopeNewValue);
      expect(getFeatureValue(FEATURE.E, scopeMap)).toEqual(scopeNewValue);
      expect(getFeatureValue(FEATURE.E, superScopeMap)).toEqual(superScopeNewValue);
      expect(getFeatureValue(FEATURE.E)).toEqual(rootOldValue);

      expect(await changeFeatureValue(FEATURE.E, rootNewValue)).toBeUndefined();
      expect(stateFromInfo(getFeatureInfo(FEATURE.E))).toMatchInlineSnapshot(`
              {
                "rootValue": 1,
                "scopedValues": {
                  "component::c1##layer::l1##tenant::t1": 4,
                  "component::c1##tenant::t1": 3,
                  "tenant::t1": 2,
                },
              }
          `);
      expect(getFeatureValue(FEATURE.E, subScopeMap)).toEqual(subScopeNewValue);
      expect(getFeatureValue(FEATURE.E, scopeMap)).toEqual(scopeNewValue);
      expect(getFeatureValue(FEATURE.E, superScopeMap)).toEqual(superScopeNewValue);
      expect(getFeatureValue(FEATURE.E)).toEqual(rootNewValue);

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
      expect(featureTogglesLoggerSpy.warning).toHaveBeenCalledTimes(0);
      expect(featureTogglesLoggerSpy.error).toHaveBeenCalledTimes(0);
      expect(redisWrapperLoggerSpy.info).toHaveBeenCalledTimes(0);
      expect(redisWrapperLoggerSpy.warning.mock.calls).toMatchSnapshot();
      expect(redisWrapperLoggerSpy.error).toHaveBeenCalledTimes(0);
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
      expect(stateFromInfo(getFeatureInfo(FEATURE.E))).toMatchInlineSnapshot(`
              {
                "rootValue": 1,
                "scopedValues": {
                  "component::c1##layer::l1##tenant::t1": 4,
                  "component::c1##tenant::t1": 3,
                  "tenant::t1": 2,
                },
              }
          `);
      expect(getFeatureValue(FEATURE.E, subScopeMap)).toEqual(subScopeNewValue);
      expect(getFeatureValue(FEATURE.E, scopeMap)).toEqual(scopeNewValue);
      expect(getFeatureValue(FEATURE.E, superScopeMap)).toEqual(superScopeNewValue);
      expect(getFeatureValue(FEATURE.E)).toEqual(rootNewValue);

      expect(await changeFeatureValue(FEATURE.E, scopeNewValue, scopeMap, { clearSubScopes: true })).toBeUndefined();
      expect(stateFromInfo(getFeatureInfo(FEATURE.E))).toMatchInlineSnapshot(`
              {
                "rootValue": 1,
                "scopedValues": {
                  "component::c1##tenant::t1": 3,
                  "tenant::t1": 2,
                },
              }
          `);
      expect(getFeatureValue(FEATURE.E, subScopeMap)).toEqual(scopeNewValue);
      expect(getFeatureValue(FEATURE.E, scopeMap)).toEqual(scopeNewValue);
      expect(getFeatureValue(FEATURE.E, superScopeMap)).toEqual(superScopeNewValue);
      expect(getFeatureValue(FEATURE.E)).toEqual(rootNewValue);

      expect(await resetFeatureValue(FEATURE.E)).toBeUndefined();
      expect(stateFromInfo(getFeatureInfo(FEATURE.E))).toMatchInlineSnapshot(`{}`);
      expect(getFeatureValue(FEATURE.E, subScopeMap)).toEqual(rootOldValue);
      expect(getFeatureValue(FEATURE.E, scopeMap)).toEqual(rootOldValue);
      expect(getFeatureValue(FEATURE.E, superScopeMap)).toEqual(rootOldValue);
      expect(getFeatureValue(FEATURE.E)).toEqual(rootOldValue);

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
      expect(featureTogglesLoggerSpy.warning).toHaveBeenCalledTimes(0);
      expect(featureTogglesLoggerSpy.error).toHaveBeenCalledTimes(0);
      expect(redisWrapperLoggerSpy.info).toHaveBeenCalledTimes(0);
      expect(redisWrapperLoggerSpy.warning.mock.calls).toMatchSnapshot();
      expect(redisWrapperLoggerSpy.error).toHaveBeenCalledTimes(0);
    });

    it("validateFeatureValue with invalid scopes", async () => {
      // valid
      expect(await validateFeatureValue(FEATURE.C, "", { tenant: "t1" })).toMatchInlineSnapshot(`[]`);

      // invalid
      expect(await validateFeatureValue(FEATURE.C, "", null)).toMatchInlineSnapshot(`
        [
          {
            "errorMessage": "scopeMap must be undefined or an object",
            "featureKey": "test/feature_c",
          },
        ]
      `);

      expect(await validateFeatureValue(FEATURE.C, "", { tenant: { subTenant: "bla" } })).toMatchInlineSnapshot(`
        [
          {
            "errorMessage": "scope "{0}" has invalid type {1}, must be string",
            "errorMessageValues": [
              "tenant",
              "object",
            ],
            "featureKey": "test/feature_c",
          },
        ]
      `);
      expect(await validateFeatureValue(FEATURE.C, "", { tenant: ["a", "b", "c"] })).toMatchInlineSnapshot(`
        [
          {
            "errorMessage": "scope "{0}" has invalid type {1}, must be string",
            "errorMessageValues": [
              "tenant",
              "object",
            ],
            "featureKey": "test/feature_c",
          },
        ]
      `);
      expect(await validateFeatureValue(FEATURE.C, "", { tenant: () => "1" })).toMatchInlineSnapshot(`
        [
          {
            "errorMessage": "scope "{0}" has invalid type {1}, must be string",
            "errorMessageValues": [
              "tenant",
              "function",
            ],
            "featureKey": "test/feature_c",
          },
        ]
      `);
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
                  "featureKey": "test/feature_c",
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
                  "featureKey": "test/feature_c",
                },
                {
                  "errorMessage": "registered validator "{0}" failed for value "{1}" with error {2}",
                  "errorMessageValues": [
                    "failingValidator2",
                    "",
                    "bla2",
                  ],
                  "featureKey": "test/feature_c",
                },
              ]
          `);
    });
  });
});
