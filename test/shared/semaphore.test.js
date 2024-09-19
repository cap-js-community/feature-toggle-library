"use strict";
const { promisify, format } = require("util");

const { Semaphore } = require("../../src/shared/semaphore");

const sleep = promisify(setTimeout);

describe("semaphore", () => {
  let executionLog;
  const n = 3;
  const m = 2;
  const runner = async (index) => {
    executionLog.push(format("started %d", index));
    await sleep(10);
    executionLog.push(format("finished %d", index));
    return format("result %d", index);
  };

  beforeEach(() => {
    executionLog = [];
  });

  test("non-exclusive", async () => {
    const resultsPrimary = await Promise.all(Array.from({ length: n }, (_, i) => runner(i + 1)));

    const resultsSecondary = await Promise.all(Array.from({ length: m }, (_, i) => runner(n + i + 1)));
    expect(resultsPrimary).toMatchInlineSnapshot(`
      [
        "result 1",
        "result 2",
        "result 3",
      ]
    `);
    expect(resultsSecondary).toMatchInlineSnapshot(`
      [
        "result 4",
        "result 5",
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
        "result 1",
        "result 2",
        "result 3",
      ]
    `);
    expect(resultsSecondary).toMatchInlineSnapshot(`
      [
        "result 4",
        "result 5",
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
        "result 1",
        "result 1",
        "result 1",
      ]
    `);
    expect(resultsSecondary).toMatchInlineSnapshot(`
      [
        "result 4",
        "result 4",
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

  test("one-time", async () => {
    const exclusiveRunner = Semaphore.makeOneTime(runner);
    const resultsPrimary = await Promise.all(Array.from({ length: n }, (_, i) => exclusiveRunner(i + 1)));

    const resultsSecondary = await Promise.all(Array.from({ length: m }, (_, i) => exclusiveRunner(n + i + 1)));
    expect(resultsPrimary).toMatchInlineSnapshot(`
      [
        "result 1",
        "result 1",
        "result 1",
      ]
    `);
    expect(resultsSecondary).toMatchInlineSnapshot(`
      [
        "result 1",
        "result 1",
      ]
    `);
    expect(executionLog).toMatchInlineSnapshot(`
      [
        "started 1",
        "finished 1",
      ]
    `);
  });
});
