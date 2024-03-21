"use strict";

//NOTE: if a local redis is running when these integration tests are performed, then they will not work. we rely on
// and test only the local mode here.

const fs = jest.requireActual("fs");
jest.mock("fs", () => ({
  readFile: jest.fn(),
  access: jest.fn((cb) => cb()),
}));

const { stateFromInfo } = require("../__common__/fromInfo");

let featureTogglesLoggerSpy;
let redisWrapperLoggerSpy;
let toggles;

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
    toggles = require("../../src/");

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
      await expect(toggles.initializeFeatures({ configFile: "fantasy_name" })).rejects.toMatchInlineSnapshot(
        `[FeatureTogglesError: initialization aborted, could not read config file: ENOENT: no such file or directory, open 'fantasy_name']`
      );
    });

    it("init fails processing for bad formats", async () => {
      const badConfig = { ...config, bla: undefined };
      await expect(toggles.initializeFeatures({ config: badConfig })).rejects.toMatchInlineSnapshot(
        `[FeatureTogglesError: initialization aborted, could not process configuration: feature configuration is not an object]`
      );
    });

    it("init config precedence", async () => {
      const { readFile: readFileSpy } = require("fs");

      const configForRuntime = {
        [FEATURE.A]: {
          fallbackValue: "fallbackRuntimeA",
          type: "string",
        },
        [FEATURE.B]: {
          fallbackValue: "fallbackRuntimeB",
          type: "string",
        },
      };
      const configForFile = {
        [FEATURE.A]: {
          fallbackValue: "fallbackFileA",
          type: "string",
        },
        [FEATURE.C]: {
          fallbackValue: "fallbackFileC",
          type: "string",
        },
      };
      const configForAuto = {
        [FEATURE.A]: {
          fallbackValue: "fallbackAutoA",
          type: "string",
        },
        [FEATURE.B]: {
          fallbackValue: "fallbackAutoB",
          type: "string",
        },
        [FEATURE.C]: {
          fallbackValue: "fallbackAutoC",
          type: "string",
        },
        [FEATURE.D]: {
          fallbackValue: "fallbackAutoD",
          type: "string",
        },
      };
      readFileSpy.mockImplementationOnce((filepath, callback) =>
        callback(null, Buffer.from(JSON.stringify(configForFile)))
      );

      await toggles.initializeFeatures({
        config: configForRuntime,
        configFile: "somePath.json",
        configAuto: configForAuto,
      });
      expect(toggles.getFeaturesInfos()).toMatchInlineSnapshot(`
        {
          "test/feature_a": {
            "config": {
              "SOURCE": "RUNTIME",
              "TYPE": "string",
            },
            "fallbackValue": "fallbackRuntimeA",
          },
          "test/feature_b": {
            "config": {
              "SOURCE": "RUNTIME",
              "TYPE": "string",
            },
            "fallbackValue": "fallbackRuntimeB",
          },
          "test/feature_c": {
            "config": {
              "SOURCE": "FILE",
              "TYPE": "string",
            },
            "fallbackValue": "fallbackFileC",
          },
          "test/feature_d": {
            "config": {
              "SOURCE": "AUTO",
              "TYPE": "string",
            },
            "fallbackValue": "fallbackAutoD",
          },
        }
      `);

      expect(featureTogglesLoggerSpy.info.mock.calls).toMatchInlineSnapshot(`
        [
          [
            "finished initialization with %i feature toggle%s (%i runtime, %i file, %i auto) with %s",
            4,
            "s",
            2,
            1,
            1,
            "NO_REDIS",
          ],
        ]
      `);
    });
  });

  describe("validations", () => {
    it("two regex validations", async () => {
      await toggles.initializeFeatures({
        config: {
          [FEATURE.A]: {
            fallbackValue: "fallback",
            type: "string",
            validations: [{ regex: "^foo" }, { regex: "bar$" }],
          },
        },
      });
      expect(await toggles.changeFeatureValue(FEATURE.A, "foo")).toMatchInlineSnapshot(`
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
      expect(await toggles.changeFeatureValue(FEATURE.A, "bar")).toMatchInlineSnapshot(`
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
      expect(await toggles.changeFeatureValue(FEATURE.A, "foobar")).toBeUndefined();
    });

    it("custom module validations just module from CWD", async () => {
      jest.mock("./virtual-validator-just-module", () => jest.fn(), { virtual: true });
      const mockValidator = require("./virtual-validator-just-module");
      await toggles.initializeFeatures({
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
      await toggles.initializeFeatures({
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
      await toggles.initializeFeatures({
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
      await toggles.initializeFeatures({
        configFile: "./test/integration-local/virtual-config.json",
      });

      expect(mockValidator).toHaveBeenCalledTimes(1);
      expect(mockValidator).toHaveBeenCalledWith("fallback", undefined, undefined);
    });
  });

  describe("common config init", () => {
    beforeEach(async () => {
      await toggles.initializeFeatures({ config });
    });

    it("getFeaturesKeys, getFeatureValues, getFeaturesInfos", async () => {
      expect(toggles.getFeaturesKeys()).toEqual(Object.keys(config));

      const featureStatesResult = await toggles.getFeaturesInfos();
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
            "finished initialization with %i feature toggle%s (%i runtime, %i file, %i auto) with %s",
            8,
            "s",
            8,
            0,
            0,
            "NO_REDIS",
          ],
        ]
      `);
      expect(featureTogglesLoggerSpy.warning).toHaveBeenCalledTimes(0);
      expect(featureTogglesLoggerSpy.error).toHaveBeenCalledTimes(0);
      expect(redisWrapperLoggerSpy.info).toHaveBeenCalledTimes(0);
      expect(redisWrapperLoggerSpy.warning).toHaveBeenCalledTimes(0);
    });

    it("getFeatureValue, changeFeatureValue without scopes", async () => {
      const oldValue = toggles.getFeatureValue(FEATURE.E);

      const newValue = 9;
      const forbiddenNewValue = 10;

      expect(await toggles.changeFeatureValue(FEATURE.E, forbiddenNewValue)).toMatchSnapshot();
      expect(toggles.getFeatureValue(FEATURE.E)).toEqual(oldValue);

      expect(await toggles.changeFeatureValue(FEATURE.E, newValue)).toBeUndefined();
      expect(stateFromInfo(toggles.getFeatureInfo(FEATURE.E))).toMatchInlineSnapshot(`
        {
          "rootValue": 9,
        }
      `);
      expect(toggles.getFeatureValue(FEATURE.E)).toEqual(newValue);

      expect(featureTogglesLoggerSpy.info.mock.calls).toMatchInlineSnapshot(`
        [
          [
            "finished initialization with %i feature toggle%s (%i runtime, %i file, %i auto) with %s",
            8,
            "s",
            8,
            0,
            0,
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

      expect(await toggles.changeFeatureValue(FEATURE.E, trapValue, badScopeMap1)).toMatchInlineSnapshot(`
        [
          {
            "errorMessage": "scopeMap must be undefined or an object",
            "featureKey": "test/feature_e",
          },
        ]
      `);
      expect(await toggles.changeFeatureValue(FEATURE.E, trapValue, badScopeMap2)).toMatchInlineSnapshot(`
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
      expect(await toggles.changeFeatureValue(FEATURE.E, trapValue, badScopeMap3)).toMatchInlineSnapshot(`
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
      expect(await toggles.changeFeatureValue(FEATURE.E, trapValue, trapScopeMap)).toMatchInlineSnapshot(`undefined`);
      expect(toggles.getFeatureValue(FEATURE.E, badScopeMap1)).toEqual(oldRootValue);
      expect(toggles.getFeatureValue(FEATURE.E, badScopeMap2)).toEqual(oldRootValue);
      expect(toggles.getFeatureValue(FEATURE.E, badScopeMap3)).toEqual(oldRootValue);
    });

    it("getFeatureValue, changeFeatureValue with scopes", async () => {
      const rootOldValue = toggles.getFeatureValue(FEATURE.E);

      const scopeMap = { component: "c1", tenant: "t1" };
      const subScopeMap = { layer: "l1", component: "c1", tenant: "t1" };
      const superScopeMap = { tenant: "t1" };

      const rootNewValue = 1;
      const superScopeNewValue = 2;
      const scopeNewValue = 3;
      const subScopeNewValue = 4;
      const forbiddenNewValue = 10;

      expect(await toggles.changeFeatureValue(FEATURE.E, forbiddenNewValue, scopeMap)).toMatchSnapshot();
      expect(stateFromInfo(toggles.getFeatureInfo(FEATURE.E))).toMatchInlineSnapshot(`{}`);
      expect(toggles.getFeatureValue(FEATURE.E, scopeMap)).toEqual(rootOldValue);
      expect(toggles.getFeatureValue(FEATURE.E, subScopeMap)).toEqual(rootOldValue);
      expect(toggles.getFeatureValue(FEATURE.E, superScopeMap)).toEqual(rootOldValue);
      expect(toggles.getFeatureValue(FEATURE.E)).toEqual(rootOldValue);

      expect(await toggles.changeFeatureValue(FEATURE.E, scopeNewValue, scopeMap)).toBeUndefined();
      expect(stateFromInfo(toggles.getFeatureInfo(FEATURE.E))).toMatchInlineSnapshot(`
        {
          "scopedValues": {
            "component::c1##tenant::t1": 3,
          },
        }
      `);
      expect(toggles.getFeatureValue(FEATURE.E, subScopeMap)).toEqual(scopeNewValue);
      expect(toggles.getFeatureValue(FEATURE.E, scopeMap)).toEqual(scopeNewValue);
      expect(toggles.getFeatureValue(FEATURE.E, superScopeMap)).toEqual(rootOldValue);
      expect(toggles.getFeatureValue(FEATURE.E)).toEqual(rootOldValue);

      expect(await toggles.changeFeatureValue(FEATURE.E, superScopeNewValue, superScopeMap)).toBeUndefined();
      expect(stateFromInfo(toggles.getFeatureInfo(FEATURE.E))).toMatchInlineSnapshot(`
        {
          "scopedValues": {
            "component::c1##tenant::t1": 3,
            "tenant::t1": 2,
          },
        }
      `);
      expect(toggles.getFeatureValue(FEATURE.E, subScopeMap)).toEqual(scopeNewValue);
      expect(toggles.getFeatureValue(FEATURE.E, scopeMap)).toEqual(scopeNewValue);
      expect(toggles.getFeatureValue(FEATURE.E, superScopeMap)).toEqual(superScopeNewValue);
      expect(toggles.getFeatureValue(FEATURE.E)).toEqual(rootOldValue);

      expect(await toggles.changeFeatureValue(FEATURE.E, subScopeNewValue, subScopeMap)).toBeUndefined();
      expect(stateFromInfo(toggles.getFeatureInfo(FEATURE.E))).toMatchInlineSnapshot(`
        {
          "scopedValues": {
            "component::c1##layer::l1##tenant::t1": 4,
            "component::c1##tenant::t1": 3,
            "tenant::t1": 2,
          },
        }
      `);
      expect(toggles.getFeatureValue(FEATURE.E, subScopeMap)).toEqual(subScopeNewValue);
      expect(toggles.getFeatureValue(FEATURE.E, scopeMap)).toEqual(scopeNewValue);
      expect(toggles.getFeatureValue(FEATURE.E, superScopeMap)).toEqual(superScopeNewValue);
      expect(toggles.getFeatureValue(FEATURE.E)).toEqual(rootOldValue);

      expect(await toggles.changeFeatureValue(FEATURE.E, rootNewValue)).toBeUndefined();
      expect(stateFromInfo(toggles.getFeatureInfo(FEATURE.E))).toMatchInlineSnapshot(`
        {
          "rootValue": 1,
          "scopedValues": {
            "component::c1##layer::l1##tenant::t1": 4,
            "component::c1##tenant::t1": 3,
            "tenant::t1": 2,
          },
        }
      `);
      expect(toggles.getFeatureValue(FEATURE.E, subScopeMap)).toEqual(subScopeNewValue);
      expect(toggles.getFeatureValue(FEATURE.E, scopeMap)).toEqual(scopeNewValue);
      expect(toggles.getFeatureValue(FEATURE.E, superScopeMap)).toEqual(superScopeNewValue);
      expect(toggles.getFeatureValue(FEATURE.E)).toEqual(rootNewValue);

      expect(featureTogglesLoggerSpy.info.mock.calls).toMatchInlineSnapshot(`
        [
          [
            "finished initialization with %i feature toggle%s (%i runtime, %i file, %i auto) with %s",
            8,
            "s",
            8,
            0,
            0,
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

      const rootOldValue = toggles.getFeatureValue(FEATURE.E);
      const rootNewValue = 1;
      const superScopeNewValue = 2;
      const scopeNewValue = 3;
      const subScopeNewValue = 4;

      expect(await toggles.changeFeatureValue(FEATURE.E, scopeNewValue, scopeMap)).toBeUndefined();
      expect(await toggles.changeFeatureValue(FEATURE.E, superScopeNewValue, superScopeMap)).toBeUndefined();
      expect(await toggles.changeFeatureValue(FEATURE.E, subScopeNewValue, subScopeMap)).toBeUndefined();
      expect(await toggles.changeFeatureValue(FEATURE.E, rootNewValue)).toBeUndefined();
      expect(stateFromInfo(toggles.getFeatureInfo(FEATURE.E))).toMatchInlineSnapshot(`
        {
          "rootValue": 1,
          "scopedValues": {
            "component::c1##layer::l1##tenant::t1": 4,
            "component::c1##tenant::t1": 3,
            "tenant::t1": 2,
          },
        }
      `);
      expect(toggles.getFeatureValue(FEATURE.E, subScopeMap)).toEqual(subScopeNewValue);
      expect(toggles.getFeatureValue(FEATURE.E, scopeMap)).toEqual(scopeNewValue);
      expect(toggles.getFeatureValue(FEATURE.E, superScopeMap)).toEqual(superScopeNewValue);
      expect(toggles.getFeatureValue(FEATURE.E)).toEqual(rootNewValue);

      expect(
        await toggles.changeFeatureValue(FEATURE.E, scopeNewValue, scopeMap, { clearSubScopes: true })
      ).toBeUndefined();
      expect(stateFromInfo(toggles.getFeatureInfo(FEATURE.E))).toMatchInlineSnapshot(`
        {
          "rootValue": 1,
          "scopedValues": {
            "component::c1##tenant::t1": 3,
            "tenant::t1": 2,
          },
        }
      `);
      expect(toggles.getFeatureValue(FEATURE.E, subScopeMap)).toEqual(scopeNewValue);
      expect(toggles.getFeatureValue(FEATURE.E, scopeMap)).toEqual(scopeNewValue);
      expect(toggles.getFeatureValue(FEATURE.E, superScopeMap)).toEqual(superScopeNewValue);
      expect(toggles.getFeatureValue(FEATURE.E)).toEqual(rootNewValue);

      expect(await toggles.resetFeatureValue(FEATURE.E)).toBeUndefined();
      expect(stateFromInfo(toggles.getFeatureInfo(FEATURE.E))).toMatchInlineSnapshot(`{}`);
      expect(toggles.getFeatureValue(FEATURE.E, subScopeMap)).toEqual(rootOldValue);
      expect(toggles.getFeatureValue(FEATURE.E, scopeMap)).toEqual(rootOldValue);
      expect(toggles.getFeatureValue(FEATURE.E, superScopeMap)).toEqual(rootOldValue);
      expect(toggles.getFeatureValue(FEATURE.E)).toEqual(rootOldValue);

      expect(featureTogglesLoggerSpy.info.mock.calls).toMatchInlineSnapshot(`
        [
          [
            "finished initialization with %i feature toggle%s (%i runtime, %i file, %i auto) with %s",
            8,
            "s",
            8,
            0,
            0,
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
      expect(await toggles.validateFeatureValue(FEATURE.C, "", { tenant: "t1" })).toMatchInlineSnapshot(`[]`);

      // invalid
      expect(await toggles.validateFeatureValue(FEATURE.C, "", null)).toMatchInlineSnapshot(`
        [
          {
            "errorMessage": "scopeMap must be undefined or an object",
            "featureKey": "test/feature_c",
          },
        ]
      `);

      expect(await toggles.validateFeatureValue(FEATURE.C, "", { tenant: { subTenant: "bla" } }))
        .toMatchInlineSnapshot(`
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
      expect(await toggles.validateFeatureValue(FEATURE.C, "", { tenant: ["a", "b", "c"] })).toMatchInlineSnapshot(`
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
      expect(await toggles.validateFeatureValue(FEATURE.C, "", { tenant: () => "1" })).toMatchInlineSnapshot(`
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

      toggles.registerFeatureValueValidation(FEATURE.C, successfulValidator);
      expect(await toggles.validateFeatureValue(FEATURE.C, "")).toMatchInlineSnapshot(`[]`);
      toggles.registerFeatureValueValidation(FEATURE.C, failingValidator1);
      expect(await toggles.validateFeatureValue(FEATURE.C, "")).toMatchInlineSnapshot(`
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
      toggles.registerFeatureValueValidation(FEATURE.C, failingValidator2);
      expect(await toggles.validateFeatureValue(FEATURE.C, "")).toMatchInlineSnapshot(`
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
