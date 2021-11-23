"use strict";

const { HandlerCollection } = require("../src/handlerCollection");

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

  it("hasHandlers/registerHandler/removeHandler", () => {
    expect(handlerCollection.hasHandlers(key)).toBe(false);

    count = handlerCollection.registerHandler(key, testHandler);
    expect(handlerCollection.hasHandlers(key)).toBe(true);
    expect(count).toBe(1);
    expect(handlerCollection._handlers()[key]).toContain(testHandler);

    count = handlerCollection.registerHandler(key, otherTestHandler);
    expect(handlerCollection.hasHandlers(key)).toBe(true);
    expect(count).toBe(2);
    expect(handlerCollection._handlers()[key]).toContain(otherTestHandler);

    count = handlerCollection.removeHandler(key, testHandler);
    expect(handlerCollection.hasHandlers(key)).toBe(true);
    expect(count).toBe(1);
    expect(handlerCollection._handlers()[key]).not.toContain(testHandler);

    count = handlerCollection.removeHandler(key, otherTestHandler);
    expect(handlerCollection.hasHandlers(key)).toBe(false);
    expect(count).toBe(0);
    expect(handlerCollection._handlers()[key]).toBeUndefined();

    expect(testHandler).toHaveBeenCalledTimes(0);
    expect(otherTestHandler).toHaveBeenCalledTimes(0);
  });

  it("cross-key hasHandlers/registerHandler/removeHandler", () => {
    expect(handlerCollection.hasHandlers(key)).toBe(false);
    expect(handlerCollection.hasHandlers(otherKey)).toBe(false);

    count = handlerCollection.registerHandler(key, testHandler);
    expect(handlerCollection.hasHandlers(key)).toBe(true);
    expect(count).toBe(1);

    otherCount = handlerCollection.registerHandler(otherKey, otherTestHandler);
    expect(handlerCollection.hasHandlers(otherKey)).toBe(true);
    expect(otherCount).toBe(1);

    count = handlerCollection.removeHandler(key, otherTestHandler);
    expect(handlerCollection.hasHandlers(key)).toBe(true);
    expect(count).toBe(1);

    otherCount = handlerCollection.removeHandler(otherKey, testHandler);
    expect(handlerCollection.hasHandlers(otherKey)).toBe(true);
    expect(otherCount).toBe(1);

    count = handlerCollection.removeHandler(key, testHandler);
    expect(handlerCollection.hasHandlers(key)).toBe(false);
    expect(count).toBe(0);

    otherCount = handlerCollection.removeHandler(otherKey, otherTestHandler);
    expect(handlerCollection.hasHandlers(otherKey)).toBe(false);
    expect(otherCount).toBe(0);

    expect(testHandler).toHaveBeenCalledTimes(0);
    expect(otherTestHandler).toHaveBeenCalledTimes(0);
  });

  it("removeAllHandlers", () => {
    count = handlerCollection.registerHandler(key, testHandler);
    count = handlerCollection.registerHandler(key, otherTestHandler);
    count = handlerCollection.registerHandler(key, jest.fn());
    count = handlerCollection.registerHandler(key, jest.fn());
    count = handlerCollection.registerHandler(key, jest.fn());

    expect(count).toBe(5);
    expect(handlerCollection.hasHandlers(key)).toBe(true);

    count = handlerCollection.removeAllHandlers(key);
    expect(count).toBe(0);
    expect(handlerCollection.hasHandlers(key)).toBe(false);

    expect(testHandler).toHaveBeenCalledTimes(0);
    expect(otherTestHandler).toHaveBeenCalledTimes(0);
  });

  it("triggerHandlers", async () => {
    const errorHandler = jest.fn();
    const otherErrorHandler = jest.fn();
    const args = ["arg1", "args2"];
    const otherArgs = ["other arg1"];
    const error = new Error("error");
    const otherError = new Error("other error");

    count = handlerCollection.registerHandler(key, testHandler);
    otherCount = handlerCollection.registerHandler(otherKey, otherTestHandler);

    await handlerCollection.triggerHandlers(key, args, errorHandler);
    expect(testHandler).toHaveBeenCalledTimes(1);
    expect(testHandler).toHaveBeenNthCalledWith(1, ...args);
    expect(errorHandler).toHaveBeenCalledTimes(0);
    expect(otherTestHandler).toHaveBeenCalledTimes(0);
    expect(otherErrorHandler).toHaveBeenCalledTimes(0);

    testHandler.mockClear();
    await handlerCollection.triggerHandlers(otherKey, otherArgs, otherErrorHandler);
    expect(testHandler).toHaveBeenCalledTimes(0);
    expect(otherTestHandler).toHaveBeenCalledTimes(1);
    expect(otherTestHandler).toHaveBeenNthCalledWith(1, ...otherArgs);
    expect(errorHandler).toHaveBeenCalledTimes(0);
    expect(otherErrorHandler).toHaveBeenCalledTimes(0);

    otherTestHandler.mockClear();
    testHandler.mockImplementationOnce(() => {
      throw error;
    });
    await handlerCollection.triggerHandlers(key, args, errorHandler);
    expect(testHandler).toHaveBeenCalledTimes(1);
    expect(testHandler).toHaveBeenNthCalledWith(1, ...args);
    expect(otherTestHandler).toHaveBeenCalledTimes(0);
    expect(errorHandler).toHaveBeenCalledTimes(1);
    expect(errorHandler).toHaveBeenNthCalledWith(1, error, key, testHandler);
    expect(otherErrorHandler).toHaveBeenCalledTimes(0);

    testHandler.mockClear();
    errorHandler.mockClear();
    otherTestHandler.mockImplementationOnce(() => {
      throw otherError;
    });
    await handlerCollection.triggerHandlers(otherKey, otherArgs, otherErrorHandler);
    expect(testHandler).toHaveBeenCalledTimes(0);
    expect(otherTestHandler).toHaveBeenCalledTimes(1);
    expect(otherTestHandler).toHaveBeenNthCalledWith(1, ...otherArgs);
    expect(errorHandler).toHaveBeenCalledTimes(0);
    expect(otherErrorHandler).toHaveBeenCalledTimes(1);
    expect(otherErrorHandler).toHaveBeenNthCalledWith(1, otherError, otherKey, otherTestHandler);
  });

  it("duplicate registerHandler/removeHandler/triggerHandlers", async () => {
    const args = ["arg1"];
    const errorHandler = jest.fn();
    const error = new Error("error");

    count = handlerCollection.registerHandler(key, testHandler);
    count = handlerCollection.registerHandler(key, otherTestHandler);
    count = handlerCollection.registerHandler(key, testHandler);
    expect(count).toBe(3);

    await handlerCollection.triggerHandlers(key, args, errorHandler);
    expect(testHandler).toHaveBeenCalledTimes(2);
    expect(testHandler).toHaveBeenNthCalledWith(1, ...args);
    expect(testHandler).toHaveBeenNthCalledWith(2, ...args);
    expect(otherTestHandler).toHaveBeenCalledTimes(1);
    expect(otherTestHandler).toHaveBeenNthCalledWith(1, ...args);
    expect(errorHandler).toHaveBeenCalledTimes(0);

    testHandler.mockClear();
    otherTestHandler.mockClear();
    testHandler.mockImplementationOnce(() => {
      throw error;
    });
    testHandler.mockImplementationOnce(() => {
      throw error;
    });
    await handlerCollection.triggerHandlers(key, args, errorHandler);
    expect(testHandler).toHaveBeenCalledTimes(2);
    expect(testHandler).toHaveBeenNthCalledWith(1, ...args);
    expect(testHandler).toHaveBeenNthCalledWith(2, ...args);
    expect(otherTestHandler).toHaveBeenCalledTimes(1);
    expect(otherTestHandler).toHaveBeenNthCalledWith(1, ...args);
    expect(errorHandler).toHaveBeenCalledTimes(2);
    expect(errorHandler).toHaveBeenNthCalledWith(1, error, key, testHandler);
    expect(errorHandler).toHaveBeenNthCalledWith(2, error, key, testHandler);

    count = handlerCollection.removeHandler(key, testHandler);
    expect(count).toBe(1);
  });
});
