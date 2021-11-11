"use strict";

const { FeatureToggles } = require("../src/featureToggles");

const redisWrapper = require("../src/redisWrapper");
jest.mock("../src/redisWrapper", () => ({
  registerMessageHandler: jest.fn(),
  publishMessage: jest.fn(),
  getObject: jest.fn(),
  watchedGetSetObject: jest.fn(),
}));

const FEATURE_A = "test/feature_a";
const FEATURE_B = "test/feature_b";
const FEATURE_C = "test/feature_c";
const FEATURE_D = "test/feature_d";
const FEATURE_E = "test/feature_e";
const FEATURE_F = "test/feature_f";
const mockConfig = {
  [FEATURE_A]: {
    enabled: true,
    fallbackValue: false,
    type: "boolean",
  },
  [FEATURE_B]: {
    enabled: true,
    fallbackValue: 1,
    type: "number",
  },
  [FEATURE_C]: {
    enabled: true,
    fallbackValue: "best",
    type: "string",
  },
  [FEATURE_D]: {
    enabled: true,
    fallbackValue: true,
    type: "boolean",
    validation: "^(?:true)$",
  },
  [FEATURE_E]: {
    enabled: true,
    fallbackValue: 5,
    type: "number",
    validation: "^\\d{1}$",
  },
  [FEATURE_F]: {
    enabled: true,
    fallbackValue: "best",
    type: "string",
    validation: "^(?:best|worst)$",
  },
};

