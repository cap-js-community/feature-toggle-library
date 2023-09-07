"use strict";

const VError = require("verror");
const yaml = require("yaml");
const featureTogglesModule = require("../src/featureToggles");
const { LimitedLazyCache } = require("../src/shared/cache");

const { FEATURE, mockConfig, redisKey, redisChannel } = require("./mockdata");
const { fallbackValuesFromInfos, stateFromInfos } = require("./__common__/fromInfo");

const { FeatureToggles, readConfigFromFile, SCOPE_ROOT_KEY } = featureTogglesModule;
const { CONFIG_KEY, CONFIG_INFO_KEY } = featureTogglesModule._;

const { readFile: readFileSpy } = require("fs");
jest.mock("fs", () => ({ readFile: jest.fn() }));

const envMock = require("../src/env");
jest.mock("../src/env", () => require("./__mocks__/env"));

const redisWrapperMock = require("../src/redisWrapper");
jest.mock("../src/redisWrapper", () => require("./__mocks__/redisWrapper"));

const mockFallbackValues = Object.fromEntries(
  Object.entries(mockConfig).map(([key, { fallbackValue }]) => [key, fallbackValue])
);
const mockActiveKeys = Object.entries(mockConfig)
  .filter(([, value]) => value.active !== false)
  .map(([key]) => key);

