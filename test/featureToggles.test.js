"use strict";

const util = require("util");

const VError = require("verror");
const yaml = require("yaml");
const featureTogglesModule = require("../src/featureToggles");
const { LimitedLazyCache } = require("../src/shared/cache");

const { FEATURE, mockConfig, redisKey, redisChannel } = require("./__common__/mockdata");
const { fallbackValuesFromInfos, stateFromInfos } = require("./__common__/fromInfo");

const {
  FeatureToggles,
  _: { SCOPE_ROOT_KEY, CONFIG_KEY, CONFIG_INFO_KEY },
} = featureTogglesModule;

const { readFile: readFileSpy } = require("fs");
jest.mock("fs", () => ({
  readFile: jest.fn(),
  access: jest.fn((cb) => cb()),
}));

const envMock = require("../src/shared/env");
jest.mock("../src/shared/env", () => require("./__mocks__/env"));

const redisWrapperMock = require("../src/redisWrapper");
jest.mock("../src/redisWrapper", () => require("./__mocks__/redisWrapper"));

const outputFromErrorLogger = (calls) =>
  calls.map((args) => util.format("%s\n%O", args[0], VError.info(args[0]))).join("\n");

const configToFallbackValues = (config) =>
  Object.fromEntries(Object.entries(config).map(([key, { fallbackValue }]) => [key, fallbackValue]));
const configToActiveKeys = (config) =>
  Object.entries(config)
    .filter(([, value]) => value.active !== false)
    .map(([key]) => key);

const mockFallbackValues = configToFallbackValues(mockConfig);
const mockActiveKeys = configToActiveKeys(mockConfig);

let toggles;
const loggerSpy = {
  info: jest.spyOn(featureTogglesModule._._getLogger(), "info"),
  warning: jest.spyOn(featureTogglesModule._._getLogger(), "warning"),
  error: jest.spyOn(featureTogglesModule._._getLogger(), "error"),
};

