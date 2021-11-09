"use strict";

const redis = require("redis");
const env = require("../../srv/util/env");
const redisWrapper = require("../../srv/util/redisWrapper");

const channel = "channel";
const channelTwo = "channelTwo";
const message = "message";
const mockMessageHandler = jest.fn();
const mockMessageHandlerTwo = jest.fn();
const mockMultiClient = {
  del: jest.fn(() => mockMultiClient),
  set: jest.fn(() => mockMultiClient),
  exec: jest.fn((callback) => callback(null, "multiexecreturn")),
};
const mockClient = {
  on: jest.fn(),
  get: jest.fn((key, callback) => callback(null, "getreturn")),
  set: jest.fn((key, value, callback) => callback(null, "setreturn")),
  watch: jest.fn((key, callback) => callback(null, "watchreturn")),
  publish: jest.fn(() => "publishreturn"),
  subscribe: jest.fn(),
  unsubscribe: jest.fn(),
  multi: jest.fn(() => mockMultiClient),
};

jest.mock("redis", () => ({
  createClient: jest.fn(() => mockClient),
}));

jest.mock("../../srv/util/env", () => ({
  isOnCF: false,
  cfServiceCredentials: jest.fn(),
}));

describe("redis wrapper test", () => {
  afterEach(() => {
    jest.clearAllMocks();
    redisWrapper._._reset();
  });

  it("_createClientBase shortcut", async () => {
    const shortcut = "shortcut";
    const client = redisWrapper._._createClientBase(shortcut);

    expect(redis.createClient).not.toHaveBeenCalled();
    expect(client).toBe(shortcut);
  });

  it("_createClientBase local", async () => {
    redisWrapper._._setRedisIsOnCF(false);
    const client = redisWrapper._._createClientBase();

    expect(redis.createClient).toHaveBeenCalledTimes(1);
    expect(redis.createClient).toHaveBeenCalledWith();
    expect(client).toBe(mockClient);
  });

  it("_createClientBase on CF", async () => {
    redisWrapper._._setRedisIsOnCF(true);
    const mockUrl = "rediss://BAD_USERNAME:pwd@mockUrl";
    const mockUrlUsable = mockUrl.replace("BAD_USERNAME", "");
    env.cfServiceCredentials.mockImplementationOnce(() => ({ uri: mockUrl }));

    const client = redisWrapper._._createClientBase();

    expect(env.cfServiceCredentials).toHaveBeenCalledTimes(1);
    expect(env.cfServiceCredentials).toHaveBeenCalledWith({ label: "redis-cache" });
    expect(redis.createClient).toHaveBeenCalledTimes(1);
    expect(redis.createClient).toHaveBeenCalledWith(mockUrlUsable, { no_ready_check: true });
    expect(client).toBe(mockClient);
  });

  it("_createClient", async () => {
    const client = redisWrapper._._createClient();
    expect(redis.createClient).toHaveBeenCalledTimes(1);
    expect(redisWrapper._._getClient()).toBe(client);
    expect(mockClient.on).toHaveBeenCalledTimes(1);
    expect(mockClient.on).toHaveBeenCalledWith("error", expect.any(Function));
    expect(mockClient.subscribe).not.toHaveBeenCalled();
    expect(mockClient.publish).not.toHaveBeenCalled();
  });

  it("_createSubscriber", async () => {
    const client = redisWrapper._._createSubscriber();
    expect(redis.createClient).toHaveBeenCalledTimes(1);
    expect(redisWrapper._._getSubscriberClient()).toBe(client);
    expect(mockClient.on).toHaveBeenCalledTimes(2);
    expect(mockClient.on).toHaveBeenNthCalledWith(1, "error", expect.any(Function));
    expect(mockClient.on).toHaveBeenNthCalledWith(2, "message", redisWrapper._._onMessage);
    expect(mockClient.subscribe).not.toHaveBeenCalled();
    expect(mockClient.publish).not.toHaveBeenCalled();
  });

  it("_clientExec", async () => {
    const result = await redisWrapper._._clientExec("setAsync", { key: "key", value: "value" });
    const client = redisWrapper._._getClient();
    expect(redis.createClient).toHaveBeenCalledTimes(1);
    expect(redis.createClient).toHaveReturnedWith(client);
    expect(client.on).toHaveBeenCalledTimes(1);
    expect(client.on).toHaveBeenCalledWith("error", expect.any(Function));
    expect(mockClient.set).toHaveBeenCalledTimes(1);
    expect(mockClient.set).toHaveBeenCalledWith("key", "value", expect.any(Function));
    expect(result).toBe("setreturn");
  });

  it("get key", async () => {
    const result = await redisWrapper.get("key");
    expect(mockClient.get).toHaveBeenCalledTimes(1);
    expect(mockClient.get).toHaveBeenCalledWith("key", expect.any(Function));
    expect(result).toBe("getreturn");
  });

  it("getObject key", async () => {
    const resultObj = { result: "result" };
    mockClient.get.mockImplementationOnce((key, callback) => callback(null, JSON.stringify(resultObj)));
    const result = await redisWrapper.getObject("key");
    expect(mockClient.get).toHaveBeenCalledTimes(1);
    expect(mockClient.get).toHaveBeenCalledWith("key", expect.any(Function));
    expect(result).toMatchObject(resultObj);
  });

  it("set key value", async () => {
    const result = await redisWrapper.set("key", "value");
    expect(mockClient.set).toHaveBeenCalledTimes(1);
    expect(mockClient.set).toHaveBeenCalledWith("key", "value", expect.any(Function));
    expect(result).toBe("setreturn");
  });

  it("setObject key value", async () => {
    const inputObj = { input: "input" };
    const result = await redisWrapper.setObject("key", inputObj);
    expect(mockClient.set).toHaveBeenCalledTimes(1);
    expect(mockClient.set).toHaveBeenCalledWith("key", JSON.stringify(inputObj), expect.any(Function));
    expect(result).toBe("setreturn");
  });

  it("watchedGetSet", async () => {
    const oldValue = "oldValue";
    mockClient.get.mockImplementationOnce((key, callback) => callback(null, oldValue));
    mockMultiClient.exec.mockImplementationOnce((callback) => callback(null, ["OK"]));
    const newValue = "newValue";
    const newValueCallback = jest.fn((oldValue) => newValue);
    const result = await redisWrapper.watchedGetSet("key", newValueCallback);

    expect(mockClient.watch).toHaveBeenCalledTimes(1);
    expect(mockClient.watch).toHaveBeenCalledWith("key", expect.any(Function));
    expect(mockClient.get).toHaveBeenCalledTimes(1);
    expect(mockClient.get).toHaveBeenCalledWith("key", expect.any(Function));
    expect(newValueCallback).toHaveBeenCalledTimes(1);
    expect(newValueCallback).toHaveBeenCalledWith(oldValue);
    expect(mockMultiClient.set).toHaveBeenCalledTimes(1);
    expect(mockMultiClient.set).toHaveBeenCalledWith("key", newValue);
    expect(mockMultiClient.exec).toHaveBeenCalledTimes(1);
    expect(mockMultiClient.exec).toHaveBeenCalledWith(expect.any(Function));
    expect(result).toBe(newValue);
  });

  it("watchedGetSetObject", async () => {
    const oldValue = { oldValue: "oldValue" };
    mockClient.get.mockImplementationOnce((key, callback) => callback(null, JSON.stringify(oldValue)));
    mockMultiClient.exec.mockImplementationOnce((callback) => callback(null, ["OK"]));
    const newValue = { newValue: "newValue" };
    const newValueCallback = jest.fn((oldValue) => newValue);
    const result = await redisWrapper.watchedGetSetObject("key", newValueCallback);

    expect(mockClient.watch).toHaveBeenCalledTimes(1);
    expect(mockClient.watch).toHaveBeenCalledWith("key", expect.any(Function));
    expect(mockClient.get).toHaveBeenCalledTimes(1);
    expect(mockClient.get).toHaveBeenCalledWith("key", expect.any(Function));
    expect(newValueCallback).toHaveBeenCalledTimes(1);
    expect(newValueCallback).toHaveBeenCalledWith(oldValue);
    expect(mockMultiClient.set).toHaveBeenCalledTimes(1);
    expect(mockMultiClient.set).toHaveBeenCalledWith("key", JSON.stringify(newValue));
    expect(mockMultiClient.exec).toHaveBeenCalledTimes(1);
    expect(mockMultiClient.exec).toHaveBeenCalledWith(expect.any(Function));
    expect(result).toBe(newValue);
  });

  it("watchedGetSetObject newValue = null", async () => {
    const oldValue = { oldValue: "oldValue" };
    mockClient.get.mockImplementationOnce((key, callback) => callback(null, JSON.stringify(oldValue)));
    mockMultiClient.exec.mockImplementationOnce((callback) => callback(null, [1]));
    const newValue = null;
    const newValueCallback = jest.fn((oldValue) => newValue);
    const result = await redisWrapper.watchedGetSetObject("key", newValueCallback);

    expect(mockClient.watch).toHaveBeenCalledTimes(1);
    expect(mockClient.watch).toHaveBeenCalledWith("key", expect.any(Function));
    expect(mockClient.get).toHaveBeenCalledTimes(1);
    expect(mockClient.get).toHaveBeenCalledWith("key", expect.any(Function));
    expect(newValueCallback).toHaveBeenCalledTimes(1);
    expect(newValueCallback).toHaveBeenCalledWith(oldValue);
    expect(mockMultiClient.del).toHaveBeenCalledTimes(1);
    expect(mockMultiClient.del).toHaveBeenCalledWith("key");
    expect(mockMultiClient.exec).toHaveBeenCalledTimes(1);
    expect(mockMultiClient.exec).toHaveBeenCalledWith(expect.any(Function));
    expect(result).toBe(newValue);
  });

  it("watchedGetSetObject oldValue = newValue", async () => {
    const oldValue = { oldValue: "oldValue" };
    mockClient.get.mockImplementationOnce((key, callback) => callback(null, JSON.stringify(oldValue)));
    const newValueCallback = jest.fn((oldValue) => oldValue);
    const result = await redisWrapper.watchedGetSetObject("key", newValueCallback);

    expect(mockClient.watch).toHaveBeenCalledTimes(1);
    expect(mockClient.watch).toHaveBeenCalledWith("key", expect.any(Function));
    expect(mockClient.get).toHaveBeenCalledTimes(1);
    expect(mockClient.get).toHaveBeenCalledWith("key", expect.any(Function));
    expect(newValueCallback).toHaveBeenCalledTimes(1);
    expect(newValueCallback).toHaveBeenCalledWith(oldValue);
    expect(mockMultiClient.set).not.toHaveBeenCalled();
    expect(mockMultiClient.del).not.toHaveBeenCalled();
    expect(mockMultiClient.exec).not.toHaveBeenCalled();
    expect(result).toMatchObject(oldValue);
  });

  it("watchedGetSetObject 2x attempts", async () => {
    const oldValue1 = { oldValue1: "oldValue" };
    const oldValue2 = { oldValue2: "oldValue" };
    mockClient.get.mockImplementationOnce((key, callback) => callback(null, JSON.stringify(oldValue1)));
    mockClient.get.mockImplementationOnce((key, callback) => callback(null, JSON.stringify(oldValue2)));
    mockMultiClient.exec.mockImplementationOnce((callback) => callback(null, null));
    mockMultiClient.exec.mockImplementationOnce((callback) => callback(null, ["OK"]));
    const newValue1 = { newValue1: "newValue" };
    const newValue2 = { newValue2: "newValue" };
    const newValueCallback = jest.fn();
    newValueCallback.mockImplementationOnce(() => newValue1);
    newValueCallback.mockImplementationOnce(() => newValue2);
    const result = await redisWrapper.watchedGetSetObject("key", newValueCallback);

    expect(mockClient.watch).toHaveBeenCalledTimes(2);
    expect(mockClient.watch).toHaveBeenNthCalledWith(1, "key", expect.any(Function));
    expect(mockClient.watch).toHaveBeenNthCalledWith(2, "key", expect.any(Function));
    expect(mockClient.get).toHaveBeenCalledTimes(2);
    expect(mockClient.get).toHaveBeenNthCalledWith(1, "key", expect.any(Function));
    expect(mockClient.get).toHaveBeenNthCalledWith(2, "key", expect.any(Function));
    expect(newValueCallback).toHaveBeenCalledTimes(2);
    expect(newValueCallback).toHaveBeenNthCalledWith(1, oldValue1);
    expect(newValueCallback).toHaveBeenNthCalledWith(2, oldValue2);
    expect(mockMultiClient.set).toHaveBeenCalledTimes(2);
    expect(mockMultiClient.set).toHaveBeenNthCalledWith(1, "key", JSON.stringify(newValue1));
    expect(mockMultiClient.set).toHaveBeenNthCalledWith(2, "key", JSON.stringify(newValue2));
    expect(mockMultiClient.exec).toHaveBeenCalledTimes(2);
    expect(mockMultiClient.exec).toHaveBeenNthCalledWith(1, expect.any(Function));
    expect(mockMultiClient.exec).toHaveBeenNthCalledWith(2, expect.any(Function));
    expect(result).toBe(newValue2);
  });

  it("publishMessage", async () => {
    const result = await redisWrapper.publishMessage(channel, message);
    expect(mockClient.publish).toHaveBeenCalledTimes(1);
    expect(mockClient.publish).toHaveBeenCalledWith(channel, message);
    expect(result).toBe("publishreturn");
  });

  it("registerMessageHandler", async () => {
    await redisWrapper.registerMessageHandler(channel, mockMessageHandler);
    const subscriber = redisWrapper._._getSubscriberClient();
    expect(redis.createClient).toHaveBeenCalledTimes(1);
    expect(redis.createClient).toHaveReturnedWith(subscriber);
    expect(subscriber.on).toHaveBeenCalledTimes(2);
    expect(subscriber.on).toHaveBeenNthCalledWith(1, "error", expect.any(Function));
    expect(subscriber.on).toHaveBeenNthCalledWith(2, "message", redisWrapper._._onMessage);
    expect(redisWrapper._._getMessageHandlers()).toStrictEqual({
      [channel]: [mockMessageHandler],
    });
    expect(subscriber.subscribe).toHaveBeenCalledTimes(1);
    expect(subscriber.subscribe).toHaveBeenCalledWith(channel);
    expect(mockClient.publish).not.toHaveBeenCalled();

    await redisWrapper.registerMessageHandler(channel, mockMessageHandlerTwo);
    expect(subscriber.subscribe).toHaveBeenCalledTimes(1);

    expect(redisWrapper._._getMessageHandlers()).toStrictEqual({
      [channel]: [mockMessageHandler, mockMessageHandlerTwo],
    });

    await redisWrapper._._onMessage(channel, message);
    expect(mockMessageHandler).toHaveBeenCalledTimes(1);
    expect(mockMessageHandler).toHaveBeenCalledWith(message);
    expect(mockMessageHandlerTwo).toHaveBeenCalledTimes(1);
    expect(mockMessageHandlerTwo).toHaveBeenCalledWith(message);
  });

  it("removeMessageHandler", async () => {
    await redisWrapper.registerMessageHandler(channel, mockMessageHandler);
    await redisWrapper.registerMessageHandler(channel, mockMessageHandlerTwo);
    await redisWrapper.registerMessageHandler(channelTwo, mockMessageHandlerTwo);
    const subscriber = redisWrapper._._getSubscriberClient();

    await redisWrapper.removeMessageHandler(channel, mockMessageHandler);
    expect(redisWrapper._._hasMessageHandlers(channel)).toBe(true);
    expect(redisWrapper._._getMessageHandlers()).toStrictEqual({
      [channel]: [mockMessageHandlerTwo],
      [channelTwo]: [mockMessageHandlerTwo],
    });
    expect(subscriber.unsubscribe).not.toHaveBeenCalled();

    await redisWrapper.removeMessageHandler(channel, mockMessageHandlerTwo);
    expect(redisWrapper._._hasMessageHandlers(channel)).toBe(false);
    expect(redisWrapper._._getMessageHandlers()).toStrictEqual({
      [channelTwo]: [mockMessageHandlerTwo],
    });
    expect(subscriber.unsubscribe).toHaveBeenCalledTimes(1);
    expect(subscriber.unsubscribe).toHaveBeenCalledWith(channel);
  });

  it("removeAllMessageHandlers", async () => {
    await redisWrapper.registerMessageHandler(channel, mockMessageHandler);
    await redisWrapper.registerMessageHandler(channel, mockMessageHandlerTwo);
    await redisWrapper.registerMessageHandler(channelTwo, mockMessageHandlerTwo);
    const subscriber = redisWrapper._._getSubscriberClient();

    await redisWrapper.removeAllMessageHandlers(channel);
    expect(redisWrapper._._getMessageHandlers()).toStrictEqual({
      [channelTwo]: [mockMessageHandlerTwo],
    });
    expect(subscriber.unsubscribe).toHaveBeenCalledTimes(1);
    expect(subscriber.unsubscribe).toHaveBeenCalledWith(channel);
  });
});
