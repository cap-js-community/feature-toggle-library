"use strict";

const VError = require("verror");
const { ServerLogger, RequestLogger } = require("../src/loggerV2");

const processStreamSpy = {
  stdout: jest.spyOn(process.stdout, "write"),
  stderr: jest.spyOn(process.stderr, "write"),
};

const layer = "/test";

const cleanupReadableLogCalls = (args) =>
  args.map((arg) =>
    typeof arg !== "string"
      ? arg
      : arg.replace(/\d\d:\d\d:\d\d.\d\d\d/g, "88:88:88.888").replace(/(?<=\n)\s+at.*?\n/g, "")
  );

const cleanupJsonLogCalls = (args) =>
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
          if (["stacktrace"].includes(key)) {
            return [key, value.slice(0, 1)];
          }
          if (["msg"].includes(key)) {
            return [key, value.replace(/\n.*$/gm, "")];
          }
          return [key, value];
        })
    );
    return JSON.stringify(newData);
  });

let logger;
describe("loggerV2", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("server logger", () => {
    it("info with text readable and no layer", async () => {
      logger = new ServerLogger({ readable: true });
      logger.info("some info");
      expect(processStreamSpy.stdout.mock.calls.map(cleanupReadableLogCalls)[0]).toMatchInlineSnapshot(`
[
  "88:88:88.888 | INFO | some info
",
]
`);
      expect(processStreamSpy.stdout.mock.calls.length).toBe(1);
    });

    it("info with text", async () => {
      logger = new ServerLogger({ layer });
      logger.info("some info");
      expect(processStreamSpy.stdout.mock.calls.map(cleanupJsonLogCalls)[0]).toMatchInlineSnapshot(`
[
  "{"component_type":"application","type":"log","level":"INFO","layer":"/test","msg":"some info"}",
]
`);
      expect(processStreamSpy.stdout.mock.calls.length).toBe(1);
    });

    it("info with text readable", async () => {
      logger = new ServerLogger({ layer, readable: true });
      logger.info("some info");
      expect(processStreamSpy.stdout.mock.calls.map(cleanupReadableLogCalls)[0]).toMatchInlineSnapshot(`
[
  "88:88:88.888 | INFO | /test | some info
",
]
`);
      expect(processStreamSpy.stdout.mock.calls.length).toBe(1);
    });

    it("bla error with verror", async () => {
      logger = new ServerLogger({ layer });
      logger.error(new VError("bla error"));
      expect(processStreamSpy.stdout.mock.calls.map(cleanupJsonLogCalls)[0]).toMatchInlineSnapshot(`
[
  "{"component_type":"application","type":"log","level":"INFO","layer":"/test","stacktrace":"V","error_info":{},"msg":"VError: bla error"}",
]
`);
      expect(processStreamSpy.stdout.mock.calls.length).toBe(1);
    });
  });

  describe("request logger", () => {
    it("bla error with verror", async () => {
      logger = new RequestLogger(new ServerLogger({ layer }));
      logger.error(new VError("bla error"));
      expect(processStreamSpy.stdout.mock.calls.map(cleanupJsonLogCalls)[0]).toMatchInlineSnapshot(`
[
  "{"component_type":"application","type":"request","level":"INFO","layer":"/test","stacktrace":"V","error_info":{},"msg":"VError: bla error"}",
]
`);
      expect(processStreamSpy.stdout.mock.calls.length).toBe(1);
    });
  });
});
