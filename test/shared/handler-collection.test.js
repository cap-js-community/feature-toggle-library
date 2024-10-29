"use strict";

const { HandlerCollection } = require("../../src/shared/handler-collection");

const key = "key";
const otherKey = "otherKey";
const testHandler = jest.fn(() => 1);
const otherTestHandler = jest.fn(() => 2);
let handlerCollection = null;
let count = null;
let otherCount = null;

describe("HandlerCollection", () => {
  beforeEach(() => {
    handlerCollection = new HandlerCollection();
    jest.clearAllMocks();
  });

  test("registerHandler/removeHandler/hasHandlers/getHandlers", () => {
    expect(handlerCollection.hasHandlers(key)).toBe(false);

    count = handlerCollection.registerHandler(key, testHandler);
    expect(handlerCollection.hasHandlers(key)).toBe(true);
    expect(count).toBe(1);
    expect(handlerCollection.getHandlers(key)).toContain(testHandler);

    count = handlerCollection.registerHandler(key, otherTestHandler);
    expect(handlerCollection.hasHandlers(key)).toBe(true);
    expect(count).toBe(2);
    expect(handlerCollection.getHandlers(key)).toContain(otherTestHandler);

    count = handlerCollection.removeHandler(key, testHandler);
    expect(handlerCollection.hasHandlers(key)).toBe(true);
    expect(count).toBe(1);
    expect(handlerCollection.getHandlers(key)).not.toContain(testHandler);

    count = handlerCollection.removeHandler(key, otherTestHandler);
    expect(handlerCollection.hasHandlers(key)).toBe(false);
    expect(count).toBe(0);
    expect(handlerCollection.getHandlers(key)).toStrictEqual([]);
  });

  test("cross-key registerHandler/removeHandler/hasHandlers/getHandlers", () => {
    expect(handlerCollection.hasHandlers(key)).toBe(false);
    expect(handlerCollection.hasHandlers(otherKey)).toBe(false);

    count = handlerCollection.registerHandler(key, testHandler);
    expect(handlerCollection.hasHandlers(key)).toBe(true);
    expect(count).toBe(1);
    expect(handlerCollection.getHandlers(key)).toStrictEqual([testHandler]);

    otherCount = handlerCollection.registerHandler(otherKey, otherTestHandler);
    expect(handlerCollection.hasHandlers(otherKey)).toBe(true);
    expect(otherCount).toBe(1);
    expect(handlerCollection.getHandlers(otherKey)).toStrictEqual([otherTestHandler]);

    count = handlerCollection.removeHandler(key, otherTestHandler);
    expect(handlerCollection.hasHandlers(key)).toBe(true);
    expect(count).toBe(1);
    expect(handlerCollection.getHandlers(key)).toStrictEqual([testHandler]);

    otherCount = handlerCollection.removeHandler(otherKey, testHandler);
    expect(handlerCollection.hasHandlers(otherKey)).toBe(true);
    expect(otherCount).toBe(1);
    expect(handlerCollection.getHandlers(otherKey)).toStrictEqual([otherTestHandler]);

    count = handlerCollection.removeHandler(key, testHandler);
    expect(handlerCollection.hasHandlers(key)).toBe(false);
    expect(count).toBe(0);
    expect(handlerCollection.getHandlers(key)).toStrictEqual([]);

    otherCount = handlerCollection.removeHandler(otherKey, otherTestHandler);
    expect(handlerCollection.hasHandlers(otherKey)).toBe(false);
    expect(otherCount).toBe(0);
    expect(handlerCollection.getHandlers(otherKey)).toStrictEqual([]);
  });

  test("getHandlers returns clone", () => {
    handlerCollection.registerHandler(key, testHandler, otherTestHandler);
    const handlers = handlerCollection.getHandlers(key);
    expect(handlers).toStrictEqual([testHandler, otherTestHandler]);
    handlers.splice(0, 1);
    expect(handlers).toStrictEqual([otherTestHandler]);
    expect(handlerCollection.getHandlers(key)).toStrictEqual([testHandler, otherTestHandler]);
  });

  test("removeAllHandlers", () => {
    count = handlerCollection.registerHandler(key, testHandler, otherTestHandler, jest.fn(), jest.fn(), jest.fn());

    expect(count).toBe(5);
    expect(handlerCollection.hasHandlers(key)).toBe(true);

    count = handlerCollection.removeAllHandlers(key);
    expect(count).toBe(0);
    expect(handlerCollection.hasHandlers(key)).toBe(false);
  });

  test("duplicate registerHandler/removeHandler", async () => {
    const survivor = jest.fn();
    count = handlerCollection.registerHandler(key, testHandler, survivor, otherTestHandler, testHandler, survivor);
    expect(count).toBe(5);

    expect(handlerCollection.getHandlers(key)).toStrictEqual([
      testHandler,
      survivor,
      otherTestHandler,
      testHandler,
      survivor,
    ]);

    count = handlerCollection.removeHandler(key, testHandler, otherTestHandler);
    expect(count).toBe(2);
    expect(handlerCollection.getHandlers(key)).toStrictEqual([survivor, survivor]);
  });
});
