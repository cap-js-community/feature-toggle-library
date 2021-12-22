"use strict";

const yaml = require("yaml");
const featureTogglesModule = require("../src/featureToggles");
const { FeatureToggles, readConfigFromFile } = featureTogglesModule;

const { readFile: readFileSpy } = require("fs");
jest.mock("fs", () => ({
  readFile: jest.fn(),
}));

const redisWrapper = require("../src/redisWrapper");
jest.mock("../src/redisWrapper", () => ({
  registerMessageHandler: jest.fn(),
  publishMessage: jest.fn(),
  getObject: jest.fn(),
  watchedGetSetObject: jest.fn(),
}));

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
const mockFeatureValues = Object.fromEntries(
  Object.entries(mockConfig).map(([key, { fallbackValue }]) => [key, fallbackValue])
);
const mockActiveFeatureValues = Object.fromEntries(
  Object.entries(mockConfig)
    .filter(([, { active }]) => active !== false)
    .map(([key, { fallbackValue }]) => [key, fallbackValue])
);

let featureToggles = null;
let loggerSpy = {
  info: jest.spyOn(featureTogglesModule._._getLogger(), "info"),
  error: jest.spyOn(featureTogglesModule._._getLogger(), "error"),
};

const featuresKey = "feature-key";
const featuresChannel = "feature-channel";
const refreshMessage = "refresh-message";

