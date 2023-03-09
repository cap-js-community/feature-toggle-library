"use strict";

const { promisify } = require("util");
const { promiseAllDone } = require("../src/shared/promiseAllDone");

describe("promiseAllDone", () => {
  it("second reject is caught", async () => {
    let secondErrorStillRunning = true;
    let didThrow = false;
    try {
      // NOTE with Promise.all this will fail
      await promiseAllDone([
        Promise.resolve(1),
        Promise.resolve(2),
        Promise.resolve(3),
        Promise.reject(new Error("1")),
        (async () => {
          await promisify(setTimeout)(100);
          secondErrorStillRunning = false;
          throw new Error("2");
        })(),
      ]);
    } catch (err) {
      didThrow = true;
    }
    expect(didThrow).toBe(true);
    expect(secondErrorStillRunning).toBe(false);
  });
});
