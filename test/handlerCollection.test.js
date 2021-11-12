"use strict";

const { HandlerCollection } = require("../src/handlerCollection");

const key = "key";
const otherKey = "otherKey";
const testHandler = jest.fn(() => 1);
const otherTestHandler = jest.fn(() => 2);
let handlerCollection = null;
let registerCount = null;
let removeCount = null;

describe("HandlerCollection", () => {
  beforeEach(() => {
    handlerCollection = new HandlerCollection();
    jest.clearAllMocks();
  });

  it("hasHandlers/registerHandler/removeHandler", () => {
    expect(handlerCollection.hasHandlers(key)).toBe(false);

    registerCount = handlerCollection.registerHandler(key, testHandler);
    expect(handlerCollection.hasHandlers(key)).toBe(true);
    expect(registerCount).toBe(1);
    expect(handlerCollection._handlers()[key]).toContain(testHandler);

    registerCount = handlerCollection.registerHandler(key, otherTestHandler);
    expect(handlerCollection.hasHandlers(key)).toBe(true);
    expect(registerCount).toBe(2);
    expect(handlerCollection._handlers()[key]).toContain(otherTestHandler);

    removeCount = handlerCollection.removeHandler(key, testHandler);
    expect(handlerCollection.hasHandlers(key)).toBe(true);
    expect(removeCount).toBe(1);
    expect(handlerCollection._handlers()[key]).not.toContain(testHandler);

    removeCount = handlerCollection.removeHandler(key, otherTestHandler);
    expect(handlerCollection.hasHandlers(key)).toBe(false);
    expect(removeCount).toBe(0);
    expect(handlerCollection._handlers()[key]).toBeUndefined();

    expect(testHandler).toHaveBeenCalledTimes(0);
    expect(otherTestHandler).toHaveBeenCalledTimes(0);
  });

  it("cross-key hasHandlers/registerHandler/removeHandler", () => {
    expect(handlerCollection.hasHandlers(key)).toBe(false);
    expect(handlerCollection.hasHandlers(otherKey)).toBe(false);

    registerCount = handlerCollection.registerHandler(key, testHandler);
    expect(handlerCollection.hasHandlers(key)).toBe(true);
    expect(registerCount).toBe(1);

    registerCount = handlerCollection.registerHandler(otherKey, otherTestHandler);
    expect(handlerCollection.hasHandlers(otherKey)).toBe(true);
    expect(registerCount).toBe(1);

    // TODO that's not right...
    // removeCount = handlerCollection.removeHandler(key, otherTestHandler);
    // expect(handlerCollection.hasHandlers(key)).toBe(true);
    // expect(removeCount).toBe(1);
    //
    // removeCount = handlerCollection.removeHandler(otherKey, testHandler);
    // expect(handlerCollection.hasHandlers(otherKey)).toBe(true);
    // expect(removeCount).toBe(1);
    //
    // removeCount = handlerCollection.removeHandler(key, testHandler);
    // expect(handlerCollection.hasHandlers(key)).toBe(false);
    // expect(removeCount).toBe(0);
    //
    // removeCount = handlerCollection.removeHandler(otherKey, otherTestHandler);
    // expect(handlerCollection.hasHandlers(otherKey)).toBe(false);
    // expect(removeCount).toBe(0);
    //
    // expect(testHandler).toHaveBeenCalledTimes(0);
    // expect(otherTestHandler).toHaveBeenCalledTimes(0);
  });

  it("removeAllHandlers", () => {
    registerCount = handlerCollection.registerHandler(key, testHandler);
    registerCount = handlerCollection.registerHandler(key, otherTestHandler);
    registerCount = handlerCollection.registerHandler(key, jest.fn());
    registerCount = handlerCollection.registerHandler(key, jest.fn());
    registerCount = handlerCollection.registerHandler(key, jest.fn());

    expect(registerCount).toBe(5);
    expect(handlerCollection.hasHandlers(key)).toBe(true);

    removeCount = handlerCollection.removeAllHandlers(key);
    expect(removeCount).toBe(0);
    expect(handlerCollection.hasHandlers(key)).toBe(false);

    expect(testHandler).toHaveBeenCalledTimes(0);
    expect(otherTestHandler).toHaveBeenCalledTimes(0);
  });

  it("triggerHandlers", async () => {
    // TODO
    expect(true).toBe(true);
  });
});