let featureToggles = null;
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
    expect(redisWrapper.watchedGetSetObject).toBeCalledTimes(1);
    expect(redisWrapper.watchedGetSetObject).toBeCalledWith(featuresKey, expect.any(Function));
    expect(redisWrapper.registerMessageHandler).toBeCalledTimes(1);
    expect(redisWrapper.registerMessageHandler).toBeCalledWith(featuresChannel, featureToggles.__messageHandler);
  });

  it("_changeRemoteFeatureValues", async () => {
    const changeObject = { [FEATURE_B]: null, [FEATURE_C]: "new_a" };
    redisWrapper.watchedGetSetObject.mockImplementationOnce(() => "watchedGetSetObjectResult");
    await featureToggles.initializeFeatureValues({ config: mockConfig });
    redisWrapper.watchedGetSetObject.mockClear();

    await featureToggles._changeRemoteFeatureValues(changeObject);

    expect(redisWrapper.watchedGetSetObject).toBeCalledTimes(1);
    expect(redisWrapper.watchedGetSetObject).toBeCalledWith(featuresKey, expect.any(Function));
    expect(redisWrapper.publishMessage).toBeCalledTimes(1);
    expect(redisWrapper.publishMessage).toBeCalledWith(featuresChannel, refreshMessage);
  });

  it("_changeRemoteFeatureValuesCallbackFromInput", async () => {
    await featureToggles.initializeFeatureValues({ config: mockConfig });

    const oldFeatureValues = {
      [FEATURE_A]: "a",
      [FEATURE_B]: "b",
      [FEATURE_C]: "c",
    };
    const changeObject = { [FEATURE_A]: "new_a", [FEATURE_B]: null };
    const result = featureToggles._changeRemoteFeatureValuesCallbackFromInput(changeObject)(oldFeatureValues);
    expect(result).toStrictEqual({
      [FEATURE_A]: "new_a",
      [FEATURE_B]: 1,
      [FEATURE_C]: "c",
    });
  });

  it("validateInput", async () => {
    await featureToggles.initializeFeatureValues({ config: mockConfig });

    const allValidKeys = Object.fromEntries(
      Object.entries(featureToggles.__config).map(([key, { fallbackValue }]) => [key, fallbackValue])
    );
    const inputOutputPairs = [
      [undefined, null],
      [null, null],
      [1, null],
      [() => {}, null],
      [[], null],
      [{}, null],
      [allValidKeys, allValidKeys],
    ];
    const inputOutputValidationTuples = [
      [
        { [FEATURE_A]: true, nonsense: true },
        { [FEATURE_A]: true },
        [
          {
            key: "nonsense",
            errorMessage: 'key "{0}" is not valid',
            errorMessageValues: ["nonsense"],
          },
        ],
      ],
      [
        { [FEATURE_A]: true, [FEATURE_B]: {} },
        { [FEATURE_A]: true },
        [
          {
            key: "test/feature_b",
            errorMessage: 'value "{0}" has invalid type {1}, must be in {2}',
            errorMessageValues: [{}, "object", ["string", "number", "boolean"]],
          },
        ],
      ],
      [
        { [FEATURE_A]: true, [FEATURE_B]: true },
        { [FEATURE_A]: true },
        [
          {
            key: "test/feature_b",
            errorMessage: 'value "{0}" has invalid type {1}, must be {2}',
            errorMessageValues: [true, "boolean", "number"],
          },
        ],
      ],
      [
        { [FEATURE_A]: true, [FEATURE_E]: 10 },
        { [FEATURE_A]: true },
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
  });

  it("getFeatureValue", async () => {
    const mockFeatureValuesEntries = [
      [[FEATURE_A], true],
      [[FEATURE_B], 0],
      [[FEATURE_C], "cvalue"],
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
  });

  it("getFeatureValues", async () => {
    const mockFeatureValuesEntries = [
      [[FEATURE_A], true],
      [[FEATURE_B], 0],
      [[FEATURE_C], "cvalue"],
    ];
    const mockFeatureValues = Object.fromEntries(mockFeatureValuesEntries);
    redisWrapper.watchedGetSetObject.mockImplementationOnce(() => Object.fromEntries(mockFeatureValuesEntries));
    await featureToggles.initializeFeatureValues({ config: mockConfig });

    const result = featureToggles.getFeatureValues();
    expect(result).not.toBe(mockFeatureValues);
    expect(result).toStrictEqual(mockFeatureValues);
  });

  it("changeFeatureValue", async () => {
    redisWrapper.publishMessage.mockImplementationOnce((channel, message) => featureToggles._._messageHandler(message));
    const validationErrors = await featureToggles.changeFeatureValue(FEATURE_C, "newa");
    expect(validationErrors).toBeUndefined();
    expect(redisWrapper.watchedGetSetObject).toHaveBeenCalledTimes(1);
    expect(redisWrapper.watchedGetSetObject).toHaveBeenCalledWith(featureToggles._.FEATURES_KEY, expect.any(Function));
    expect(redisWrapper.publishMessage).toHaveBeenCalledTimes(1);
    expect(redisWrapper.publishMessage).toHaveBeenCalledWith(
      featureToggles._.FEATURES_CHANNEL,
      featureToggles._.REFRESH_MESSAGE
    );
    expect(redisWrapper.getObject).toHaveBeenCalledTimes(1);
    expect(redisWrapper.getObject).toHaveBeenCalledWith(featureToggles._.FEATURES_KEY);
  });

  it("changeFeatureValues", async () => {
    redisWrapper.publishMessage.mockImplementationOnce((channel, message) => featureToggles._._messageHandler(message));
    const input = { [FEATURE_A]: null, [FEATURE_C]: "b" };
    const validationErrors = await featureToggles.changeFeatureValues(input);
    expect(validationErrors).toBeUndefined();
    expect(redisWrapper.watchedGetSetObject).toHaveBeenCalledTimes(1);
    expect(redisWrapper.watchedGetSetObject).toHaveBeenCalledWith(featureToggles._.FEATURES_KEY, expect.any(Function));
    expect(redisWrapper.publishMessage).toHaveBeenCalledTimes(1);
    expect(redisWrapper.publishMessage).toHaveBeenCalledWith(
      featureToggles._.FEATURES_CHANNEL,
      featureToggles._.REFRESH_MESSAGE
    );
    expect(redisWrapper.getObject).toHaveBeenCalledTimes(1);
    expect(redisWrapper.getObject).toHaveBeenCalledWith(featureToggles._.FEATURES_KEY);
  });

  it("changeFeatureValues failing", async () => {
    redisWrapper.publishMessage.mockImplementationOnce((channel, message) => featureToggles._._messageHandler(message));
    const validInput = { [FEATURE_A]: null, [FEATURE_B]: "b" };
    const validationErrorsInvalidKey = await featureToggles.changeFeatureValues({ ...validInput, invalid: 1 });
    expect(validationErrorsInvalidKey).toMatchInlineSnapshot(`
      Array [
        Object {
          "errorMessage": "value \\"{0}\\" has invalid type {1}, must be {2}",
          "errorMessageValues": Array [
            "b",
            "string",
            "number",
          ],
          "key": "test/feature_b",
        },
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
  });

  it("refreshFeatureValues", async () => {
    redisWrapper.getObject.mockImplementationOnce(() => "getObjectReturn");
    await featureToggles.refreshFeatureValues();
    expect(redisWrapper.getObject).toHaveBeenCalledTimes(1);
    expect(redisWrapper.getObject).toHaveBeenCalledWith(featureToggles._.FEATURES_KEY);
    expect(featureToggles._._getFeatureValues()).toBe("getObjectReturn");
  });
});
