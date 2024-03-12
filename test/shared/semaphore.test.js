"use strict";
const { promisify, format } = require("util");

const { Semaphore } = require("../../src/shared/semaphore");

const sleep = promisify(setTimeout);

describe("semaphore", () => {
  let executionLog;
  const n = 3;
  const m = 2;
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

  test("non-exclusive", async () => {
    const resultsPrimary = await Promise.all(Array.from({ length: n }, (_, i) => runner(i + 1)));

    const resultsSecondary = await Promise.all(Array.from({ length: m }, (_, i) => runner(n + i + 1)));
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
        "finished",
      ]
    `);
    expect(executionLog).toMatchInlineSnapshot(`
      [
        "started 1",
        "started 2",
        "started 3",
        "finished 1",
        "finished 2",
        "finished 3",
        "started 4",
        "started 5",
        "finished 4",
        "finished 5",
      ]
    `);
  });

  test("exclusive queueing", async () => {
    const exclusiveRunner = Semaphore.makeExclusiveQueuing(runner);
    const resultsPrimary = await Promise.all(Array.from({ length: n }, (_, i) => exclusiveRunner(i + 1)));

    const resultsSecondary = await Promise.all(Array.from({ length: m }, (_, i) => exclusiveRunner(n + i + 1)));
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
        "started 5",
        "finished 5",
      ]
    `);
  });

  test("exclusive returning", async () => {
    const exclusiveRunner = Semaphore.makeExclusiveReturning(runner);
    const resultsPrimary = await Promise.all(Array.from({ length: n }, (_, i) => exclusiveRunner(i + 1)));

    const resultsSecondary = await Promise.all(Array.from({ length: m }, (_, i) => exclusiveRunner(n + i + 1)));
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
        undefined,
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