describe("feature toggles test", () => {
  beforeEach(() => {
    featureToggles = new FeatureToggles({ featuresKey, featuresChannel, refreshMessage });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("initializeFeatureToggles", async () => {
    redisWrapper.watchedGetSetObject.mockImplementationOnce(() => "watchedGetSetObjectResult");
    await featureToggles.initializeFeatureValues({ config: mockConfig });

    expect(featureToggles.__isInitialized).toBe(true);
    expect(featureToggles.__featureValues).toBe("watchedGetSetObjectResult");
    expect(featureToggles.__config).toMatchSnapshot();
    expect(redisWrapper.watchedGetSetObject).toBeCalledTimes(1);
    expect(redisWrapper.watchedGetSetObject).toBeCalledWith(featuresKey, expect.any(Function));
    expect(redisWrapper.registerMessageHandler).toBeCalledTimes(1);
    expect(redisWrapper.registerMessageHandler).toBeCalledWith(featuresChannel, featureToggles.__messageHandler);
    expect(loggerSpy.error).toHaveBeenCalledTimes(0);
  });

  it("_changeRemoteFeatureValues", async () => {
    const changeObject = { [FEATURE.B]: null, [FEATURE.C]: "new_a" };
    redisWrapper.watchedGetSetObject.mockImplementationOnce(() => "watchedGetSetObjectResult");
    await featureToggles.initializeFeatureValues({ config: mockConfig });
    redisWrapper.watchedGetSetObject.mockClear();

    await featureToggles._changeRemoteFeatureValues(changeObject);

    expect(redisWrapper.watchedGetSetObject).toBeCalledTimes(1);
    expect(redisWrapper.watchedGetSetObject).toBeCalledWith(featuresKey, expect.any(Function));
    expect(redisWrapper.publishMessage).toBeCalledTimes(1);
    expect(redisWrapper.publishMessage).toBeCalledWith(featuresChannel, refreshMessage);
    expect(loggerSpy.error).toHaveBeenCalledTimes(0);
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
      [FEATURE.B]: 1,
      [FEATURE.C]: "c",
    });
    expect(loggerSpy.error).toHaveBeenCalledTimes(0);
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
    expect(loggerSpy.error).toHaveBeenCalledTimes(0);
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
    const validKeys = Object.keys(featureToggles.__config);
    expect(invalidKeys.map((key) => FeatureToggles._isValidFeatureKey(validKeys, key))).toStrictEqual(
      invalidKeys.map(() => false)
    );
    expect(validKeys.map((key) => FeatureToggles._isValidFeatureKey(validKeys, key))).toStrictEqual(
      validKeys.map(() => true)
    );
    expect(loggerSpy.error).toHaveBeenCalledTimes(0);
  });

  it("getFeatureConfig", async () => {
    await featureToggles.initializeFeatureValues({ config: mockConfig });
    expect(featureToggles.getFeatureConfig(FEATURE.A)).toMatchInlineSnapshot(`
      Object {
        "appUrlActive": true,
        "fallbackValue": false,
        "fallbackValueValidation": Array [
          false,
        ],
        "type": "boolean",
        "validationRegExp": null,
      }
    `);
    expect(featureToggles.getFeatureConfig(FEATURE.B)).toMatchInlineSnapshot(`
      Object {
        "appUrlActive": true,
        "fallbackValue": 1,
        "fallbackValueValidation": Array [
          1,
        ],
        "type": "number",
        "validationRegExp": null,
      }
    `);
    expect(featureToggles.getFeatureConfig(FEATURE.C)).toMatchInlineSnapshot(`
      Object {
        "appUrlActive": true,
        "fallbackValue": "best",
        "fallbackValueValidation": Array [
          "best",
        ],
        "type": "string",
        "validationRegExp": null,
      }
    `);
  });

  it("getFeatureConfigs", async () => {
    await featureToggles.initializeFeatureValues({ config: mockConfig });
    expect(featureToggles.getFeatureConfigs()).toMatchSnapshot();
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
    redisWrapper.watchedGetSetObject.mockImplementationOnce(() => Object.fromEntries(mockFeatureValuesEntries));
    await featureToggles.initializeFeatureValues({ config: mockConfig });

    expect(mockFeatureValuesEntries.map(([key]) => featureToggles.getFeatureValue(key))).toStrictEqual(
      mockFeatureValuesEntries.map(([, value]) => value)
    );
    expect(otherEntries.map(([key]) => featureToggles.getFeatureValue(key))).toStrictEqual(
      otherEntries.map(() => null)
    );
    expect(loggerSpy.error).toHaveBeenCalledTimes(0);
  });

  it("getFeatureValues", async () => {
    const mockFeatureValuesEntries = [
      [[FEATURE.A], true],
      [[FEATURE.B], 0],
      [[FEATURE.C], "cvalue"],
    ];
    const mockFeatureValues = Object.fromEntries(mockFeatureValuesEntries);
    redisWrapper.watchedGetSetObject.mockImplementationOnce(() => mockFeatureValues);
    await featureToggles.initializeFeatureValues({ config: mockConfig });

    const result = featureToggles.getFeatureValues();
    expect(result).not.toBe(mockFeatureValues);
    expect(result).toStrictEqual(mockFeatureValues);
    expect(loggerSpy.error).toHaveBeenCalledTimes(0);
  });

  it("changeFeatureValue", async () => {
    redisWrapper.watchedGetSetObject.mockReturnValueOnce(mockFeatureValues);
    await featureToggles.initializeFeatureValues({ config: mockConfig });
    redisWrapper.watchedGetSetObject.mockClear();
    redisWrapper.getObject.mockReturnValueOnce(mockFeatureValues);

    redisWrapper.publishMessage.mockImplementationOnce((channel, message) => featureToggles.__messageHandler(message));
    const validationErrors = await featureToggles.changeFeatureValue(FEATURE.C, "newa");
    expect(validationErrors).toBeUndefined();
    expect(redisWrapper.watchedGetSetObject).toHaveBeenCalledTimes(1);
    expect(redisWrapper.watchedGetSetObject).toHaveBeenCalledWith(featuresKey, expect.any(Function));
    expect(redisWrapper.publishMessage).toHaveBeenCalledTimes(1);
    expect(redisWrapper.publishMessage).toHaveBeenCalledWith(featuresChannel, refreshMessage);
    expect(redisWrapper.getObject).toHaveBeenCalledTimes(1);
    expect(redisWrapper.getObject).toHaveBeenCalledWith(featuresKey);
    expect(loggerSpy.error).toHaveBeenCalledTimes(0);
  });

  it("changeFeatureValues", async () => {
    redisWrapper.watchedGetSetObject.mockReturnValueOnce(mockFeatureValues);
    await featureToggles.initializeFeatureValues({ config: mockConfig });
    redisWrapper.watchedGetSetObject.mockClear();
    redisWrapper.getObject.mockReturnValueOnce(mockFeatureValues);

    redisWrapper.publishMessage.mockImplementationOnce((channel, message) => featureToggles.__messageHandler(message));
    const input = { [FEATURE.A]: null, [FEATURE.C]: "b" };
    const validationErrors = await featureToggles.changeFeatureValues(input);
    expect(validationErrors).toBeUndefined();
    expect(redisWrapper.watchedGetSetObject).toHaveBeenCalledTimes(1);
    expect(redisWrapper.watchedGetSetObject).toHaveBeenCalledWith(featuresKey, expect.any(Function));
    expect(redisWrapper.publishMessage).toHaveBeenCalledTimes(1);
    expect(redisWrapper.publishMessage).toHaveBeenCalledWith(featuresChannel, refreshMessage);
    expect(redisWrapper.getObject).toHaveBeenCalledTimes(1);
    expect(redisWrapper.getObject).toHaveBeenCalledWith(featuresKey);
    expect(loggerSpy.error).toHaveBeenCalledTimes(0);
  });

  it("changeFeatureValues failing", async () => {
    await featureToggles.initializeFeatureValues({ config: mockConfig });
    redisWrapper.watchedGetSetObject.mockClear();

    const validInput = { [FEATURE.A]: null, [FEATURE.B]: 1 };
    const validationErrorsInvalidKey = await featureToggles.changeFeatureValues({ ...validInput, invalid: 1 });
    expect(validationErrorsInvalidKey).toMatchInlineSnapshot(`
      Array [
        Object {
          "errorMessage": "key \\"{0}\\" is not valid",
          "errorMessageValues": Array [
            "invalid",
          ],
          "key": "invalid",
        },
      ]
    `);
    expect(redisWrapper.watchedGetSetObject).toHaveBeenCalledTimes(0);
    expect(redisWrapper.publishMessage).toHaveBeenCalledTimes(0);
    expect(redisWrapper.getObject).toHaveBeenCalledTimes(0);
    expect(loggerSpy.error).toHaveBeenCalledTimes(0);
  });

  it("refreshFeatureValues", async () => {
    redisWrapper.watchedGetSetObject.mockImplementationOnce(() => mockFeatureValues);
    await featureToggles.initializeFeatureValues({ config: mockConfig });
    redisWrapper.getObject.mockImplementationOnce(() => "getObjectReturn");

    await featureToggles.refreshFeatureValues();
    expect(redisWrapper.getObject).toHaveBeenCalledTimes(1);
    expect(redisWrapper.getObject).toHaveBeenCalledWith(featuresKey);
    expect(featureToggles.__featureValues).toBe("getObjectReturn");
    expect(loggerSpy.error).toHaveBeenCalledTimes(0);
  });

  it("FeatureValueChangeHandler and refreshFeatureValues", async () => {
    const newValue = "newValue";
    const newNewValue = "newNewValue";
    redisWrapper.watchedGetSetObject.mockReturnValueOnce(mockFeatureValues);
    await featureToggles.initializeFeatureValues({ config: mockConfig });
    const oldValue = featureToggles.getFeatureValue(FEATURE.C);
    const handler = jest.fn();
    featureToggles.registerFeatureValueChangeHandler(FEATURE.C, handler);

    // other toggle
    redisWrapper.getObject.mockReturnValueOnce({ ...mockFeatureValues, [FEATURE.B]: 100 });
    await featureToggles.refreshFeatureValues();
    expect(handler).toHaveBeenCalledTimes(0);

    // right toggle
    redisWrapper.getObject.mockReturnValueOnce({ ...mockFeatureValues, [FEATURE.B]: 101, [FEATURE.C]: newValue });
    await featureToggles.refreshFeatureValues();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(newValue, oldValue);
    expect(loggerSpy.error).toHaveBeenCalledTimes(0);

    // right toggle but throwing
    const error = new Error("bad handler");
    handler.mockClear();
    handler.mockRejectedValue(error);
    redisWrapper.getObject.mockReturnValueOnce({
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

    // right toggle
    validationErrors = await featureToggles.changeFeatureValues({ [FEATURE.B]: 101, [FEATURE.C]: newValue });
    expect(validationErrors).toMatchInlineSnapshot(`undefined`);
    expect(validator).toHaveBeenCalledTimes(1);
    expect(validator).toHaveBeenCalledWith(newValue);

    // right toggle but failing
    validator.mockClear();
    const mockErrorMessage = "wrong input";
    validator.mockResolvedValueOnce({ errorMessage: mockErrorMessage });
    validationErrors = await featureToggles.changeFeatureValues({ [FEATURE.B]: 102, [FEATURE.C]: newValue });
    expect(validationErrors).toMatchInlineSnapshot(`
      Array [
        Object {
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
      Array [
        Object {
          "errorMessage": "wrong input {0} {1}",
          "errorMessageValues": Array [
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
      Array [
        Object {
          "errorMessage": "wrong input",
          "key": "test/feature_c",
        },
        Object {
          "errorMessage": "wrong input {0} {1}",
          "errorMessageValues": Array [
            "value1",
            2,
          ],
          "key": "test/feature_c",
        },
      ]
    `);
    expect(validator).toHaveBeenCalledTimes(1);
    expect(validator).toHaveBeenCalledWith(newValue);

    expect(loggerSpy.error).toHaveBeenCalledTimes(0);
  });

  it("FeatureValueValidation and inactive", async () => {
    const newValue = "newValue";
    redisWrapper.watchedGetSetObject.mockReturnValueOnce(mockFeatureValues);
    await featureToggles.initializeFeatureValues({ config: mockConfig });
    const oldValue = featureToggles.getFeatureValue(FEATURE.G);
    const featureConfig = featureToggles.getFeatureConfig(FEATURE.G);

    const validationErrors = await featureToggles.changeFeatureValues({ [FEATURE.G]: newValue });
    const afterChangeValue = featureToggles.getFeatureValue(FEATURE.G);
    expect(featureConfig.active).toBe(false);
    expect(validationErrors).toMatchInlineSnapshot(`
      Array [
        Object {
          "errorMessage": "key \\"{0}\\" is not active",
          "errorMessageValues": Array [
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
      Array [
        Object {
          "errorMessage": "registered validator \\"{0}\\" failed for value \\"{1}\\" with error {2}",
          "errorMessageValues": Array [
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

  it("readConfigFromFile json", async () => {
    const mockFilePath = "inmemory.json";
    const mockConfigData = JSON.stringify(mockConfig);
    readFileSpy.mockImplementationOnce((filename, callback) => callback(null, mockConfigData));
    const config = await readConfigFromFile(mockFilePath);

    expect(readFileSpy).toHaveBeenCalledTimes(1);
    expect(readFileSpy).toHaveBeenCalledWith(mockFilePath, expect.any(Function));
    expect(config).toStrictEqual(mockConfig);
  });

  it("readConfigFromFile yaml", async () => {
    const mockFilePath = "inmemory.yml";
    const mockConfigData = yaml.stringify(mockConfig);
    readFileSpy.mockImplementationOnce((filename, callback) => callback(null, mockConfigData));
    const config = await readConfigFromFile(mockFilePath);

    expect(readFileSpy).toHaveBeenCalledTimes(1);
    expect(readFileSpy).toHaveBeenCalledWith(mockFilePath, expect.any(Function));
    expect(config).toStrictEqual(mockConfig);
  });
});
