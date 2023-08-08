"use strict";

const featureTogglesModule = require("../src/featureToggles");
const { FeatureToggles } = featureTogglesModule;
const { Logger } = require("../src/logger");

const redisWrapper = require("../src/redisWrapper");
jest.mock("../src/redisWrapper", () => require("./__mocks__/redisWrapper"));

const { FEATURE, mockConfig, redisKey, redisChannel, refreshMessage } = require("./mockdata");

let featureToggles = null;

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
        .map(([key, value]) => {
          if (["msg"].includes(key)) {
            return [key, value.replace(/\n.*$/gm, "")];
          }
          return [key, value];
        })
    );
    return JSON.stringify(newData);
  });

describe("logger test", () => {
  beforeEach(() => {
    redisWrapper._reset();
    featureToggles = new FeatureToggles({ redisKey, redisChannel, refreshMessage });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("check readable logging for invalid fallback values during initialization", async () => {
    featureTogglesModule._._setLogger(new Logger({ layer: "Testing", readable: true }));
    const error = new Error("bad validator");
    const validator = jest.fn().mockRejectedValue(error);

    featureToggles.registerFeatureValueValidation(FEATURE.B, validator);
    await featureToggles.initializeFeatures({ config: mockConfig });

    expect(processStreamSpy.stdout.mock.calls.map(cleanupReadableLogCalls)).toMatchInlineSnapshot(`
[
  [
    "88:88:88.888 | warn | Testing | {"validationErrors":"[{\\"featureKey\\":\\"test/feature_b\\",\\"errorMessage\\":\\"registered validator \\\\\\"{0}\\\\\\" failed for value \\\\\\"{1}\\\\\\" with error {2}\\",\\"errorMessageValues\\":[\\"mockConstructor\\",1,\\"bad validator\\"]}]"} | FeatureTogglesError: found invalid fallback values during initialization
",
  ],
  [
    "88:88:88.888 | info | Testing | finished initialization with 9 feature toggles with CF_REDIS
",
  ],
]
`);
    expect(processStreamSpy.stderr.mock.calls.map(cleanupReadableLogCalls)).toMatchInlineSnapshot(`
[
  [
    "88:88:88.888 | error | Testing | {"validator":"mockConstructor","featureKey":"test/feature_b","value":1} | FeatureTogglesError: error during registered validator: bad validator
caused by: Error: bad validator
",
  ],
]
`);
  });

  it("check json logging for invalid fallback values during initialization", async () => {
    featureTogglesModule._._setLogger(new Logger({ layer: "Testing", readable: false }));
    const error = new Error("bad validator");
    const validator = jest.fn().mockRejectedValue(error);

    featureToggles.registerFeatureValueValidation(FEATURE.B, validator);
    await featureToggles.initializeFeatures({ config: mockConfig });

    const logStderrCalls = processStreamSpy.stderr.mock.calls.map(cleanupJSONLogCalls);
    const logStdoutCalls = processStreamSpy.stdout.mock.calls.map(cleanupJSONLogCalls);
    expect(logStderrCalls).toMatchInlineSnapshot(`
[
  [
    "{"error_info":"{\\"validator\\":\\"mockConstructor\\",\\"featureKey\\":\\"test/feature_b\\",\\"value\\":1}","level":"error","msg":"FeatureTogglesError: error during registered validator: bad validator","type":"log","layer":"Testing"}",
  ],
]
`);
    expect(logStdoutCalls).toMatchInlineSnapshot(`
[
  [
    "{"error_info":"{\\"validationErrors\\":\\"[{\\\\\\"featureKey\\\\\\":\\\\\\"test/feature_b\\\\\\",\\\\\\"errorMessage\\\\\\":\\\\\\"registered validator \\\\\\\\\\\\\\"{0}\\\\\\\\\\\\\\" failed for value \\\\\\\\\\\\\\"{1}\\\\\\\\\\\\\\" with error {2}\\\\\\",\\\\\\"errorMessageValues\\\\\\":[\\\\\\"mockConstructor\\\\\\",1,\\\\\\"bad validator\\\\\\"]}]\\"}","level":"warn","msg":"FeatureTogglesError: found invalid fallback values during initialization","type":"log","layer":"Testing"}",
  ],
  [
    "{"level":"info","msg":"finished initialization with 9 feature toggles with CF_REDIS","type":"log","layer":"Testing"}",
  ],
]
`);
    const [registerValidatorError] = logStderrCalls.map(([log]) => JSON.parse(log));
    const [initializeError] = logStdoutCalls.map(([log]) => JSON.parse(log));
    expect(registerValidatorError.msg).toContain("bad validator");
    expect(initializeError.msg).toContain("invalid");
  });
});
