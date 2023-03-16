"use strict";

const yaml = require("yaml");
const featureTogglesModule = require("../src/featureToggles");
const { FeatureToggles, readConfigFromFile } = featureTogglesModule;

const { FEATURE, mockConfig, featuresKey, featuresChannel, refreshMessage } = require("./mockdata");

const { readFile: readFileSpy } = require("fs");
jest.mock("fs", () => ({
  readFile: jest.fn(),
}));

const redisWrapperMock = require("../src/redisWrapper");
jest.mock("../src/redisWrapper", () => require("./__mocks__/redisWrapper"));

const mockFeatureValues = Object.fromEntries(
  Object.entries(mockConfig).map(([key, { fallbackValue }]) => [key, fallbackValue])
);
const mockActiveFeatureValues = Object.fromEntries(
  Object.entries(mockConfig)
    .filter(([, { active }]) => active !== false)
    .map(([key, { fallbackValue }]) => [key, fallbackValue])
);

let featureToggles = null;
const loggerSpy = {
  info: jest.spyOn(featureTogglesModule._._getLogger(), "info"),
  warning: jest.spyOn(featureTogglesModule._._getLogger(), "warning"),
  error: jest.spyOn(featureTogglesModule._._getLogger(), "error"),
};

describe("feature toggles test", () => {
  beforeEach(async () => {
    redisWrapperMock._reset();
    featureToggles = new FeatureToggles({ featuresKey, featuresChannel, refreshMessage });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("basic apis", () => {
    it("initializeFeatureToggles", async () => {
      await featureToggles.initializeFeatureValues({ config: mockConfig });

      expect(featureToggles.__isInitialized).toBe(true);
      expect(featureToggles.__fallbackValues).toStrictEqual(mockFeatureValues);
      expect(featureToggles.__stateValues).toStrictEqual({});
      expect(featureToggles.__config).toMatchSnapshot();
      expect(redisWrapperMock.watchedGetSetObject).toHaveBeenCalledTimes(1);
      expect(redisWrapperMock.watchedGetSetObject).toHaveBeenCalledWith(featuresKey, expect.any(Function));
      expect(redisWrapperMock.registerMessageHandler).toHaveBeenCalledTimes(1);
      expect(redisWrapperMock.registerMessageHandler).toHaveBeenCalledWith(
        featuresChannel,
        featureToggles.__messageHandler
      );
      expect(redisWrapperMock.subscribe).toHaveBeenCalledTimes(1);
      expect(redisWrapperMock.subscribe).toHaveBeenCalledWith(featuresChannel);

      expect(loggerSpy.warning).not.toHaveBeenCalled();
      expect(loggerSpy.error).not.toHaveBeenCalled();
    });

    it("_changeRemoteFeatureValues", async () => {
      await featureToggles.initializeFeatureValues({ config: mockConfig });
      redisWrapperMock.watchedGetSetObject.mockClear();

      const beforeValues = await featureToggles.getFeatureValues();
      const changeObject = { [FEATURE.B]: null, [FEATURE.C]: "new_a" };
      await featureToggles._changeRemoteFeatureValues(changeObject);
      const afterValues = await featureToggles.getFeatureValues();

      expect(redisWrapperMock.watchedGetSetObject).toHaveBeenCalledTimes(1);
      expect(redisWrapperMock.watchedGetSetObject).toHaveBeenCalledWith(featuresKey, expect.any(Function));
      expect(redisWrapperMock.publishMessage).toHaveBeenCalledTimes(1);
      expect(redisWrapperMock.publishMessage).toHaveBeenCalledWith(featuresChannel, refreshMessage);

      expect(beforeValues).toMatchSnapshot();
      expect(afterValues).toMatchSnapshot();

      expect(loggerSpy.warning).not.toHaveBeenCalled();
      expect(loggerSpy.error).not.toHaveBeenCalled();
    });

    it("_changeRemoteFeatureValuesCallbackFromInput", async () => {
      await featureToggles.initializeFeatureValues({ config: mockConfig });

      const oldFeatureValues = {
        [FEATURE.A]: "a",
        [FEATURE.B]: "b",
        [FEATURE.C]: "c",
      };
      const changeObject = { [FEATURE.A]: "new_a", [FEATURE.B]: null };
      const result = featureToggles._changeRemoteFeatureValuesCallbackFromInput(changeObject)(oldFeatureValues);
      expect(result).toStrictEqual({
        [FEATURE.A]: "new_a",
        [FEATURE.C]: "c",
      });

      expect(loggerSpy.warning).not.toHaveBeenCalled();
      expect(loggerSpy.error).not.toHaveBeenCalled();
    });

    it("validateInput", async () => {
      await featureToggles.initializeFeatureValues({ config: mockConfig });

      const inputOutputPairs = [
        [undefined, null],
        [null, null],
        [1, null],
        [() => {}, null],
        [[], null],
        [{}, null],
        [mockActiveFeatureValues, mockActiveFeatureValues],
      ];
      const inputOutputValidationTuples = [
        [
          { [FEATURE.A]: true, nonsense: true },
          { [FEATURE.A]: true },
          [
            {
              key: "nonsense",
              errorMessage: 'key "{0}" is not valid',
              errorMessageValues: ["nonsense"],
            },
          ],
        ],
        [
          { [FEATURE.A]: true, [FEATURE.B]: {} },
          { [FEATURE.A]: true },
          [
            {
              key: "test/feature_b",
              errorMessage: 'value "{0}" has invalid type {1}, must be in {2}',
              errorMessageValues: [{}, "object", ["string", "number", "boolean"]],
            },
          ],
        ],
        [
          { [FEATURE.A]: true, [FEATURE.B]: true },
          { [FEATURE.A]: true },
          [
            {
              key: "test/feature_b",
              errorMessage: 'value "{0}" has invalid type {1}, must be {2}',
              errorMessageValues: [true, "boolean", "number"],
            },
          ],
        ],
        [
          { [FEATURE.A]: true, [FEATURE.E]: 10 },
          { [FEATURE.A]: true },
          [
            {
              key: "test/feature_e",
              errorMessage: 'value "{0}" does not match validation regular expression {1}',
              errorMessageValues: [10, "^\\d{1}$"],
            },
          ],
        ],
      ];
      for (const [input, output] of inputOutputPairs) {
        const [result, validationErrors] = await featureToggles.validateInput(input);
        expect(result).toStrictEqual(output);
        expect(validationErrors).toStrictEqual([]);
      }
      for (const [input, output, expectedValidationErrors] of inputOutputValidationTuples) {
        const [result, validationErrors] = await featureToggles.validateInput(input);
        expect(result).toStrictEqual(output);
        expect(validationErrors).toStrictEqual(expectedValidationErrors);
      }

      expect(loggerSpy.warning).not.toHaveBeenCalled();
      expect(loggerSpy.error).not.toHaveBeenCalled();
    });

    it("validateInput should fail if not initialized", async () => {
      const input = { [FEATURE.E]: 1 };
      const [failResult, failValidationErrors] = await featureToggles.validateInput(input);
      expect(failResult).toStrictEqual(null);
      expect(failValidationErrors).toMatchInlineSnapshot(`
        [
          {
            "errorMessage": "not initialized",
            "key": "test/feature_e",
          },
        ]
      `);

      await featureToggles.initializeFeatureValues({ config: mockConfig });
      const [successResult, successValidationErrors] = await featureToggles.validateInput(input);
      expect(successResult).toStrictEqual(input);
      expect(successValidationErrors).toStrictEqual([]);
    });

    it("isValidFeatureValueType", async () => {
      const invalidTypes = [undefined, () => {}, [], {}];
      const validTypes = [null, 0, "", true];
      expect(invalidTypes.map(FeatureToggles._isValidFeatureValueType)).toStrictEqual(invalidTypes.map(() => false));
      expect(validTypes.map(FeatureToggles._isValidFeatureValueType)).toStrictEqual(validTypes.map(() => true));
    });

    it("isValidFeatureKey", async () => {
      await featureToggles.initializeFeatureValues({ config: mockConfig });

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

    it("getFeatureState", async () => {
      await featureToggles.initializeFeatureValues({ config: mockConfig });
      expect(featureToggles.getFeatureState(FEATURE.A)).toMatchInlineSnapshot(`
        {
          "config": {
            "TYPE": "boolean",
          },
          "fallbackValue": false,
          "stateValue": undefined,
        }
      `);
      expect(featureToggles.getFeatureState(FEATURE.B)).toMatchInlineSnapshot(`
        {
          "config": {
            "TYPE": "number",
          },
          "fallbackValue": 1,
          "stateValue": undefined,
        }
      `);
      expect(featureToggles.getFeatureState(FEATURE.C)).toMatchInlineSnapshot(`
        {
          "config": {
            "TYPE": "string",
          },
          "fallbackValue": "best",
          "stateValue": undefined,
        }
      `);
    });

    it("getFeatureStates", async () => {
      await featureToggles.initializeFeatureValues({ config: mockConfig });
      expect(featureToggles.getFeatureStates()).toMatchSnapshot();
    });

    it("getFeatureValue", async () => {
      const mockFeatureValuesEntries = [
        [[FEATURE.A], true],
        [[FEATURE.B], 0],
        [[FEATURE.C], "cvalue"],
      ];
      const otherEntries = [
        ["d", "avalue"],
        ["e", "bvalue"],
        ["f", "cvalue"],
      ];
      redisWrapperMock.watchedGetSetObject.mockImplementationOnce(() => Object.fromEntries(mockFeatureValuesEntries));
      await featureToggles.initializeFeatureValues({ config: mockConfig });

      expect(mockFeatureValuesEntries.map(([key]) => featureToggles.getFeatureValue(key))).toStrictEqual(
        mockFeatureValuesEntries.map(([, value]) => value)
      );
      expect(otherEntries.map(([key]) => featureToggles.getFeatureValue(key))).toStrictEqual(
        otherEntries.map(() => null)
      );

      expect(loggerSpy.warning).not.toHaveBeenCalled();
      expect(loggerSpy.error).not.toHaveBeenCalled();
    });

    it("getFeatureValues", async () => {
      const featureValuesEntries = [
        [[FEATURE.A], true],
        [[FEATURE.B], 0],
        [[FEATURE.C], "cvalue"],
      ];
      const featureValues = Object.fromEntries(featureValuesEntries);
      redisWrapperMock.watchedGetSetObject.mockImplementationOnce(() => featureValues);
      await featureToggles.initializeFeatureValues({ config: mockConfig });

      const result = featureToggles.getFeatureValues();
      expect(result).not.toBe(featureValues);
      expect(result).toStrictEqual({ ...mockFeatureValues, ...featureValues });

      expect(loggerSpy.warning).not.toHaveBeenCalled();
      expect(loggerSpy.error).not.toHaveBeenCalled();
    });

    it("changeFeatureValue", async () => {
      redisWrapperMock.watchedGetSetObject.mockReturnValueOnce(mockActiveFeatureValues);
      await featureToggles.initializeFeatureValues({ config: mockConfig });
      redisWrapperMock.watchedGetSetObject.mockClear();
      redisWrapperMock.getObject.mockReturnValueOnce(mockActiveFeatureValues);

      const validationErrors = await featureToggles.changeFeatureValue(FEATURE.C, "newa");
      expect(validationErrors).toBeUndefined();
      expect(redisWrapperMock.watchedGetSetObject).toHaveBeenCalledTimes(1);
      expect(redisWrapperMock.watchedGetSetObject).toHaveBeenCalledWith(featuresKey, expect.any(Function));
      expect(redisWrapperMock.publishMessage).toHaveBeenCalledTimes(1);
      expect(redisWrapperMock.publishMessage).toHaveBeenCalledWith(featuresChannel, refreshMessage);
      expect(redisWrapperMock.getObject).toHaveBeenCalledTimes(1);
      expect(redisWrapperMock.getObject).toHaveBeenCalledWith(featuresKey);

      expect(loggerSpy.warning).not.toHaveBeenCalled();
      expect(loggerSpy.error).not.toHaveBeenCalled();
    });

    it("changeFeatureValues", async () => {
      redisWrapperMock.watchedGetSetObject.mockReturnValueOnce(mockActiveFeatureValues);
      await featureToggles.initializeFeatureValues({ config: mockConfig });
      redisWrapperMock.watchedGetSetObject.mockClear();
      redisWrapperMock.getObject.mockReturnValueOnce(mockActiveFeatureValues);

      const input = { [FEATURE.A]: null, [FEATURE.C]: "b" };
      const validationErrors = await featureToggles.changeFeatureValues(input);
      expect(validationErrors).toBeUndefined();
      expect(redisWrapperMock.watchedGetSetObject).toHaveBeenCalledTimes(1);
      expect(redisWrapperMock.watchedGetSetObject).toHaveBeenCalledWith(featuresKey, expect.any(Function));
      expect(redisWrapperMock.publishMessage).toHaveBeenCalledTimes(1);
      expect(redisWrapperMock.publishMessage).toHaveBeenCalledWith(featuresChannel, refreshMessage);
      expect(redisWrapperMock.getObject).toHaveBeenCalledTimes(1);
      expect(redisWrapperMock.getObject).toHaveBeenCalledWith(featuresKey);

      expect(loggerSpy.warning).not.toHaveBeenCalled();
      expect(loggerSpy.error).not.toHaveBeenCalled();
    });

    it("changeFeatureValues failing", async () => {
      await featureToggles.initializeFeatureValues({ config: mockConfig });
      redisWrapperMock.watchedGetSetObject.mockClear();

      const validInput = { [FEATURE.A]: null, [FEATURE.B]: 1 };
      const validationErrorsInvalidKey = await featureToggles.changeFeatureValues({ ...validInput, invalid: 1 });
      expect(validationErrorsInvalidKey).toMatchInlineSnapshot(`
              [
                {
                  "errorMessage": "key "{0}" is not valid",
                  "errorMessageValues": [
                    "invalid",
                  ],
                  "key": "invalid",
                },
              ]
          `);
      expect(redisWrapperMock.watchedGetSetObject).not.toHaveBeenCalled();
      expect(redisWrapperMock.publishMessage).not.toHaveBeenCalled();
      expect(redisWrapperMock.getObject).not.toHaveBeenCalled();

      expect(loggerSpy.warning).not.toHaveBeenCalled();
      expect(loggerSpy.error).not.toHaveBeenCalled();
    });

    it("refreshFeatureValues", async () => {
      await featureToggles.initializeFeatureValues({ config: mockConfig });
      expect(featureToggles.__stateValues).toStrictEqual({});
      const remoteState = { [FEATURE.B]: 42 };
      redisWrapperMock._setValue(FEATURE.B, 42);

      await featureToggles.refreshFeatureValues();
      expect(redisWrapperMock.getObject).toHaveBeenCalledTimes(1);
      expect(redisWrapperMock.getObject).toHaveBeenCalledWith(featuresKey);
      expect(featureToggles.__stateValues).toStrictEqual(remoteState);

      expect(loggerSpy.warning).not.toHaveBeenCalled();
      expect(loggerSpy.error).not.toHaveBeenCalled();
    });

    it("FeatureValueChangeHandler and refreshFeatureValues", async () => {
      const newValue = "newValue";
      const newNewValue = "newNewValue";
      redisWrapperMock.watchedGetSetObject.mockReturnValueOnce(mockFeatureValues);
      await featureToggles.initializeFeatureValues({ config: mockConfig });
      const oldValue = featureToggles.getFeatureValue(FEATURE.C);
      const handler = jest.fn();
      featureToggles.registerFeatureValueChangeHandler(FEATURE.C, handler);

      // other toggle
      redisWrapperMock.getObject.mockReturnValueOnce({ ...mockActiveFeatureValues, [FEATURE.B]: 100 });
      await featureToggles.refreshFeatureValues();
      expect(handler).not.toHaveBeenCalled();

      // right toggle
      redisWrapperMock.getObject.mockReturnValueOnce({
        ...mockActiveFeatureValues,
        [FEATURE.B]: 101,
        [FEATURE.C]: newValue,
      });
      await featureToggles.refreshFeatureValues();
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(newValue, oldValue);

      expect(loggerSpy.warning).not.toHaveBeenCalled();
      expect(loggerSpy.error).not.toHaveBeenCalled();

      // right toggle but throwing
      const error = new Error("bad handler");
      handler.mockClear();
      handler.mockRejectedValue(error);
      redisWrapperMock.getObject.mockReturnValueOnce({
        ...mockFeatureValues,
        [FEATURE.B]: 102,
        [FEATURE.C]: newNewValue,
      });
      await featureToggles.refreshFeatureValues();
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(newNewValue, newValue);
      expect(loggerSpy.error).toHaveBeenCalledTimes(1);
      expect(loggerSpy.error).toHaveBeenCalledWith(
        expect.objectContaining({
          jse_cause: error,
        })
      );
    });

    it("FeatureValueValidation", async () => {
      let validationErrors;
      const newValue = "newValue";
      await featureToggles.initializeFeatureValues({ config: mockConfig });

      const validator = jest.fn();
      featureToggles.registerFeatureValueValidation(FEATURE.C, validator);

      // other toggle
      validationErrors = await featureToggles.changeFeatureValues({ [FEATURE.B]: 100 });
      expect(validationErrors).toMatchInlineSnapshot(`undefined`);
      expect(validator).toHaveBeenCalledTimes(0);
      validator.mockClear();

      // right toggle
      validationErrors = await featureToggles.changeFeatureValues({ [FEATURE.B]: 101, [FEATURE.C]: newValue });
      expect(validationErrors).toMatchInlineSnapshot(`undefined`);
      // NOTE: we get called twice here once for upstream to redis and once downstream from redis
      expect(validator).toHaveBeenCalledTimes(2);
      expect(validator).toHaveBeenNthCalledWith(1, newValue);
      expect(validator).toHaveBeenNthCalledWith(2, newValue);

      // right toggle but failing
      validator.mockClear();
      const mockErrorMessage = "wrong input";
      validator.mockResolvedValueOnce({ errorMessage: mockErrorMessage });
      validationErrors = await featureToggles.changeFeatureValues({ [FEATURE.B]: 102, [FEATURE.C]: newValue });
      expect(validationErrors).toMatchInlineSnapshot(`
              [
                {
                  "errorMessage": "wrong input",
                  "key": "test/feature_c",
                },
              ]
          `);
      expect(validator).toHaveBeenCalledTimes(1);
      expect(validator).toHaveBeenCalledWith(newValue);

      // right toggle but failing with messageValues
      validator.mockClear();
      const mockErrorMessageWithValues = "wrong input {0} {1}";
      const mockErrorMessageValues = ["value1", 2];
      validator.mockResolvedValueOnce({
        errorMessage: mockErrorMessageWithValues,
        errorMessageValues: mockErrorMessageValues,
      });
      validationErrors = await featureToggles.changeFeatureValues({ [FEATURE.B]: 102, [FEATURE.C]: newValue });
      expect(validationErrors).toMatchInlineSnapshot(`
              [
                {
                  "errorMessage": "wrong input {0} {1}",
                  "errorMessageValues": [
                    "value1",
                    2,
                  ],
                  "key": "test/feature_c",
                },
              ]
          `);
      expect(validator).toHaveBeenCalledTimes(1);
      expect(validator).toHaveBeenCalledWith(newValue);

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
      validationErrors = await featureToggles.changeFeatureValues({ [FEATURE.B]: 102, [FEATURE.C]: newValue });
      expect(validationErrors).toMatchInlineSnapshot(`
              [
                {
                  "errorMessage": "wrong input",
                  "key": "test/feature_c",
                },
                {
                  "errorMessage": "wrong input {0} {1}",
                  "errorMessageValues": [
                    "value1",
                    2,
                  ],
                  "key": "test/feature_c",
                },
              ]
          `);
      expect(validator).toHaveBeenCalledTimes(1);
      expect(validator).toHaveBeenCalledWith(newValue);

      expect(loggerSpy.warning).not.toHaveBeenCalled();
      expect(loggerSpy.error).not.toHaveBeenCalled();
    });

    it("FeatureValueValidation and inactive", async () => {
      const newValue = "newValue";
      redisWrapperMock.watchedGetSetObject.mockReturnValueOnce(mockFeatureValues);
      await featureToggles.initializeFeatureValues({ config: mockConfig });
      const oldValue = featureToggles.getFeatureValue(FEATURE.G);
      const featureConfig = featureToggles.getFeatureState(FEATURE.G).config;

      const validationErrors = await featureToggles.changeFeatureValues({ [FEATURE.G]: newValue });
      const afterChangeValue = featureToggles.getFeatureValue(FEATURE.G);
      expect(featureConfig.ACTIVE).toBe(false);
      expect(validationErrors).toMatchInlineSnapshot(`
              [
                {
                  "errorMessage": "key "{0}" is not active",
                  "errorMessageValues": [
                    "test/feature_g",
                  ],
                  "key": "test/feature_g",
                },
              ]
          `);
      expect(afterChangeValue).toBe(oldValue);
    });

    it("validateInput throws error", async () => {
      const error = new Error("bad validator");
      const validator = jest.fn().mockRejectedValue(error);

      await featureToggles.initializeFeatureValues({ config: mockConfig });

      featureToggles.registerFeatureValueValidation(FEATURE.B, validator);

      const validationErrors = await featureToggles.changeFeatureValues({ [FEATURE.B]: 100 });
      expect(validationErrors).toMatchInlineSnapshot(`
              [
                {
                  "errorMessage": "registered validator "{0}" failed for value "{1}" with error {2}",
                  "errorMessageValues": [
                    "mockConstructor",
                    100,
                    "bad validator",
                  ],
                  "key": "test/feature_b",
                },
              ]
          `);

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
      [FEATURE.A]: { fallbackValue, type: "string", validation: "^fall" },
      [FEATURE.B]: { fallbackValue, type: "string", validation: "^xxx" },
    };

    beforeEach(async () => {
      await featureToggles.initializeFeatureValues({
        config,
      });
      loggerSpy.warning.mockClear();
    });

    it("setup sanity", async () => {
      const oldValueA = featureToggles.getFeatureValue(FEATURE.A);
      const oldValueB = featureToggles.getFeatureValue(FEATURE.B);
      expect(oldValueA).toBe(fallbackValue);
      expect(oldValueB).toBe(fallbackValue);
      expect(featureToggles.getFeatureValues()).toStrictEqual(fallbackValues);
    });

    it("refreshFeatureValues and central state is invalid", async () => {
      const remoteStateA = { [FEATURE.A]: "central" };
      redisWrapperMock._setValues(remoteStateA);
      await featureToggles.refreshFeatureValues();

      expect(featureToggles.__stateValues).toStrictEqual({});
      const afterRemoteInvalidValueA = featureToggles.getFeatureValue(FEATURE.A);
      expect(afterRemoteInvalidValueA).toBe(fallbackValue);

      expect(loggerSpy.warning.mock.calls).toMatchInlineSnapshot(`
        [
          [
            [FeatureTogglesError: received and removed invalid values from redis],
          ],
        ]
      `);
      expect(loggerSpy.error).not.toHaveBeenCalled();
    });

    it("refreshFeatureValues and central state is invalid and fallback value is invalid", async () => {
      const remoteStateB = { [FEATURE.B]: "central" };
      redisWrapperMock._setValues(remoteStateB);
      await featureToggles.refreshFeatureValues();

      expect(featureToggles.__stateValues).toStrictEqual({});
      const afterRemoteInvalidValueB = featureToggles.getFeatureValue(FEATURE.B);
      expect(afterRemoteInvalidValueB).toBe(fallbackValue);

      expect(loggerSpy.warning.mock.calls).toMatchInlineSnapshot(`
        [
          [
            [FeatureTogglesError: received and removed invalid values from redis],
          ],
        ]
      `);
      expect(loggerSpy.error).not.toHaveBeenCalled();
    });

    it("changeFeatureValues and valid state and valid fallback with delete", async () => {
      const inputA1 = { [FEATURE.A]: "fallout" };
      const validationErrorsA1 = await featureToggles.changeFeatureValues(inputA1);
      expect(validationErrorsA1).toBeUndefined();
      expect(featureToggles.__stateValues).toStrictEqual(inputA1);

      const inputA2 = { [FEATURE.A]: null };
      const validationErrorsA2 = await featureToggles.changeFeatureValues(inputA2);
      expect(validationErrorsA2).toBeUndefined();

      // NOTE: deleting will keep the fallback value as state since they are valid
      expect(featureToggles.__stateValues).toStrictEqual({});
      const afterA = featureToggles.getFeatureValue(FEATURE.A);
      expect(afterA).toBe(fallbackValue);

      expect(loggerSpy.warning).not.toHaveBeenCalled();
      expect(loggerSpy.error).not.toHaveBeenCalled();
    });

    it("changeFeatureValues and invalid state and invalid fallback with delete", async () => {
      const inputB1 = { [FEATURE.B]: "fallout" };
      const validationErrorsB1 = await featureToggles.changeFeatureValues(inputB1);
      expect(validationErrorsB1).toMatchInlineSnapshot(`
        [
          {
            "errorMessage": "value "{0}" does not match validation regular expression {1}",
            "errorMessageValues": [
              "fallout",
              "^xxx",
            ],
            "key": "test/feature_b",
          },
        ]
      `);
      expect(featureToggles.__stateValues).toStrictEqual({});

      const inputB2 = { [FEATURE.B]: null };
      const validationErrorsB2 = await featureToggles.changeFeatureValues(inputB2);
      expect(validationErrorsB2).toBeUndefined();

      // NOTE: we still get the validFallbackValues of the test setup
      expect(featureToggles.__stateValues).toStrictEqual({});
      const afterB = featureToggles.getFeatureValue(FEATURE.B);
      expect(afterB).toBe(fallbackValue);

      expect(loggerSpy.warning).not.toHaveBeenCalled();
      expect(loggerSpy.error).not.toHaveBeenCalled();
    });
  });
});