let featureToggles = null;
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
    featureToggles = new FeatureToggles({ redisKey, redisChannel });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("enums", () => {
    it("config info consistency", () => {
      const internalKeys = [CONFIG_KEY.VALIDATIONS_SCOPES_MAP, CONFIG_KEY.VALIDATIONS_REG_EXP];
      const configKeysCheck = [].concat(Object.keys(CONFIG_INFO_KEY), internalKeys).sort();
      const configKeys = Object.values(CONFIG_KEY).sort();

      const configKeysMismatch = configKeys.find((value, index) => value !== configKeysCheck[index]);
      expect(configKeysMismatch).toBeUndefined();
      const configKeysCheckMismatch = configKeysCheck.find((value, index) => value !== configKeys[index]);
      expect(configKeysCheckMismatch).toBeUndefined();
    });
  });

  describe("static functions", () => {
    it("_getSuperScopeKeys", () => {
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
      expect(loggerSpy.error.mock.calls[0]).toMatchInlineSnapshot(`
        [
          [FeatureTogglesError: scope exceeds allowed number of keys],
        ]
      `);
      expect(VError.info(loggerSpy.error.mock.calls[0][0])).toMatchInlineSnapshot(`
        {
          "maxKeys": 4,
          "scopeMap": "{"tenantId":"t1","label":"l1","bla":"b1","naa":"n1","xxx":"x1"}",
        }
      `);
    });

    it("getScopeKey", () => {
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

    it("getScopeMap", () => {
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
    it("initializeFeatureToggles", async () => {
      await featureToggles.initializeFeatures({ config: mockConfig });

      expect(featureToggles.__isInitialized).toBe(true);
      expect(featureToggles.__fallbackValues).toStrictEqual(mockFallbackValues);
      expect(featureToggles.__stateScopedValues).toStrictEqual({});
      expect(featureToggles.__config).toMatchSnapshot();
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
      expect(redisWrapperMock.registerMessageHandler).toHaveBeenCalledWith(
        redisChannel,
        featureToggles.__messageHandler
      );
      expect(redisWrapperMock.subscribe).toHaveBeenCalledTimes(1);
      expect(redisWrapperMock.subscribe).toHaveBeenCalledWith(redisChannel);

      expect(loggerSpy.warning).not.toHaveBeenCalled();
      expect(loggerSpy.error).not.toHaveBeenCalled();
    });

    it("_changeRemoteFeatureValues", async () => {
      await featureToggles.initializeFeatures({ config: mockConfig });
      redisWrapperMock.watchedHashGetSetObject.mockClear();

      const beforeValues = stateFromInfos(await featureToggles.getFeaturesInfos());
      await featureToggles._changeRemoteFeatureValue(FEATURE.B, null);
      await featureToggles._changeRemoteFeatureValue(FEATURE.C, "new_a");
      const afterValues = stateFromInfos(await featureToggles.getFeaturesInfos());

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

    it("validateFeatureValue", async () => {
      await featureToggles.initializeFeatures({ config: mockConfig });

      const inputArgsList = [
        [FEATURE.A, true],
        ["nonsense", true],
        [FEATURE.B, {}],
        [FEATURE.B, true],
        [FEATURE.E, 10],
      ];

      let i = 0;
      expect(await featureToggles.validateFeatureValue(...inputArgsList[i++])).toMatchInlineSnapshot(`[]`);
      expect(await featureToggles.validateFeatureValue(...inputArgsList[i++])).toMatchInlineSnapshot(`
        [
          {
            "errorMessage": "feature key is not valid",
            "featureKey": "nonsense",
          },
        ]
      `);
      expect(await featureToggles.validateFeatureValue(...inputArgsList[i++])).toMatchInlineSnapshot(`
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
      expect(await featureToggles.validateFeatureValue(...inputArgsList[i++])).toMatchInlineSnapshot(`
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
      expect(await featureToggles.validateFeatureValue(...inputArgsList[i++])).toMatchInlineSnapshot(`
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

    it("validateFeatureValue with scopes", async () => {
      await featureToggles.initializeFeatures({ config: mockConfig });

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
      expect(await featureToggles.validateFeatureValue(...inputArgsList[i++])).toMatchInlineSnapshot(`
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
      expect(await featureToggles.validateFeatureValue(...inputArgsList[i++])).toMatchInlineSnapshot(`
        [
          {
            "errorMessage": "scopeMap must be undefined or an object",
            "featureKey": "test/feature_a",
          },
        ]
      `);
      expect(await featureToggles.validateFeatureValue(...inputArgsList[i++])).toMatchInlineSnapshot(`[]`);
      expect(await featureToggles.validateFeatureValue(...inputArgsList[i++])).toMatchInlineSnapshot(`[]`);
      expect(await featureToggles.validateFeatureValue(...inputArgsList[i++])).toMatchInlineSnapshot(`[]`);
      expect(await featureToggles.validateFeatureValue(...inputArgsList[i++])).toMatchInlineSnapshot(`[]`);
      expect(await featureToggles.validateFeatureValue(...inputArgsList[i++])).toMatchInlineSnapshot(`
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
      expect(await featureToggles.validateFeatureValue(...inputArgsList[i++])).toMatchInlineSnapshot(`
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

    it("validateFeatureValue should fail if not initialized", async () => {
      expect(await featureToggles.validateFeatureValue(FEATURE.E, 1)).toMatchInlineSnapshot(`
        [
          {
            "errorMessage": "not initialized",
          },
        ]
      `);

      await featureToggles.initializeFeatures({ config: mockConfig });
      expect(await featureToggles.validateFeatureValue(FEATURE.E, 1)).toStrictEqual([]);
    });

    it("isValidFeatureValueType", async () => {
      const invalidTypes = [undefined, () => {}, [], {}];
      const validTypes = [null, 0, "", true];
      expect(invalidTypes.map(FeatureToggles._isValidFeatureValueType)).toStrictEqual(invalidTypes.map(() => false));
      expect(validTypes.map(FeatureToggles._isValidFeatureValueType)).toStrictEqual(validTypes.map(() => true));
    });

    it("isValidFeatureKey", async () => {
      await featureToggles.initializeFeatures({ config: mockConfig });

      const invalidKeys = [undefined, () => {}, [], {}, null, 0, "", true, "nonsense"];
      const validKeys = Object.keys(mockConfig);
      expect(
        invalidKeys.map((key) => FeatureToggles._isValidFeatureKey(featureToggles.__fallbackValues, key))
      ).toStrictEqual(invalidKeys.map(() => false));
      expect(
        validKeys.map((key) => FeatureToggles._isValidFeatureKey(featureToggles.__fallbackValues, key))
      ).toStrictEqual(validKeys.map(() => true));

      expect(loggerSpy.warning).not.toHaveBeenCalled();
      expect(loggerSpy.error).not.toHaveBeenCalled();
    });

    it("getFeatureInfo", async () => {
      await featureToggles.initializeFeatures({ config: mockConfig });
      expect(featureToggles.getFeatureInfo(FEATURE.A)).toMatchInlineSnapshot(`
        {
          "config": {
            "TYPE": "boolean",
          },
          "fallbackValue": false,
        }
      `);
      expect(featureToggles.getFeatureInfo(FEATURE.B)).toMatchInlineSnapshot(`
        {
          "config": {
            "TYPE": "number",
          },
          "fallbackValue": 1,
        }
      `);
      expect(featureToggles.getFeatureInfo(FEATURE.C)).toMatchInlineSnapshot(`
        {
          "config": {
            "TYPE": "string",
          },
          "fallbackValue": "best",
        }
      `);
    });

    it("getFeaturesInfos", async () => {
      await featureToggles.initializeFeatures({ config: mockConfig });
      expect(featureToggles.getFeaturesInfos()).toMatchSnapshot();
    });

    it("getFeatureValue", async () => {
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
      await featureToggles.initializeFeatures({ config: mockConfig });

      expect(mockFeatureValuesEntries.map(([key]) => featureToggles.getFeatureValue(key))).toStrictEqual(
        mockFeatureValuesEntries.map(([, value]) => value[SCOPE_ROOT_KEY])
      );
      expect(otherEntries.map(([key]) => featureToggles.getFeatureValue(key))).toStrictEqual(
        otherEntries.map(() => null)
      );

      expect(loggerSpy.warning).not.toHaveBeenCalled();
      expect(loggerSpy.error).not.toHaveBeenCalled();
    });

    it("getFeatureValue with scoping", async () => {
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
      await featureToggles.initializeFeatures({ config: mockConfig });

      expect(mockFeatureValuesEntries.map(([key]) => featureToggles.getFeatureValue(key))).toStrictEqual(
        mockFeatureValuesEntries.map(([, value]) => value[SCOPE_ROOT_KEY])
      );
      expect(mockFeatureValuesEntries.map(([key]) => featureToggles.getFeatureValue(key, testScopeMap))).toStrictEqual(
        mockFeatureValuesEntries.map(([, value]) => value[testScopeKey])
      );
      expect(otherEntries.map(([key]) => featureToggles.getFeatureValue(key))).toStrictEqual(
        otherEntries.map(() => null)
      );

      expect(loggerSpy.warning).not.toHaveBeenCalled();
      expect(loggerSpy.error).not.toHaveBeenCalled();
    });

    it("changeFeatureValue", async () => {
      await featureToggles.initializeFeatures({ config: mockConfig });
      redisWrapperMock.watchedHashGetSetObject.mockClear();

      expect(await featureToggles.changeFeatureValue(FEATURE.C, "newa")).toBeUndefined();
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

    it("changeFeatureValue failing", async () => {
      await featureToggles.initializeFeatures({ config: mockConfig });
      redisWrapperMock.watchedHashGetSetObject.mockClear();

      const validationErrorsInvalidKey = await featureToggles.changeFeatureValue("invalid", 1);
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

    it("refreshFeatureValues", async () => {
      await featureToggles.initializeFeatures({ config: mockConfig });
      expect(featureToggles.__stateScopedValues).toStrictEqual({});
      const remoteState = { [FEATURE.B]: { [SCOPE_ROOT_KEY]: 42 } };
      redisWrapperMock._setValue(FEATURE.B, { [SCOPE_ROOT_KEY]: 42 });
      redisWrapperMock.watchedHashGetSetObject.mockClear();

      await featureToggles.refreshFeatureValues();
      expect(redisWrapperMock.watchedHashGetSetObject).toHaveBeenCalledTimes(mockActiveKeys.length);
      for (let fieldIndex = 0; fieldIndex < mockActiveKeys.length; fieldIndex++) {
        expect(redisWrapperMock.watchedHashGetSetObject).toHaveBeenNthCalledWith(
          fieldIndex + 1,
          redisKey,
          mockActiveKeys[fieldIndex],
          expect.any(Function)
        );
      }
      expect(featureToggles.__stateScopedValues).toStrictEqual(remoteState);

      expect(loggerSpy.warning).not.toHaveBeenCalled();
      expect(loggerSpy.error).not.toHaveBeenCalled();
    });

    it("refreshFeatureValues with invalid state", async () => {
      await featureToggles.initializeFeatures({ config: mockConfig });
      expect(featureToggles.__stateScopedValues).toStrictEqual({});
      redisWrapperMock.watchedHashGetSetObject.mockClear();

      redisWrapperMock._setValue(FEATURE.B, { [SCOPE_ROOT_KEY]: 42 }); // valid state
      redisWrapperMock._setValue(FEATURE.E, { [SCOPE_ROOT_KEY]: 10 }); // invalid state
      await featureToggles.refreshFeatureValues();

      expect(redisWrapperMock.watchedHashGetSetObject).toHaveBeenCalledTimes(mockActiveKeys.length);
      for (let fieldIndex = 0; fieldIndex < mockActiveKeys.length; fieldIndex++) {
        expect(redisWrapperMock.watchedHashGetSetObject).toHaveBeenNthCalledWith(
          fieldIndex + 1,
          redisKey,
          mockActiveKeys[fieldIndex],
          expect.any(Function)
        );
      }
      expect(featureToggles.__stateScopedValues).toStrictEqual({ [FEATURE.B]: { [SCOPE_ROOT_KEY]: 42 } });

      expect(loggerSpy.warning.mock.calls).toMatchInlineSnapshot(`
        [
          [
            [FeatureTogglesError: removed invalid entries from redis during refresh],
          ],
        ]
      `);
      expect(loggerSpy.error).not.toHaveBeenCalled();
    });

    it("FeatureValueChangeHandler and changeFeatureValue", async () => {
      const newValue = "newValue";
      const newNewValue = "newNewValue";
      await featureToggles.initializeFeatures({ config: mockConfig });
      const oldValue = featureToggles.getFeatureValue(FEATURE.C);
      const handler = jest.fn();
      featureToggles.registerFeatureValueChangeHandler(FEATURE.C, handler);

      // other toggle
      await featureToggles.changeFeatureValue(FEATURE.B, 100);
      expect(handler).not.toHaveBeenCalled();

      // right toggle
      await featureToggles.changeFeatureValue(FEATURE.B, 101);
      await featureToggles.changeFeatureValue(FEATURE.C, newValue);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(newValue, oldValue, undefined, undefined);

      expect(loggerSpy.warning).not.toHaveBeenCalled();
      expect(loggerSpy.error).not.toHaveBeenCalled();

      // right toggle but throwing
      const error = new Error("bad handler");
      handler.mockClear();
      handler.mockRejectedValue(error);
      await featureToggles.changeFeatureValue(FEATURE.B, 102);
      await featureToggles.changeFeatureValue(FEATURE.C, newNewValue);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(newNewValue, newValue, undefined, undefined);
      expect(loggerSpy.error).toHaveBeenCalledTimes(1);
      expect(loggerSpy.error).toHaveBeenCalledWith(
        expect.objectContaining({
          jse_cause: error,
        })
      );
    });

    it("FeatureValueValidation", async () => {
      const newValue = "newValue";
      await featureToggles.initializeFeatures({ config: mockConfig });

      const validator = jest.fn();
      featureToggles.registerFeatureValueValidation(FEATURE.C, validator);

      // other toggle
      expect(await featureToggles.changeFeatureValue(FEATURE.B, 100)).toBeUndefined();
      expect(validator).toHaveBeenCalledTimes(0);
      validator.mockClear();

      // right toggle
      expect(await featureToggles.changeFeatureValue(FEATURE.B, 101)).toBeUndefined();
      expect(await featureToggles.changeFeatureValue(FEATURE.C, newValue)).toBeUndefined();

      // NOTE: we get called twice here once for upstream to redis and once downstream from redis
      expect(validator).toHaveBeenCalledTimes(2);
      expect(validator).toHaveBeenNthCalledWith(1, newValue, undefined, SCOPE_ROOT_KEY);
      expect(validator).toHaveBeenNthCalledWith(2, newValue, undefined, SCOPE_ROOT_KEY);

      // with scopes
      validator.mockClear();
      const testScopeMap = { domain: "value " };
      const testScopeKey = FeatureToggles.getScopeKey(testScopeMap);
      expect(await featureToggles.changeFeatureValue(FEATURE.B, 102, testScopeMap)).toBeUndefined();
      expect(await featureToggles.changeFeatureValue(FEATURE.C, newValue, testScopeMap)).toBeUndefined();

      expect(validator).toHaveBeenCalledTimes(2);
      expect(validator).toHaveBeenNthCalledWith(1, newValue, testScopeMap, testScopeKey);
      expect(validator).toHaveBeenNthCalledWith(2, newValue, testScopeMap, testScopeKey);

      // right toggle but failing
      validator.mockClear();
      const mockErrorMessage = "wrong input";
      validator.mockResolvedValueOnce({ errorMessage: mockErrorMessage });
      expect(await featureToggles.changeFeatureValue(FEATURE.B, 103)).toBeUndefined();
      expect(await featureToggles.changeFeatureValue(FEATURE.C, newValue)).toMatchInlineSnapshot(`
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
      expect(await featureToggles.changeFeatureValue(FEATURE.B, 104)).toBeUndefined();
      expect(await featureToggles.changeFeatureValue(FEATURE.C, newValue)).toMatchInlineSnapshot(`
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
      expect(await featureToggles.changeFeatureValue(FEATURE.B, 105)).toBeUndefined();
      expect(await featureToggles.changeFeatureValue(FEATURE.C, newValue)).toMatchInlineSnapshot(`
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

    it("FeatureValueValidation and inactive", async () => {
      const newValue = "newValue";
      await featureToggles.initializeFeatures({ config: mockConfig });
      const oldValue = featureToggles.getFeatureValue(FEATURE.G);
      const featureConfig = featureToggles.getFeatureInfo(FEATURE.G).config;

      expect(featureConfig.ACTIVE).toBe(false);
      expect(await featureToggles.changeFeatureValue(FEATURE.G, newValue)).toMatchInlineSnapshot(`
        [
          {
            "errorMessage": "feature key is not active",
            "featureKey": "test/feature_g",
          },
        ]
      `);
      expect(featureToggles.getFeatureValue(FEATURE.G)).toBe(oldValue);
    });

    it("FeatureValueValidation and appUrl working", async () => {
      envMock.cfEnv.cfApp = { uris: ["https://it.cfapps.sap.hana.ondemand.com"] };
      const newValue = "newValue";
      await featureToggles.initializeFeatures({ config: mockConfig });
      const featureConfig = featureToggles.getFeatureInfo(FEATURE.H).config;

      expect(featureConfig.APP_URL).toMatchInlineSnapshot(`"\\.cfapps\\.sap\\.hana\\.ondemand\\.com$"`);
      expect(featureConfig.APP_URL_ACTIVE).toBe(true);
      expect(await featureToggles.changeFeatureValue(FEATURE.H, newValue)).toBeUndefined();
      expect(featureToggles.getFeatureValue(FEATURE.H)).toBe(newValue);
    });

    it("FeatureValueValidation and appUrl failing", async () => {
      envMock.cfEnv.cfApp = { uris: ["https://not-it.com"] };
      const newValue = "newValue";
      await featureToggles.initializeFeatures({ config: mockConfig });
      const oldValue = featureToggles.getFeatureValue(FEATURE.H);
      const featureConfig = featureToggles.getFeatureInfo(FEATURE.H).config;

      expect(featureConfig.APP_URL).toMatchInlineSnapshot(`"\\.cfapps\\.sap\\.hana\\.ondemand\\.com$"`);
      expect(featureConfig.APP_URL_ACTIVE).toBe(false);
      expect(await featureToggles.changeFeatureValue(FEATURE.H, newValue)).toMatchInlineSnapshot(`
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
      expect(featureToggles.getFeatureValue(FEATURE.H)).toBe(oldValue);
    });

    it("validateInput throws error", async () => {
      const error = new Error("bad validator");
      const validator = jest.fn().mockRejectedValue(error);

      await featureToggles.initializeFeatures({ config: mockConfig });

      featureToggles.registerFeatureValueValidation(FEATURE.B, validator);

      expect(await featureToggles.changeFeatureValue(FEATURE.B, 100)).toMatchInlineSnapshot(`
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
    it("readConfigFromFile json", async () => {
      const mockFilePath = "inmemory.json";
      const mockConfigData = Buffer.from(JSON.stringify(mockConfig));
      readFileSpy.mockImplementationOnce((filename, callback) => callback(null, mockConfigData));
      const config = await readConfigFromFile(mockFilePath);

      expect(readFileSpy).toHaveBeenCalledTimes(1);
      expect(readFileSpy).toHaveBeenCalledWith(mockFilePath, expect.any(Function));
      expect(config).toStrictEqual(mockConfig);
    });

    it("readConfigFromFile yaml", async () => {
      const mockFilePath = "in_memory.yml";
      const mockConfigData = Buffer.from(yaml.stringify(mockConfig));
      readFileSpy.mockImplementationOnce((filename, callback) => callback(null, mockConfigData));
      const config = await readConfigFromFile(mockFilePath);

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
      await featureToggles.initializeFeatures({
        config,
      });
      loggerSpy.warning.mockClear();
    });

    it("setup sanity", async () => {
      const oldValueA = featureToggles.getFeatureValue(FEATURE.A);
      const oldValueB = featureToggles.getFeatureValue(FEATURE.B);
      expect(oldValueA).toBe(fallbackValue);
      expect(oldValueB).toBe(fallbackValue);
      expect(fallbackValuesFromInfos(featureToggles.getFeaturesInfos())).toStrictEqual(fallbackValues);
    });

    it("refreshFeatureValues and central state is invalid", async () => {
      const remoteStateA = { [FEATURE.A]: { [SCOPE_ROOT_KEY]: "central" } };
      redisWrapperMock._setValues(remoteStateA);
      await featureToggles.refreshFeatureValues();

      expect(featureToggles.__stateScopedValues).toStrictEqual({});
      const afterRemoteInvalidValueA = featureToggles.getFeatureValue(FEATURE.A);
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

    it("refreshFeatureValues and central state is invalid and fallback value is invalid", async () => {
      const remoteStateB = { [FEATURE.B]: { [SCOPE_ROOT_KEY]: "central" } };
      redisWrapperMock._setValues(remoteStateB);
      await featureToggles.refreshFeatureValues();

      expect(featureToggles.__stateScopedValues).toStrictEqual({});
      const afterRemoteInvalidValueB = featureToggles.getFeatureValue(FEATURE.B);
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

    it("changeFeatureValues and valid state and valid fallback with delete", async () => {
      expect(await featureToggles.changeFeatureValue(FEATURE.A, "fallout")).toBeUndefined();
      expect(featureToggles.__stateScopedValues).toMatchInlineSnapshot(`
        {
          "test/feature_a": {
            "//": "fallout",
          },
        }
      `);

      expect(await featureToggles.changeFeatureValue(FEATURE.A, null)).toBeUndefined();

      // NOTE: deleting will keep the fallback value as state since they are valid
      expect(featureToggles.__stateScopedValues).toStrictEqual({});
      const afterA = featureToggles.getFeatureValue(FEATURE.A);
      expect(afterA).toBe(fallbackValue);

      expect(loggerSpy.warning).not.toHaveBeenCalled();
      expect(loggerSpy.error).not.toHaveBeenCalled();
    });

    it("changeFeatureValues and invalid state and invalid fallback with delete", async () => {
      expect(await featureToggles.changeFeatureValue(FEATURE.B, "fallout")).toMatchInlineSnapshot(`
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
      expect(featureToggles.__stateScopedValues).toStrictEqual({});

      expect(await featureToggles.changeFeatureValue(FEATURE.B, null)).toBeUndefined();

      // NOTE: we still get the validFallbackValues of the test setup
      expect(featureToggles.__stateScopedValues).toStrictEqual({});
      const afterB = featureToggles.getFeatureValue(FEATURE.B);
      expect(afterB).toBe(fallbackValue);

      expect(loggerSpy.warning).not.toHaveBeenCalled();
      expect(loggerSpy.error).not.toHaveBeenCalled();
    });
  });

  describe("active to inactive to active again", () => {
    it("setting a toggle inactive does not change it in redis on init or refresh", async () => {
      await featureToggles.initializeFeatures({
        config: {
          [FEATURE.B]: {
            fallbackValue: 1,
            type: "number",
          },
        },
      });
      expect(redisWrapperMock.watchedHashGetSetObject.mock.calls.filter(([, key]) => key === FEATURE.B).length).toBe(1);
      expect(featureToggles.getFeatureValue(FEATURE.B)).toBe(1);

      // change is propagated to mock redis
      expect(await featureToggles.changeFeatureValue(FEATURE.B, 10)).toBeUndefined();
      expect(featureToggles.getFeatureValue(FEATURE.B)).toBe(10);
      expect(redisWrapperMock.watchedHashGetSetObject.mock.calls.filter(([, key]) => key === FEATURE.B).length).toBe(2);

      // !! first reset
      redisWrapperMock.watchedHashGetSetObject.mockClear();
      featureToggles._reset({ redisKey, redisChannel });
      await featureToggles.initializeFeatures({
        config: {
          [FEATURE.B]: {
            active: false,
            fallbackValue: 2,
            type: "number",
          },
        },
      });
      // remote value is ignored because key is inactive
      expect(featureToggles.getFeatureValue(FEATURE.B)).toBe(2);
      // change is blocked because key is inactive
      expect(await featureToggles.changeFeatureValue(FEATURE.B, 20)).toMatchInlineSnapshot(`
        [
          {
            "errorMessage": "feature key is not active",
            "featureKey": "test/feature_b",
          },
        ]
      `);
      expect(featureToggles.getFeatureValue(FEATURE.B)).toBe(2);

      // remote value is also ignored during refresh because key is inactive
      await featureToggles.refreshFeatureValues();
      expect(featureToggles.getFeatureValue(FEATURE.B)).toBe(2);
      expect(redisWrapperMock.watchedHashGetSetObject.mock.calls.filter(([, key]) => key === FEATURE.B).length).toBe(0);

      // !! second reset
      redisWrapperMock.watchedHashGetSetObject.mockClear();
      featureToggles._reset({ redisKey, redisChannel });
      await featureToggles.initializeFeatures({
        config: {
          [FEATURE.B]: {
            fallbackValue: 3,
            type: "number",
          },
        },
      });
      expect(redisWrapperMock.watchedHashGetSetObject.mock.calls.filter(([, key]) => key === FEATURE.B).length).toBe(1);
      // after re-activation we get the remote state
      expect(featureToggles.getFeatureValue(FEATURE.B)).toBe(10);
      // after re-activation we can change again
      expect(await featureToggles.changeFeatureValue(FEATURE.B, 30)).toBeUndefined();
      expect(featureToggles.getFeatureValue(FEATURE.B)).toBe(30);
      expect(redisWrapperMock.watchedHashGetSetObject.mock.calls.filter(([, key]) => key === FEATURE.B).length).toBe(2);

      expect(loggerSpy.warning).not.toHaveBeenCalled();
      expect(loggerSpy.error).not.toHaveBeenCalled();
    });
  });
});
