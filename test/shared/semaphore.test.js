"use strict";
const { promisify, format } = require("util");

const { Semaphore } = require("../../src/shared/semaphore");

const sleep = promisify(setTimeout);

describe("semaphore", () => {
  let executionLog;
  const n = 3;
  const result = "finished";
  const runner = async (index) => {
    executionLog.push(format("started %d", index));
    await sleep(10);
    executionLog.push(format("finished %d", index));
    return result;
  };

  beforeEach(() => {
    executionLog = [];
  });

  test("make exclusive queueing", async () => {
    const exclusiveRunner = Semaphore.makeExclusiveQueuing(runner);
    const results = await Promise.all(Array.from({ length: n }, (_, i) => exclusiveRunner(i)));
    expect(results).toMatchInlineSnapshot(`
      [
        "finished",
        "finished",
        "finished",
      ]
    `);
    expect(executionLog).toMatchInlineSnapshot(`
      [
        "started 0",
        "finished 0",
        "started 1",
        "finished 1",
        "started 2",
        "finished 2",
      ]
    `);
  });

  test("make exclusive returning", async () => {
    const exclusiveRunner = Semaphore.makeExclusiveReturning(runner);
    const results = await Promise.all(Array.from({ length: n }, (_, i) => exclusiveRunner(i)));
    expect(results).toMatchInlineSnapshot(`
      [
        "finished",
        undefined,
        undefined,
      ]
    `);
    expect(executionLog).toMatchInlineSnapshot(`
      [
        "started 0",
        "finished 0",
      ]
    `);
  });
});
