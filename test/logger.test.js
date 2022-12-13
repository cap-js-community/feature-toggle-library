"use strict";

const featureTogglesModule = require("../src/featureToggles");
const { FeatureToggles } = featureTogglesModule;
const Logger = require("../src/logger");

const redisWrapper = require("../src/redisWrapper");
jest.mock("../src/redisWrapper", () => require("./__mocks__/redisWrapper"));

const { FEATURE, mockConfig, featuresKey, featuresChannel, refreshMessage } = require("./mockdata");

let featureToggles = null;

const consoleSpy = {
  info: jest.spyOn(console, "info"),
  warn: jest.spyOn(console, "warn"),
  error: jest.spyOn(console, "error"),
};

const processStreamSpy = {
  stdout: jest.spyOn(process.stdout, "write"),
  stderr: jest.spyOn(process.stderr, "write"),
};

const cleanupReadableLogCalls = (args) =>
  args.map((arg) =>
    typeof arg !== "string"
      ? arg
      : arg.replace(/\d\d:\d\d:\d\d.\d\d\d/g, "88:88:88.888").replace(/(?<=\n)\s+at.*?\n/g, "")
  );

const cleanupJSONLogCalls = (args) =>
  args.map((arg) => {
    if (typeof arg !== "string") {
      return arg;
    }
    const data = JSON.parse(arg);
    const newData = Object.fromEntries(
      Object.entries(data)
        .filter(
          ([key, value]) => !["written_at", "written_ts", "correlation_id"].includes(key) && !["-", "0"].includes(value)
        )
        .map(([key, value]) => (key === "stacktrace" ? [key, value.slice(0, 1)] : [key, value]))
    );
    return JSON.stringify(newData);
  });

describe("logger test", () => {
  beforeEach(() => {
    redisWrapper._reset();
    featureToggles = new FeatureToggles({ featuresKey, featuresChannel, refreshMessage });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("check readable logging for invalid fallback values during initialization", async () => {
    featureTogglesModule._._setLogger(new Logger("Testing", false));
    const error = new Error("bad validator");
    const validator = jest.fn().mockRejectedValue(error);

    featureToggles.registerFeatureValueValidation(FEATURE.B, validator);
    await featureToggles.initializeFeatureValues({ config: mockConfig });

    expect(consoleSpy.info.mock.calls.map(cleanupReadableLogCalls)).toMatchInlineSnapshot(`
      [
        [
          "88:88:88.888 | info | Testing | finished initialization with 8 feature toggles",
        ],
      ]
    `);
    expect(consoleSpy.warn.mock.calls.map(cleanupReadableLogCalls)).toMatchInlineSnapshot(`
      [
        [
          "88:88:88.888 | warn | Testing | FeatureTogglesError: found invalid fallback values during initialization
      error info: {
        validationErrors: '[{"errorMessage":"registered validator \\\\"{0}\\\\" failed for value \\\\"{1}\\\\" with error {2}","errorMessageValues":["mockConstructor",1,"bad validator"],"key":"test/feature_b"}]'
      }",
        ],
      ]
    `);
    expect(consoleSpy.error.mock.calls.map(cleanupReadableLogCalls)).toMatchInlineSnapshot(`
      [
        [
          "88:88:88.888 | error | Testing | FeatureTogglesError: error during registered validator: bad validator
      caused by: Error: bad validator
      error info: { validator: 'mockConstructor', key: 'test/feature_b', value: 1 }",
        ],
        [
          "88:88:88.888 | error | Testing | FeatureTogglesError: error during registered validator: bad validator
      caused by: Error: bad validator
      error info: { validator: 'mockConstructor', key: 'test/feature_b', value: 1 }",
        ],
      ]
    `);
  });

  it("check json logging for invalid fallback values during initialization", async () => {
    featureTogglesModule._._setLogger(new Logger("Testing", true));
    const error = new Error("bad validator");
    const validator = jest.fn().mockRejectedValue(error);

    featureToggles.registerFeatureValueValidation(FEATURE.B, validator);
    await featureToggles.initializeFeatureValues({ config: mockConfig });

    expect(processStreamSpy.stdout.mock.calls.map(cleanupJSONLogCalls)).toMatchInlineSnapshot(`
      [
        [
          "{"component_type":"application","layer":"Testing","logger":"nodejs-logger","level":"error","stacktrace":["FeatureTogglesError: error during registered validator: bad validator"],"msg":"","type":"log","errInfo":"{\\"validator\\":\\"mockConstructor\\",\\"key\\":\\"test/feature_b\\",\\"value\\":1}"}",
        ],
        [
          "{"component_type":"application","layer":"Testing","logger":"nodejs-logger","level":"error","stacktrace":["FeatureTogglesError: error during registered validator: bad validator"],"msg":"","type":"log","errInfo":"{\\"validator\\":\\"mockConstructor\\",\\"key\\":\\"test/feature_b\\",\\"value\\":1}"}",
        ],
        [
          "{"component_type":"application","layer":"Testing","logger":"nodejs-logger","level":"warn","stacktrace":["FeatureTogglesError: found invalid fallback values during initialization"],"msg":"","type":"log","errInfo":"{\\"validationErrors\\":\\"[{\\\\\\"errorMessage\\\\\\":\\\\\\"registered validator \\\\\\\\\\\\\\"{0}\\\\\\\\\\\\\\" failed for value \\\\\\\\\\\\\\"{1}\\\\\\\\\\\\\\" with error {2}\\\\\\",\\\\\\"errorMessageValues\\\\\\":[\\\\\\"mockConstructor\\\\\\",1,\\\\\\"bad validator\\\\\\"],\\\\\\"key\\\\\\":\\\\\\"test/feature_b\\\\\\"}]\\"}"}",
        ],
        [
          "{"component_type":"application","layer":"Testing","logger":"nodejs-logger","level":"info","msg":"finished initialization with 8 feature toggles","type":"log"}",
        ],
      ]
    `);
    expect(processStreamSpy.stderr.mock.calls.map(cleanupJSONLogCalls)).toMatchInlineSnapshot(`[]`);
  });
});
