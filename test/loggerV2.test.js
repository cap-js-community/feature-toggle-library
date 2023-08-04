"use strict";

const VError = require("verror");
const { Logger } = require("../src/loggerV2");

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
      logger = new Logger({ readable: true });
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
      logger = new Logger({ layer });
      logger.info("some info");
      expect(processStreamSpy.stdout.mock.calls.map(cleanupJsonLogCalls)[0]).toMatchInlineSnapshot(`
[
  "{"type":"log","level":"INFO","layer":"/test","msg":"some info"}",
]
`);
      expect(processStreamSpy.stdout.mock.calls.length).toBe(1);
    });

    it("info with text readable", async () => {
      logger = new Logger({ layer, readable: true });
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
      logger = new Logger({ layer });
      logger.error(new VError("bla error"));
      expect(processStreamSpy.stdout.mock.calls.map(cleanupJsonLogCalls)[0]).toMatchInlineSnapshot(`
[
  "{"type":"log","level":"INFO","layer":"/test","error_info":{},"msg":"VError: bla error"}",
]
`);
      expect(processStreamSpy.stdout.mock.calls.length).toBe(1);
    });
  });

  describe("request logger", () => {
    it("bla error with verror", async () => {
      const logger = new Logger({ layer });
      const childLogger = logger.child({ isChild: true });
      const siblingLogger = logger.child({ isSibling: true });
      const childChildLogger = childLogger.child({ isChildChild: true });
      let i = 0;

      logger.info("base");
      expect(processStreamSpy.stdout.mock.calls.map(cleanupJsonLogCalls)[i++]).toMatchInlineSnapshot(`
[
  "{"type":"log","layer":"/test","level":"INFO","msg":"base"}",
]
`);
      childLogger.info("child");
      expect(processStreamSpy.stdout.mock.calls.map(cleanupJsonLogCalls)[i++]).toMatchInlineSnapshot(`
[
  "{"isChild":true,"type":"log","layer":"/test","level":"INFO","msg":"child"}",
]
`);
      siblingLogger.info("sibling");
      expect(processStreamSpy.stdout.mock.calls.map(cleanupJsonLogCalls)[i++]).toMatchInlineSnapshot(`
[
  "{"isSibling":true,"type":"log","layer":"/test","level":"INFO","msg":"sibling"}",
]
`);
      childChildLogger.info("child child");
      expect(processStreamSpy.stdout.mock.calls.map(cleanupJsonLogCalls)[i++]).toMatchInlineSnapshot(`
[
  "{"isChild":true,"isChildChild":true,"type":"log","layer":"/test","level":"INFO","msg":"child child"}",
]
`);
      expect(processStreamSpy.stdout.mock.calls.length).toBe(i);
    });
  });
});