describe("feature toggles test", () => {
  beforeEach(async () => {
    envMock._reset();
    redisWrapperMock._reset();
    envMock._reset();
    toggles = new FeatureToggles({ redisKey, redisChannel });
    jest.clearAllMocks();
  });

  describe("enums", () => {
    test("config info consistency", () => {
      const internalKeys = [CONFIG_KEY.VALIDATIONS_SCOPES_MAP, CONFIG_KEY.VALIDATIONS_REGEX];
      const configKeysCheck = [].concat(Object.keys(CONFIG_INFO_KEY), internalKeys).sort();
      const configKeys = Object.values(CONFIG_KEY).sort();

      const configKeysMismatch = configKeys.find((value, index) => value !== configKeysCheck[index]);
      expect(configKeysMismatch).toBeUndefined();
      const configKeysCheckMismatch = configKeysCheck.find((value, index) => value !== configKeys[index]);
      expect(configKeysCheckMismatch).toBeUndefined();
    });
  });

  describe("static functions", () => {
    test("_getSuperScopeKeys", () => {
      const cache = new LimitedLazyCache({ sizeLimit: 10 });
      const allSuperScopeKeys = (scopeMap) => FeatureToggles._getNonRootSuperScopeKeys(cache, scopeMap);

      expect(allSuperScopeKeys({ tenantId: "t1" })).toMatchInlineSnapshot(`
        [
          "tenantId::t1",
        ]
      `);
      expect(allSuperScopeKeys({ tenantId: "t1", label: "l1" })).toMatchInlineSnapshot(`
        [
          "label::l1##tenantId::t1",
          "tenantId::t1",
          "label::l1",
        ]
      `);
      expect(allSuperScopeKeys({ tenantId: "t1", label: "l1", bla: "b1" })).toMatchInlineSnapshot(`
        [
          "bla::b1##label::l1##tenantId::t1",
          "label::l1##tenantId::t1",
          "bla::b1##tenantId::t1",
          "bla::b1##label::l1",
          "tenantId::t1",
          "label::l1",
          "bla::b1",
        ]
      `);
      expect(allSuperScopeKeys({ bla: "b1", label: "l1", tenantId: "t1" })).toMatchInlineSnapshot(`
        [
          "bla::b1##label::l1##tenantId::t1",
          "bla::b1##label::l1",
          "bla::b1##tenantId::t1",
          "label::l1##tenantId::t1",
          "bla::b1",
          "label::l1",
          "tenantId::t1",
        ]
      `);
      expect(allSuperScopeKeys({ tenantId: "t1", label: "l1", bla: "b1", naa: "n1" })).toMatchInlineSnapshot(`
        [
          "bla::b1##label::l1##naa::n1##tenantId::t1",
          "bla::b1##label::l1##tenantId::t1",
          "label::l1##naa::n1##tenantId::t1",
          "bla::b1##naa::n1##tenantId::t1",
          "bla::b1##label::l1##naa::n1",
          "label::l1##tenantId::t1",
          "bla::b1##tenantId::t1",
          "naa::n1##tenantId::t1",
          "label::l1##naa::n1",
          "bla::b1##label::l1",
          "bla::b1##naa::n1",
          "tenantId::t1",
          "label::l1",
          "bla::b1",
          "naa::n1",
        ]
      `);
      expect(loggerSpy.error).not.toHaveBeenCalled();
      loggerSpy.error.mockClear();
      expect(allSuperScopeKeys({ tenantId: "t1", label: "l1", bla: "b1", naa: "n1", xxx: "x1" })).toMatchInlineSnapshot(
        `[]`
      );
      expect(loggerSpy.error).toHaveBeenCalledTimes(1);
      expect(outputFromErrorLogger(loggerSpy.error.mock.calls)).toMatchInlineSnapshot(`
        "FeatureTogglesError: scope exceeds allowed number of keys
        {
          scopeMap: '{"tenantId":"t1","label":"l1","bla":"b1","naa":"n1","xxx":"x1"}',
          maxKeys: 4
        }"
      `);
    });

    test("getScopeKey", () => {
      const scopeMaps = [
        undefined,
        null,
        { tenantId: "t1" },
        { tenantId: "t1", label: "l1" },
        { tenantId: "t1", label: "l1", bla: "b1" },
        { bla: "b1", label: "l1", tenantId: "t1" },
        { tenantId: "t1", label: "l1", bla: "b1", naa: "n1" },
      ];

      let i = 0;
      expect(FeatureToggles.getScopeKey(scopeMaps[i++])).toEqual(SCOPE_ROOT_KEY);
      expect(FeatureToggles.getScopeKey(scopeMaps[i++])).toEqual(SCOPE_ROOT_KEY);
      expect(FeatureToggles.getScopeKey(scopeMaps[i++])).toMatchInlineSnapshot(`"tenantId::t1"`);
      expect(FeatureToggles.getScopeKey(scopeMaps[i++])).toMatchInlineSnapshot(`"label::l1##tenantId::t1"`);
      expect(FeatureToggles.getScopeKey(scopeMaps[i++])).toMatchInlineSnapshot(`"bla::b1##label::l1##tenantId::t1"`);
      expect(FeatureToggles.getScopeKey(scopeMaps[i++])).toMatchInlineSnapshot(`"bla::b1##label::l1##tenantId::t1"`);
      expect(FeatureToggles.getScopeKey(scopeMaps[i++])).toMatchInlineSnapshot(
        `"bla::b1##label::l1##naa::n1##tenantId::t1"`
      );
      expect(i).toBe(Object.keys(scopeMaps).length);

      expect(loggerSpy.error).not.toHaveBeenCalled();
    });

    test("getScopeMap", () => {
      const scopeKeys = [
        undefined,
        null,
        SCOPE_ROOT_KEY,
        "tenantId::t1",
        "label::l1##tenantId::t1",
        "bla::b1##label::l1##tenantId::t1",
        "bla::b1##label::l1##naa::n1##tenantId::t1",
      ];

      let i = 0;
      expect(FeatureToggles.getScopeMap(scopeKeys[i++])).toMatchInlineSnapshot(`undefined`);
      expect(FeatureToggles.getScopeMap(scopeKeys[i++])).toMatchInlineSnapshot(`undefined`);
      expect(FeatureToggles.getScopeMap(scopeKeys[i++])).toMatchInlineSnapshot(`undefined`);
      expect(FeatureToggles.getScopeMap(scopeKeys[i++])).toMatchInlineSnapshot(`
        {
          "tenantId": "t1",
        }
      `);
      expect(FeatureToggles.getScopeMap(scopeKeys[i++])).toMatchInlineSnapshot(`
        {
          "label": "l1",
          "tenantId": "t1",
        }
      `);
      expect(FeatureToggles.getScopeMap(scopeKeys[i++])).toMatchInlineSnapshot(`
        {
          "bla": "b1",
          "label": "l1",
          "tenantId": "t1",
        }
      `);
      expect(FeatureToggles.getScopeMap(scopeKeys[i++])).toMatchInlineSnapshot(`
        {
          "bla": "b1",
          "label": "l1",
          "naa": "n1",
          "tenantId": "t1",
        }
      `);
      expect(i).toBe(Object.keys(scopeKeys).length);

      expect(loggerSpy.error).not.toHaveBeenCalled();
    });
  });

  describe("basic apis", () => {
    test("initializeFeatureToggles", async () => {
      await toggles.initializeFeatures({ config: mockConfig });

      expect(toggles.__isInitialized).toBe(true);
      expect(toggles.__fallbackValues).toStrictEqual(mockFallbackValues);
      expect(toggles.__stateScopedValues).toStrictEqual({});
      expect(toggles.__config).toMatchSnapshot();
      expect(redisWrapperMock.watchedHashGetSetObject).toHaveBeenCalledTimes(mockActiveKeys.length);
      for (let fieldIndex = 0; fieldIndex < mockActiveKeys.length; fieldIndex++) {
        expect(redisWrapperMock.watchedHashGetSetObject).toHaveBeenNthCalledWith(
          fieldIndex + 1,
          redisKey,
          mockActiveKeys[fieldIndex],
          expect.any(Function)
        );
      }
      expect(redisWrapperMock.registerMessageHandler).toHaveBeenCalledTimes(1);
      expect(redisWrapperMock.registerMessageHandler).toHaveBeenCalledWith(redisChannel, toggles.__messageHandler);
      expect(redisWrapperMock.subscribe).toHaveBeenCalledTimes(1);
      expect(redisWrapperMock.subscribe).toHaveBeenCalledWith(redisChannel);

      expect(loggerSpy.warning).not.toHaveBeenCalled();
      expect(loggerSpy.error).not.toHaveBeenCalled();
    });

    test("initializeFeatureToggles warns for invalid values", async () => {
      const badMockConfig = {
        [FEATURE.A]: {
          fallbackValue: false, // valid
          type: "boolean",
        },
        [FEATURE.B]: {
          fallbackValue: null, // null not allowed
          type: "string",
        },
        [FEATURE.C]: {
          fallbackValue: "1", // type mismatch
          type: "number",
        },
      };
      const fallbackValues = configToFallbackValues(badMockConfig);
      const activeKeys = configToActiveKeys(badMockConfig);
      await toggles.initializeFeatures({ config: badMockConfig });

      expect(toggles.__isInitialized).toBe(true);
      expect(toggles.__fallbackValues).toStrictEqual(fallbackValues);
      expect(toggles.__stateScopedValues).toStrictEqual({});
      expect(toggles.__config).toMatchSnapshot();
      expect(redisWrapperMock.watchedHashGetSetObject).toHaveBeenCalledTimes(activeKeys.length);
      for (let fieldIndex = 0; fieldIndex < activeKeys.length; fieldIndex++) {
        expect(redisWrapperMock.watchedHashGetSetObject).toHaveBeenNthCalledWith(
          fieldIndex + 1,
          redisKey,
          activeKeys[fieldIndex],
          expect.any(Function)
        );
      }
      expect(redisWrapperMock.registerMessageHandler).toHaveBeenCalledTimes(1);
      expect(redisWrapperMock.registerMessageHandler).toHaveBeenCalledWith(redisChannel, toggles.__messageHandler);
      expect(redisWrapperMock.subscribe).toHaveBeenCalledTimes(1);
      expect(redisWrapperMock.subscribe).toHaveBeenCalledWith(redisChannel);

      expect(loggerSpy.warning).toHaveBeenCalledTimes(1);
      expect(loggerSpy.warning).toHaveBeenCalledWith(expect.any(VError));
      expect(outputFromErrorLogger(loggerSpy.warning.mock.calls)).toMatchInlineSnapshot(`
        "FeatureTogglesError: found invalid fallback values during initialization
        {
          validationErrors: '[{"featureKey":"test/feature_b","errorMessage":"value null is not allowed"},{"featureKey":"test/feature_c","errorMessage":"value \\\\"{0}\\\\" has invalid type {1}, must be {2}","errorMessageValues":["1","string","number"]}]'
        }"
      `);
      expect(loggerSpy.error).not.toHaveBeenCalled();
    });

    test("_changeRemoteFeatureValues", async () => {
      await toggles.initializeFeatures({ config: mockConfig });
      redisWrapperMock.watchedHashGetSetObject.mockClear();

      const beforeValues = stateFromInfos(await toggles.getFeaturesInfos());
      await toggles._changeRemoteFeatureValue(FEATURE.B, null);
      await toggles._changeRemoteFeatureValue(FEATURE.C, "new_a");
      const afterValues = stateFromInfos(await toggles.getFeaturesInfos());

      expect(redisWrapperMock.watchedHashGetSetObject).toHaveBeenCalledTimes(2);
      expect(redisWrapperMock.watchedHashGetSetObject).toHaveBeenNthCalledWith(
        1,
        redisKey,
        FEATURE.B,
        expect.any(Function)
      );
      expect(redisWrapperMock.watchedHashGetSetObject).toHaveBeenNthCalledWith(
        2,
        redisKey,
        FEATURE.C,
        expect.any(Function)
      );
      expect(redisWrapperMock.publishMessage).toHaveBeenCalledTimes(2);
      expect(redisWrapperMock.publishMessage.mock.calls).toMatchInlineSnapshot(`
        [
          [
            "feature-channel",
            "[{"featureKey":"test/feature_b","newValue":null}]",
          ],
          [
            "feature-channel",
            "[{"featureKey":"test/feature_c","newValue":"new_a"}]",
          ],
        ]
      `);

      expect(beforeValues).toMatchSnapshot();
      expect(afterValues).toMatchSnapshot();

      expect(loggerSpy.warning).not.toHaveBeenCalled();
      expect(loggerSpy.error).not.toHaveBeenCalled();
    });

    test("validateFeatureValue", async () => {
      await toggles.initializeFeatures({ config: mockConfig });

      const inputArgsList = [
        [FEATURE.A, true],
        ["nonsense", true],
        [FEATURE.B, {}],
        [FEATURE.B, true],
        [FEATURE.E, 10],
      ];

      let i = 0;
      expect(await toggles.validateFeatureValue(...inputArgsList[i++])).toMatchInlineSnapshot(`[]`);
      expect(await toggles.validateFeatureValue(...inputArgsList[i++])).toMatchInlineSnapshot(`
        [
          {
            "errorMessage": "feature key is not valid",
            "featureKey": "nonsense",
          },
        ]
      `);
      expect(await toggles.validateFeatureValue(...inputArgsList[i++])).toMatchInlineSnapshot(`
        [
          {
            "errorMessage": "value "{0}" has invalid type {1}, must be in {2}",
            "errorMessageValues": [
              {},
              "object",
              [
                "string",
                "number",
                "boolean",
              ],
            ],
            "featureKey": "test/feature_b",
          },
        ]
      `);
      expect(await toggles.validateFeatureValue(...inputArgsList[i++])).toMatchInlineSnapshot(`
        [
          {
            "errorMessage": "value "{0}" has invalid type {1}, must be {2}",
            "errorMessageValues": [
              true,
              "boolean",
              "number",
            ],
            "featureKey": "test/feature_b",
          },
        ]
      `);
      expect(await toggles.validateFeatureValue(...inputArgsList[i++])).toMatchInlineSnapshot(`
        [
          {
            "errorMessage": "value "{0}" does not match validation regular expression {1}",
            "errorMessageValues": [
              10,
              "/^\\d{1}$/",
            ],
            "featureKey": "test/feature_e",
          },
        ]
      `);
      expect(i).toBe(inputArgsList.length);

      expect(loggerSpy.warning).not.toHaveBeenCalled();
      expect(loggerSpy.error).not.toHaveBeenCalled();
    });

    test("validateFeatureValue with scopes", async () => {
      await toggles.initializeFeatures({ config: mockConfig });

      const inputArgsList = [
        [FEATURE.A, 1, { a: "1" }],
        [FEATURE.A, 1, "a::1"],
        [FEATURE.AA, true],
        [FEATURE.AA, true, { tenant: "t1", user: "u1" }],
        [FEATURE.AA, true, { tenant: "t1" }],
        [FEATURE.AA, true, { user: "u1" }],
        [FEATURE.AA, true, { usr: "u1" }],
        [FEATURE.AA, true, { Tenant: "t1" }],
      ];

      let i = 0;
      expect(await toggles.validateFeatureValue(...inputArgsList[i++])).toMatchInlineSnapshot(`
        [
          {
            "errorMessage": "value "{0}" has invalid type {1}, must be {2}",
            "errorMessageValues": [
              1,
              "number",
              "boolean",
            ],
            "featureKey": "test/feature_a",
            "scopeKey": "a::1",
          },
        ]
      `);
      expect(await toggles.validateFeatureValue(...inputArgsList[i++])).toMatchInlineSnapshot(`
        [
          {
            "errorMessage": "scopeMap must be undefined or an object",
            "featureKey": "test/feature_a",
          },
        ]
      `);
      expect(await toggles.validateFeatureValue(...inputArgsList[i++])).toMatchInlineSnapshot(`[]`);
      expect(await toggles.validateFeatureValue(...inputArgsList[i++])).toMatchInlineSnapshot(`[]`);
      expect(await toggles.validateFeatureValue(...inputArgsList[i++])).toMatchInlineSnapshot(`[]`);
      expect(await toggles.validateFeatureValue(...inputArgsList[i++])).toMatchInlineSnapshot(`[]`);
      expect(await toggles.validateFeatureValue(...inputArgsList[i++])).toMatchInlineSnapshot(`
        [
          {
            "errorMessage": "scope "{0}" is not allowed",
            "errorMessageValues": [
              "usr",
            ],
            "featureKey": "test/feature_aa",
          },
        ]
      `);
      expect(await toggles.validateFeatureValue(...inputArgsList[i++])).toMatchInlineSnapshot(`
        [
          {
            "errorMessage": "scope "{0}" is not allowed",
            "errorMessageValues": [
              "Tenant",
            ],
            "featureKey": "test/feature_aa",
          },
        ]
      `);
      expect(i).toBe(inputArgsList.length);

      expect(loggerSpy.warning).not.toHaveBeenCalled();
      expect(loggerSpy.error).not.toHaveBeenCalled();
    });

    test("validateFeatureValue should fail if not initialized", async () => {
      expect(await toggles.validateFeatureValue(FEATURE.E, 1)).toMatchInlineSnapshot(`
        [
          {
            "errorMessage": "not initialized",
          },
        ]
      `);

      await toggles.initializeFeatures({ config: mockConfig });
      expect(await toggles.validateFeatureValue(FEATURE.E, 1)).toStrictEqual([]);
    });

    test("isValidFeatureValueType", async () => {
      const invalidTypes = [undefined, () => {}, [], {}];
      const validTypes = [null, 0, "", true];
      expect(invalidTypes.map(FeatureToggles._isValidFeatureValueType)).toStrictEqual(invalidTypes.map(() => false));
      expect(validTypes.map(FeatureToggles._isValidFeatureValueType)).toStrictEqual(validTypes.map(() => true));
    });

    test("isValidFeatureKey", async () => {
      await toggles.initializeFeatures({ config: mockConfig });

      const invalidKeys = [undefined, () => {}, [], {}, null, 0, "", true, "nonsense"];
      const validKeys = Object.keys(mockConfig);
      expect(invalidKeys.map((key) => FeatureToggles._isValidFeatureKey(toggles.__fallbackValues, key))).toStrictEqual(
        invalidKeys.map(() => false)
      );
      expect(validKeys.map((key) => FeatureToggles._isValidFeatureKey(toggles.__fallbackValues, key))).toStrictEqual(
        validKeys.map(() => true)
      );

      expect(loggerSpy.warning).not.toHaveBeenCalled();
      expect(loggerSpy.error).not.toHaveBeenCalled();
    });

    test("getFeatureInfo", async () => {
      await toggles.initializeFeatures({ config: mockConfig });
      expect(toggles.getFeatureInfo(FEATURE.A)).toMatchInlineSnapshot(`
        {
          "config": {
            "SOURCE": "RUNTIME",
            "TYPE": "boolean",
          },
          "fallbackValue": false,
        }
      `);
      expect(toggles.getFeatureInfo(FEATURE.B)).toMatchInlineSnapshot(`
        {
          "config": {
            "SOURCE": "RUNTIME",
            "TYPE": "number",
          },
          "fallbackValue": 1,
        }
      `);
      expect(toggles.getFeatureInfo(FEATURE.C)).toMatchInlineSnapshot(`
        {
          "config": {
            "SOURCE": "RUNTIME",
            "TYPE": "string",
          },
          "fallbackValue": "best",
        }
      `);
    });

    test("getFeaturesInfos", async () => {
      await toggles.initializeFeatures({ config: mockConfig });
      expect(toggles.getFeaturesInfos()).toMatchSnapshot();
    });

    test("getFeatureValue", async () => {
      const mockFeatureValuesEntries = [
        [[FEATURE.A], { [SCOPE_ROOT_KEY]: true }],
        [[FEATURE.AA], { [SCOPE_ROOT_KEY]: true }],
        [[FEATURE.B], { [SCOPE_ROOT_KEY]: 0 }],
        [[FEATURE.C], { [SCOPE_ROOT_KEY]: "cvalue" }],
      ];
      const mockFeatureValues = Object.fromEntries(mockFeatureValuesEntries);
      const otherEntries = [
        ["d", "avalue"],
        ["e", "bvalue"],
        ["f", "cvalue"],
      ];
      for (let i = 0; i < mockFeatureValuesEntries.length; i++) {
        redisWrapperMock.watchedHashGetSetObject.mockImplementationOnce((key, field) => mockFeatureValues[field]);
      }
      await toggles.initializeFeatures({ config: mockConfig });

      expect(mockFeatureValuesEntries.map(([key]) => toggles.getFeatureValue(key))).toStrictEqual(
        mockFeatureValuesEntries.map(([, value]) => value[SCOPE_ROOT_KEY])
      );
      expect(otherEntries.map(([key]) => toggles.getFeatureValue(key))).toStrictEqual(otherEntries.map(() => null));

      expect(loggerSpy.warning).not.toHaveBeenCalled();
      expect(loggerSpy.error).not.toHaveBeenCalled();
    });

    test("getFeatureValue with scoping", async () => {
      const testScopeMap = { tenant: "t1" };
      const testScopeKey = FeatureToggles.getScopeKey(testScopeMap);
      const mockFeatureValuesEntries = [
        [[FEATURE.A], { [SCOPE_ROOT_KEY]: true, [testScopeKey]: false }],
        [[FEATURE.AA], { [SCOPE_ROOT_KEY]: true, [testScopeKey]: false }],
        [[FEATURE.B], { [SCOPE_ROOT_KEY]: 0, [testScopeKey]: 10 }],
        [[FEATURE.C], { [SCOPE_ROOT_KEY]: "cvalue", [testScopeKey]: "" }],
      ];
      const mockFeatureValues = Object.fromEntries(mockFeatureValuesEntries);
      const otherEntries = [
        ["d", "avalue"],
        ["e", "bvalue"],
        ["f", "cvalue"],
      ];
      for (let i = 0; i < mockFeatureValuesEntries.length; i++) {
        redisWrapperMock.watchedHashGetSetObject.mockImplementationOnce((key, field) => mockFeatureValues[field]);
      }
      await toggles.initializeFeatures({ config: mockConfig });

      expect(mockFeatureValuesEntries.map(([key]) => toggles.getFeatureValue(key))).toStrictEqual(
        mockFeatureValuesEntries.map(([, value]) => value[SCOPE_ROOT_KEY])
      );
      expect(mockFeatureValuesEntries.map(([key]) => toggles.getFeatureValue(key, testScopeMap))).toStrictEqual(
        mockFeatureValuesEntries.map(([, value]) => value[testScopeKey])
      );
      expect(otherEntries.map(([key]) => toggles.getFeatureValue(key))).toStrictEqual(otherEntries.map(() => null));

      expect(loggerSpy.warning).not.toHaveBeenCalled();
      expect(loggerSpy.error).not.toHaveBeenCalled();
    });

    test("changeFeatureValue", async () => {
      await toggles.initializeFeatures({ config: mockConfig });
      redisWrapperMock.watchedHashGetSetObject.mockClear();

      expect(await toggles.changeFeatureValue(FEATURE.C, "newa")).toBeUndefined();
      expect(redisWrapperMock.watchedHashGetSetObject).toHaveBeenCalledTimes(1);
      expect(redisWrapperMock.watchedHashGetSetObject).toHaveBeenCalledWith(redisKey, FEATURE.C, expect.any(Function));
      expect(redisWrapperMock.publishMessage).toHaveBeenCalledTimes(1);
      expect(redisWrapperMock.publishMessage.mock.calls).toMatchInlineSnapshot(`
        [
          [
            "feature-channel",
            "[{"featureKey":"test/feature_c","newValue":"newa"}]",
          ],
        ]
      `);
      expect(redisWrapperMock.getObject).toHaveBeenCalledTimes(0);

      expect(loggerSpy.warning).not.toHaveBeenCalled();
      expect(loggerSpy.error).not.toHaveBeenCalled();
    });

    test("changeFeatureValue failing", async () => {
      await toggles.initializeFeatures({ config: mockConfig });
      redisWrapperMock.watchedHashGetSetObject.mockClear();

      const validationErrorsInvalidKey = await toggles.changeFeatureValue("invalid", 1);
      expect(validationErrorsInvalidKey).toMatchInlineSnapshot(`
        [
          {
            "errorMessage": "feature key is not valid",
            "featureKey": "invalid",
          },
        ]
      `);
      expect(redisWrapperMock.watchedHashGetSetObject).not.toHaveBeenCalled();
      expect(redisWrapperMock.publishMessage).not.toHaveBeenCalled();
      expect(redisWrapperMock.getObject).not.toHaveBeenCalled();

      expect(loggerSpy.warning).not.toHaveBeenCalled();
      expect(loggerSpy.error).not.toHaveBeenCalled();
    });

    test("refreshFeatureValues", async () => {
      await toggles.initializeFeatures({ config: mockConfig });
      expect(toggles.__stateScopedValues).toStrictEqual({});
      const remoteState = { [FEATURE.B]: { [SCOPE_ROOT_KEY]: 42 } };
      redisWrapperMock._setValue(FEATURE.B, { [SCOPE_ROOT_KEY]: 42 });
      redisWrapperMock.watchedHashGetSetObject.mockClear();

      await toggles.refreshFeatureValues();
      expect(redisWrapperMock.watchedHashGetSetObject).toHaveBeenCalledTimes(mockActiveKeys.length);
      for (let fieldIndex = 0; fieldIndex < mockActiveKeys.length; fieldIndex++) {
        expect(redisWrapperMock.watchedHashGetSetObject).toHaveBeenNthCalledWith(
          fieldIndex + 1,
          redisKey,
          mockActiveKeys[fieldIndex],
          expect.any(Function)
        );
      }
      expect(toggles.__stateScopedValues).toStrictEqual(remoteState);

      expect(loggerSpy.warning).not.toHaveBeenCalled();
      expect(loggerSpy.error).not.toHaveBeenCalled();
    });

    test("refreshFeatureValues with invalid state", async () => {
      await toggles.initializeFeatures({ config: mockConfig });
      expect(toggles.__stateScopedValues).toStrictEqual({});
      redisWrapperMock.watchedHashGetSetObject.mockClear();

      redisWrapperMock._setValue(FEATURE.B, { [SCOPE_ROOT_KEY]: 42 }); // valid state
      redisWrapperMock._setValue(FEATURE.E, { [SCOPE_ROOT_KEY]: 10 }); // invalid state
      await toggles.refreshFeatureValues();

      expect(redisWrapperMock.watchedHashGetSetObject).toHaveBeenCalledTimes(mockActiveKeys.length);
      for (let fieldIndex = 0; fieldIndex < mockActiveKeys.length; fieldIndex++) {
        expect(redisWrapperMock.watchedHashGetSetObject).toHaveBeenNthCalledWith(
          fieldIndex + 1,
          redisKey,
          mockActiveKeys[fieldIndex],
          expect.any(Function)
        );
      }
      expect(toggles.__stateScopedValues).toStrictEqual({ [FEATURE.B]: { [SCOPE_ROOT_KEY]: 42 } });

      expect(loggerSpy.warning.mock.calls).toMatchInlineSnapshot(`
        [
          [
            [FeatureTogglesError: removed invalid entries from redis during refresh],
          ],
        ]
      `);
      expect(loggerSpy.error).not.toHaveBeenCalled();
    });

    test("FeatureValueChangeHandler and changeFeatureValue", async () => {
      const newValue = "newValue";
      const newNewValue = "newNewValue";
      await toggles.initializeFeatures({ config: mockConfig });
      const oldValue = toggles.getFeatureValue(FEATURE.C);
      const handler = jest.fn();
      toggles.registerFeatureValueChangeHandler(FEATURE.C, handler);

      // other toggle
      await toggles.changeFeatureValue(FEATURE.B, 100);
      expect(handler).not.toHaveBeenCalled();

      // right toggle
      await toggles.changeFeatureValue(FEATURE.B, 101);
      await toggles.changeFeatureValue(FEATURE.C, newValue);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(newValue, oldValue, undefined, undefined);

      expect(loggerSpy.warning).not.toHaveBeenCalled();
      expect(loggerSpy.error).not.toHaveBeenCalled();

      // right toggle but throwing
      const error = new Error("bad handler");
      handler.mockClear();
      handler.mockRejectedValue(error);
      await toggles.changeFeatureValue(FEATURE.B, 102);
      await toggles.changeFeatureValue(FEATURE.C, newNewValue);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(newNewValue, newValue, undefined, undefined);
      expect(loggerSpy.error).toHaveBeenCalledTimes(1);
      expect(loggerSpy.error).toHaveBeenCalledWith(
        expect.objectContaining({
          jse_cause: error,
        })
      );
    });

    test("FeatureValueValidation", async () => {
      const newValue = "newValue";
      await toggles.initializeFeatures({ config: mockConfig });

      const validator = jest.fn();
      toggles.registerFeatureValueValidation(FEATURE.C, validator);

      // other toggle
      expect(await toggles.changeFeatureValue(FEATURE.B, 100)).toBeUndefined();
      expect(validator).toHaveBeenCalledTimes(0);
      validator.mockClear();

      // right toggle
      expect(await toggles.changeFeatureValue(FEATURE.B, 101)).toBeUndefined();
      expect(await toggles.changeFeatureValue(FEATURE.C, newValue)).toBeUndefined();

      // NOTE: we get called twice here once for upstream to redis and once downstream from redis
      expect(validator).toHaveBeenCalledTimes(2);
      expect(validator).toHaveBeenNthCalledWith(1, newValue, undefined, SCOPE_ROOT_KEY);
      expect(validator).toHaveBeenNthCalledWith(2, newValue, undefined, SCOPE_ROOT_KEY);

      // with scopes
      validator.mockClear();
      const testScopeMap = { domain: "value " };
      const testScopeKey = FeatureToggles.getScopeKey(testScopeMap);
      expect(await toggles.changeFeatureValue(FEATURE.B, 102, testScopeMap)).toBeUndefined();
      expect(await toggles.changeFeatureValue(FEATURE.C, newValue, testScopeMap)).toBeUndefined();

      expect(validator).toHaveBeenCalledTimes(2);
      expect(validator).toHaveBeenNthCalledWith(1, newValue, testScopeMap, testScopeKey);
      expect(validator).toHaveBeenNthCalledWith(2, newValue, testScopeMap, testScopeKey);

      // right toggle but failing
      validator.mockClear();
      const mockErrorMessage = "wrong input";
      validator.mockResolvedValueOnce({ errorMessage: mockErrorMessage });
      expect(await toggles.changeFeatureValue(FEATURE.B, 103)).toBeUndefined();
      expect(await toggles.changeFeatureValue(FEATURE.C, newValue)).toMatchInlineSnapshot(`
        [
          {
            "errorMessage": "wrong input",
            "featureKey": "test/feature_c",
            "scopeKey": "//",
          },
        ]
      `);
      expect(validator).toHaveBeenCalledTimes(1);
      expect(validator).toHaveBeenCalledWith(newValue, undefined, SCOPE_ROOT_KEY);

      // right toggle but failing with messageValues
      validator.mockClear();
      const mockErrorMessageWithValues = "wrong input {0} {1}";
      const mockErrorMessageValues = ["value1", 2];
      validator.mockResolvedValueOnce({
        errorMessage: mockErrorMessageWithValues,
        errorMessageValues: mockErrorMessageValues,
      });
      expect(await toggles.changeFeatureValue(FEATURE.B, 104)).toBeUndefined();
      expect(await toggles.changeFeatureValue(FEATURE.C, newValue)).toMatchInlineSnapshot(`
        [
          {
            "errorMessage": "wrong input {0} {1}",
            "errorMessageValues": [
              "value1",
              2,
            ],
            "featureKey": "test/feature_c",
            "scopeKey": "//",
          },
        ]
      `);
      expect(validator).toHaveBeenCalledTimes(1);
      expect(validator).toHaveBeenCalledWith(newValue, undefined, SCOPE_ROOT_KEY);

      // right toggle but failing with multiple errors
      validator.mockClear();
      validator.mockResolvedValueOnce([
        {
          key: "wrong key",
          useless: "useless property",
          errorMessage: mockErrorMessage,
        },
        {
          key: "wrong key",
          useless: "useless property",
          errorMessage: mockErrorMessageWithValues,
          errorMessageValues: mockErrorMessageValues,
        },
      ]);
      expect(await toggles.changeFeatureValue(FEATURE.B, 105)).toBeUndefined();
      expect(await toggles.changeFeatureValue(FEATURE.C, newValue)).toMatchInlineSnapshot(`
        [
          {
            "errorMessage": "wrong input",
            "featureKey": "test/feature_c",
            "scopeKey": "//",
          },
          {
            "errorMessage": "wrong input {0} {1}",
            "errorMessageValues": [
              "value1",
              2,
            ],
            "featureKey": "test/feature_c",
            "scopeKey": "//",
          },
        ]
      `);
      expect(validator).toHaveBeenCalledTimes(1);
      expect(validator).toHaveBeenCalledWith(newValue, undefined, SCOPE_ROOT_KEY);

      expect(loggerSpy.warning).not.toHaveBeenCalled();
      expect(loggerSpy.error).not.toHaveBeenCalled();
    });

    test("FeatureValueValidation and inactive", async () => {
      const newValue = "newValue";
      await toggles.initializeFeatures({ config: mockConfig });
      const oldValue = toggles.getFeatureValue(FEATURE.G);
      const featureConfig = toggles.getFeatureInfo(FEATURE.G).config;

      expect(featureConfig.ACTIVE).toBe(false);
      expect(await toggles.changeFeatureValue(FEATURE.G, newValue)).toMatchInlineSnapshot(`
        [
          {
            "errorMessage": "feature key is not active",
            "featureKey": "test/feature_g",
          },
        ]
      `);
      expect(toggles.getFeatureValue(FEATURE.G)).toBe(oldValue);
    });

    test("FeatureValueValidation and appUrl working", async () => {
      envMock.cfApp = { uris: ["https://it.cfapps.sap.hana.ondemand.com"] };
      const newValue = "newValue";
      await toggles.initializeFeatures({ config: mockConfig });
      const featureConfig = toggles.getFeatureInfo(FEATURE.H).config;

      expect(featureConfig.APP_URL).toMatchInlineSnapshot(`"\\.cfapps\\.sap\\.hana\\.ondemand\\.com$"`);
      expect(featureConfig.APP_URL_ACTIVE).toBeUndefined();
      expect(await toggles.changeFeatureValue(FEATURE.H, newValue)).toBeUndefined();
      expect(toggles.getFeatureValue(FEATURE.H)).toBe(newValue);
    });

    test("FeatureValueValidation and appUrl failing", async () => {
      envMock.cfApp = { uris: ["https://not-it.com"] };
      const newValue = "newValue";
      await toggles.initializeFeatures({ config: mockConfig });
      const oldValue = toggles.getFeatureValue(FEATURE.H);
      const featureConfig = toggles.getFeatureInfo(FEATURE.H).config;

      expect(featureConfig.APP_URL).toMatchInlineSnapshot(`"\\.cfapps\\.sap\\.hana\\.ondemand\\.com$"`);
      expect(featureConfig.APP_URL_ACTIVE).toBe(false);
      expect(await toggles.changeFeatureValue(FEATURE.H, newValue)).toMatchInlineSnapshot(`
        [
          {
            "errorMessage": "feature key is not active because app url does not match regular expression {0}",
            "errorMessageValues": [
              "\\.cfapps\\.sap\\.hana\\.ondemand\\.com$",
            ],
            "featureKey": "test/feature_h",
          },
        ]
      `);
      expect(toggles.getFeatureValue(FEATURE.H)).toBe(oldValue);
    });

    test("validateInput throws error", async () => {
      const error = new Error("bad validator");
      const validator = jest.fn().mockRejectedValue(error);

      await toggles.initializeFeatures({ config: mockConfig });

      toggles.registerFeatureValueValidation(FEATURE.B, validator);

      expect(await toggles.changeFeatureValue(FEATURE.B, 100)).toMatchInlineSnapshot(`
        [
          {
            "errorMessage": "registered validator "{0}" failed for value "{1}" with error {2}",
            "errorMessageValues": [
              "mockConstructor",
              100,
              "bad validator",
            ],
            "featureKey": "test/feature_b",
            "scopeKey": "//",
          },
        ]
      `);

      expect(loggerSpy.warning).not.toHaveBeenCalled();
      expect(loggerSpy.error).toHaveBeenCalledTimes(1);
      expect(loggerSpy.error).toHaveBeenCalledWith(
        expect.objectContaining({
          jse_cause: error,
        })
      );
    });
  });

  describe("readConfigFromFile", () => {
    test("readConfigFromFile json", async () => {
      const mockFilePath = "inmemory.json";
      const mockConfigData = Buffer.from(JSON.stringify(mockConfig));
      readFileSpy.mockImplementationOnce((filename, callback) => callback(null, mockConfigData));
      const config = await FeatureToggles.readConfigFromFile(mockFilePath);

      expect(readFileSpy).toHaveBeenCalledTimes(1);
      expect(readFileSpy).toHaveBeenCalledWith(mockFilePath, expect.any(Function));
      expect(config).toStrictEqual(mockConfig);
    });

    test("readConfigFromFile yaml", async () => {
      const mockFilePath = "in_memory.yml";
      const mockConfigData = Buffer.from(yaml.stringify(mockConfig));
      readFileSpy.mockImplementationOnce((filename, callback) => callback(null, mockConfigData));
      const config = await FeatureToggles.readConfigFromFile(mockFilePath);

      expect(readFileSpy).toHaveBeenCalledTimes(1);
      expect(readFileSpy).toHaveBeenCalledWith(mockFilePath, expect.any(Function));
      expect(config).toStrictEqual(mockConfig);
    });
  });

  describe("always fallback", () => {
    const fallbackValue = "fallback";
    const fallbackValues = { [FEATURE.A]: fallbackValue, [FEATURE.B]: fallbackValue };
    const config = {
      [FEATURE.A]: { fallbackValue, type: "string", validations: [{ regex: "^fall" }] },
      [FEATURE.B]: { fallbackValue, type: "string", validations: [{ regex: "^xxx" }] },
    };

    beforeEach(async () => {
      await toggles.initializeFeatures({
        config,
      });
      loggerSpy.warning.mockClear();
    });

    test("setup sanity", async () => {
      const oldValueA = toggles.getFeatureValue(FEATURE.A);
      const oldValueB = toggles.getFeatureValue(FEATURE.B);
      expect(oldValueA).toBe(fallbackValue);
      expect(oldValueB).toBe(fallbackValue);
      expect(fallbackValuesFromInfos(toggles.getFeaturesInfos())).toStrictEqual(fallbackValues);
    });

    test("refreshFeatureValues and central state is invalid", async () => {
      const remoteStateA = { [FEATURE.A]: { [SCOPE_ROOT_KEY]: "central" } };
      redisWrapperMock._setValues(remoteStateA);
      await toggles.refreshFeatureValues();

      expect(toggles.__stateScopedValues).toStrictEqual({});
      const afterRemoteInvalidValueA = toggles.getFeatureValue(FEATURE.A);
      expect(afterRemoteInvalidValueA).toBe(fallbackValue);

      expect(loggerSpy.warning.mock.calls).toMatchInlineSnapshot(`
        [
          [
            [FeatureTogglesError: removed invalid entries from redis during refresh],
          ],
        ]
      `);
      expect(loggerSpy.error).not.toHaveBeenCalled();
    });

    test("refreshFeatureValues and central state is invalid and fallback value is invalid", async () => {
      const remoteStateB = { [FEATURE.B]: { [SCOPE_ROOT_KEY]: "central" } };
      redisWrapperMock._setValues(remoteStateB);
      await toggles.refreshFeatureValues();

      expect(toggles.__stateScopedValues).toStrictEqual({});
      const afterRemoteInvalidValueB = toggles.getFeatureValue(FEATURE.B);
      expect(afterRemoteInvalidValueB).toBe(fallbackValue);

      expect(loggerSpy.warning.mock.calls).toMatchInlineSnapshot(`
        [
          [
            [FeatureTogglesError: removed invalid entries from redis during refresh],
          ],
        ]
      `);
      expect(loggerSpy.error).not.toHaveBeenCalled();
    });

    test("changeFeatureValues and valid state and valid fallback with delete", async () => {
      expect(await toggles.changeFeatureValue(FEATURE.A, "fallout")).toBeUndefined();
      expect(toggles.__stateScopedValues).toMatchInlineSnapshot(`
        {
          "test/feature_a": {
            "//": "fallout",
          },
        }
      `);

      expect(await toggles.changeFeatureValue(FEATURE.A, null)).toBeUndefined();

      // NOTE: deleting will keep the fallback value as state since they are valid
      expect(toggles.__stateScopedValues).toStrictEqual({});
      const afterA = toggles.getFeatureValue(FEATURE.A);
      expect(afterA).toBe(fallbackValue);

      expect(loggerSpy.warning).not.toHaveBeenCalled();
      expect(loggerSpy.error).not.toHaveBeenCalled();
    });

    test("changeFeatureValues and invalid state and invalid fallback with delete", async () => {
      expect(await toggles.changeFeatureValue(FEATURE.B, "fallout")).toMatchInlineSnapshot(`
        [
          {
            "errorMessage": "value "{0}" does not match validation regular expression {1}",
            "errorMessageValues": [
              "fallout",
              "/^xxx/",
            ],
            "featureKey": "test/feature_b",
            "scopeKey": "//",
          },
        ]
      `);
      expect(toggles.__stateScopedValues).toStrictEqual({});

      expect(await toggles.changeFeatureValue(FEATURE.B, null)).toBeUndefined();

      // NOTE: we still get the validFallbackValues of the test setup
      expect(toggles.__stateScopedValues).toStrictEqual({});
      const afterB = toggles.getFeatureValue(FEATURE.B);
      expect(afterB).toBe(fallbackValue);

      expect(loggerSpy.warning).not.toHaveBeenCalled();
      expect(loggerSpy.error).not.toHaveBeenCalled();
    });
  });

  describe("active to inactive to active again", () => {
    test("setting a toggle inactive does not change it in redis on init or refresh", async () => {
      await toggles.initializeFeatures({
        config: {
          [FEATURE.B]: {
            fallbackValue: 1,
            type: "number",
          },
        },
      });
      expect(redisWrapperMock.watchedHashGetSetObject.mock.calls.filter(([, key]) => key === FEATURE.B).length).toBe(1);
      expect(toggles.getFeatureValue(FEATURE.B)).toBe(1);

      // change is propagated to mock redis
      expect(await toggles.changeFeatureValue(FEATURE.B, 10)).toBeUndefined();
      expect(toggles.getFeatureValue(FEATURE.B)).toBe(10);
      expect(redisWrapperMock.watchedHashGetSetObject.mock.calls.filter(([, key]) => key === FEATURE.B).length).toBe(2);

      // !! first reset
      redisWrapperMock.watchedHashGetSetObject.mockClear();
      toggles._reset({ redisKey, redisChannel });
      await toggles.initializeFeatures({
        config: {
          [FEATURE.B]: {
            active: false,
            fallbackValue: 2,
            type: "number",
          },
        },
      });
      // remote value is ignored because key is inactive
      expect(toggles.getFeatureValue(FEATURE.B)).toBe(2);
      // change is blocked because key is inactive
      expect(await toggles.changeFeatureValue(FEATURE.B, 20)).toMatchInlineSnapshot(`
        [
          {
            "errorMessage": "feature key is not active",
            "featureKey": "test/feature_b",
          },
        ]
      `);
      expect(toggles.getFeatureValue(FEATURE.B)).toBe(2);

      // remote value is also ignored during refresh because key is inactive
      await toggles.refreshFeatureValues();
      expect(toggles.getFeatureValue(FEATURE.B)).toBe(2);
      expect(redisWrapperMock.watchedHashGetSetObject.mock.calls.filter(([, key]) => key === FEATURE.B).length).toBe(0);

      // !! second reset
      redisWrapperMock.watchedHashGetSetObject.mockClear();
      toggles._reset({ redisKey, redisChannel });
      await toggles.initializeFeatures({
        config: {
          [FEATURE.B]: {
            fallbackValue: 3,
            type: "number",
          },
        },
      });
      expect(redisWrapperMock.watchedHashGetSetObject.mock.calls.filter(([, key]) => key === FEATURE.B).length).toBe(1);
      // after re-activation we get the remote state
      expect(toggles.getFeatureValue(FEATURE.B)).toBe(10);
      // after re-activation we can change again
      expect(await toggles.changeFeatureValue(FEATURE.B, 30)).toBeUndefined();
      expect(toggles.getFeatureValue(FEATURE.B)).toBe(30);
      expect(redisWrapperMock.watchedHashGetSetObject.mock.calls.filter(([, key]) => key === FEATURE.B).length).toBe(2);

      expect(loggerSpy.warning).not.toHaveBeenCalled();
      expect(loggerSpy.error).not.toHaveBeenCalled();
    });
  });

  describe("message handling", () => {
    beforeEach(async () => {
      await toggles.initializeFeatures({ config: mockConfig });
    });

    test("empty array should be handled fine", async () => {
      await redisWrapperMock.publishMessage(toggles.__redisChannel, "[]");
      expect(loggerSpy.warning).toHaveBeenCalledTimes(0);
      expect(loggerSpy.error).toHaveBeenCalledTimes(0);
    });

    test("error in case message is not a serialized array", async () => {
      await redisWrapperMock.publishMessage(toggles.__redisChannel, "hello world!");
      expect(loggerSpy.warning).toHaveBeenCalledTimes(0);
      expect(loggerSpy.error).toHaveBeenCalledTimes(1);
      expect(outputFromErrorLogger(loggerSpy.error.mock.calls)).toMatchInlineSnapshot(`
        "FeatureTogglesError: error during message deserialization
        { channel: 'feature-channel', message: 'hello world!' }"
      `);
    });

    test("invalid change entries are ignored but logged", async () => {
      const changeEntries = [{ featureKey: FEATURE.C, newValue: 10 }];

      expect(toggles.getFeatureValue(FEATURE.C)).toBe(mockFallbackValues[FEATURE.C]);

      await redisWrapperMock.publishMessage(toggles.__redisChannel, JSON.stringify(changeEntries));

      expect(loggerSpy.warning).toHaveBeenCalledTimes(1);
      expect(outputFromErrorLogger(loggerSpy.warning.mock.calls)).toMatchInlineSnapshot(`
        "FeatureTogglesError: received and ignored invalid value from message
        {
          validationErrors: '[{"featureKey":"test/feature_c","scopeKey":"//","errorMessage":"value \\\\"{0}\\\\" has invalid type {1}, must be {2}","errorMessageValues":[10,"number","string"]}]'
        }"
      `);

      expect(toggles.getFeatureValue(FEATURE.C)).toBe(mockFallbackValues[FEATURE.C]);
    });

    test("all change entries are processed even if one fails", async () => {
      const scopeMap = { tenant: "testing" };
      const changeEntries = [
        { featureKey: FEATURE.C, newValue: "modified" },
        {},
        null,
        "bla",
        { featureKey: FEATURE.E, newValue: 9, scopeMap },
      ];

      expect(toggles.getFeatureValue(FEATURE.C)).toBe(mockFallbackValues[FEATURE.C]);
      expect(toggles.getFeatureValue(FEATURE.E, scopeMap)).toBe(mockFallbackValues[FEATURE.E]);

      await redisWrapperMock.publishMessage(toggles.__redisChannel, JSON.stringify(changeEntries));

      expect(loggerSpy.warning).toHaveBeenCalledTimes(3);
      expect(outputFromErrorLogger(loggerSpy.warning.mock.calls)).toMatchInlineSnapshot(`
        "FeatureTogglesError: received and ignored change entry
        { changeEntry: '{}' }
        FeatureTogglesError: received and ignored change entry
        { changeEntry: 'null' }
        FeatureTogglesError: received and ignored change entry
        { changeEntry: '"bla"' }"
      `);
      expect(loggerSpy.error).toHaveBeenCalledTimes(0);

      expect(toggles.getFeatureValue(FEATURE.C)).toMatchInlineSnapshot(`"modified"`);
      expect(toggles.getFeatureValue(FEATURE.E, scopeMap)).toMatchInlineSnapshot(`9`);
    });
  });

  describe("changeHandler details", () => {
    const handler = jest.fn();
    const tenant = "t1";
    const user = "u1";
    const fallbackValue = mockFallbackValues[FEATURE.C];
    const rootValue = "root";
    const tenantValue = "t1";
    const tenantUserValue = "t1u1";

    beforeEach(async () => {
      await toggles.initializeFeatures({ config: mockConfig });
      toggles.registerFeatureValueChangeHandler(FEATURE.C, handler);
      await toggles.changeFeatureValue(FEATURE.C, rootValue);
      await toggles.changeFeatureValue(FEATURE.C, tenantValue, { tenant });
      await toggles.changeFeatureValue(FEATURE.C, tenantUserValue, { tenant, user });
      jest.clearAllMocks();
    });

    test("reset tenantUser should fall back to tenant", async () => {
      await toggles.changeFeatureValue(FEATURE.C, null, { tenant, user });
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(tenantValue, tenantUserValue, { tenant, user }, undefined);
    });
    test("reset tenant should fall back to root", async () => {
      await toggles.changeFeatureValue(FEATURE.C, null, { tenant });
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(rootValue, tenantValue, { tenant }, undefined);
    });
    test("reset root should fall back to fallback", async () => {
      await toggles.changeFeatureValue(FEATURE.C, null);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(fallbackValue, rootValue, undefined, undefined);
    });
    test("reset with clearSubScopes root should fall back to fallback", async () => {
      await toggles.changeFeatureValue(FEATURE.C, null, undefined, { clearSubScopes: true });
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(fallbackValue, rootValue, undefined, { clearSubScopes: true });
    });

    test("get in changeHandler should give new value", async () => {
      let newValueCheck;
      const newTenantUserValue = "super";
      handler.mockImplementationOnce(() => {
        newValueCheck = toggles.getFeatureValue(FEATURE.C, { tenant, user });
      });
      await toggles.changeFeatureValue(FEATURE.C, newTenantUserValue, { tenant, user });
      expect(newValueCheck).toBe(newTenantUserValue);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(newTenantUserValue, tenantUserValue, { tenant, user }, undefined);
    });
  });
});
