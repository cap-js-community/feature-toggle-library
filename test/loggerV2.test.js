"use strict";

const VError = require("verror");
const { Logger } = require("../src/logger");

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
  "88:88:88.888 | info | some info
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
  "{"level":"info","msg":"some info","type":"log","layer":"/test"}",
]
`);
      expect(processStreamSpy.stdout.mock.calls.length).toBe(1);
    });

    it("info with text readable", async () => {
      logger = new Logger({ layer, readable: true });
      logger.info("some info");
      expect(processStreamSpy.stdout.mock.calls.map(cleanupReadableLogCalls)[0]).toMatchInlineSnapshot(`
[
  "88:88:88.888 | info | /test | some info
",
]
`);
      expect(processStreamSpy.stdout.mock.calls.length).toBe(1);
    });

    it("bla error with verror", async () => {
      logger = new Logger({ layer });
      logger.error(new VError("bla error"));
      expect(processStreamSpy.stderr.mock.calls.map(cleanupJsonLogCalls)[0]).toMatchInlineSnapshot(`
[
  "{"error_info":"{}","level":"error","msg":"VError: bla error","type":"log","layer":"/test"}",
]
`);
      expect(processStreamSpy.stderr.mock.calls.length).toBe(1);
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
  "{"level":"info","msg":"base","type":"log","layer":"/test"}",
]
`);
      childLogger.info("child");
      expect(processStreamSpy.stdout.mock.calls.map(cleanupJsonLogCalls)[i++]).toMatchInlineSnapshot(`
[
  "{"isChild":true,"level":"info","msg":"child","type":"log","layer":"/test"}",
]
`);
      siblingLogger.info("sibling");
      expect(processStreamSpy.stdout.mock.calls.map(cleanupJsonLogCalls)[i++]).toMatchInlineSnapshot(`
[
  "{"isSibling":true,"level":"info","msg":"sibling","type":"log","layer":"/test"}",
]
`);
      childChildLogger.info("child child");
      expect(processStreamSpy.stdout.mock.calls.map(cleanupJsonLogCalls)[i++]).toMatchInlineSnapshot(`
[
  "{"isChild":true,"isChildChild":true,"level":"info","msg":"child child","type":"log","layer":"/test"}",
]
`);
      expect(processStreamSpy.stdout.mock.calls.length).toBe(i);
    });
  });
});
