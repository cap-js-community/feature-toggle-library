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
    const resultsPrimary = await Promise.all(Array.from({ length: n }, (_, i) => exclusiveRunner(i + 1)));

    const resultsSecondary = await Promise.all([exclusiveRunner(n + 1)]);
    expect(resultsPrimary).toMatchInlineSnapshot(`
      [
        "finished",
        "finished",
        "finished",
      ]
    `);
    expect(resultsSecondary).toMatchInlineSnapshot(`
      [
        "finished",
      ]
    `);
    expect(executionLog).toMatchInlineSnapshot(`
      [
        "started 1",
        "finished 1",
        "started 2",
        "finished 2",
        "started 3",
        "finished 3",
        "started 4",
        "finished 4",
      ]
    `);
  });

  test("make exclusive returning", async () => {
    const exclusiveRunner = Semaphore.makeExclusiveReturning(runner);
    const resultsPrimary = await Promise.all(Array.from({ length: n }, (_, i) => exclusiveRunner(i + 1)));

    const resultsSecondary = await Promise.all([exclusiveRunner(n + 1)]);
    expect(resultsPrimary).toMatchInlineSnapshot(`
      [
        "finished",
        undefined,
        undefined,
      ]
    `);
    expect(resultsSecondary).toMatchInlineSnapshot(`
      [
        "finished",
      ]
    `);
    expect(executionLog).toMatchInlineSnapshot(`
      [
        "started 1",
        "finished 1",
        "started 4",
        "finished 4",
      ]
    `);
  });
});
