"use strict";

const redisWrapper = require("../src/redisWrapper");

const channel = "channel";
const channelTwo = "channelTwo";
const message = "message";
const mockMessageHandler = jest.fn();
const mockMessageHandlerTwo = jest.fn();
const mockMultiClient = {
  del: jest.fn(() => mockMultiClient),
  set: jest.fn(() => mockMultiClient),
  exec: jest.fn(async () => "multiexecreturn"),
};
const mockClient = {
  on: jest.fn(),
  get: jest.fn(async () => "getreturn"),
  set: jest.fn(async () => "setreturn"),
  watch: jest.fn(async () => "watchreturn"),
  publish: jest.fn(async () => "publishreturn"),
  connect: jest.fn(async () => "connectreturn"),
  subscribe: jest.fn(),
  unsubscribe: jest.fn(),
  multi: jest.fn(() => mockMultiClient),
};

const redis = require("redis");
jest.mock("redis", () => ({
  createClient: jest.fn(() => mockClient),
}));

const env = require("../src/env");
jest.mock("../src/env", () => ({
  isOnCF: false,
  cfServiceCredentials: jest.fn(),
}));

let loggerSpy = {
  info: jest.spyOn(redisWrapper._._getLogger(), "info"),
  error: jest.spyOn(redisWrapper._._getLogger(), "error"),
};

describe("redis wrapper test", () => {
  afterEach(() => {
    jest.clearAllMocks();
    redisWrapper._._reset();
  });

  it("_createMainClientAndConnect/_createSubscriberClientAndConnect shortcut", async () => {
    const shortcutMain = "shortcutMain";
    const shortcutSubscriber = "shortcutSubscriber";
    redisWrapper._._setMainClient(shortcutMain);
    redisWrapper._._setSubscriberClient(shortcutSubscriber);
    const mainClient = await redisWrapper._._createMainClientAndConnect();
    const subscriberClient = await redisWrapper._._createSubscriberAndConnect();

    expect(redis.createClient).not.toHaveBeenCalled();
    expect(mainClient).toBe(shortcutMain);
    expect(subscriberClient).toBe(shortcutSubscriber);
    expect(loggerSpy.error).not.toHaveBeenCalled();
  });

  it("_createClientBase local", async () => {
    redisWrapper._._setRedisIsOnCF(false);
    const client = redisWrapper._._createClientBase();

    expect(redis.createClient).toHaveBeenCalledTimes(1);
    expect(redis.createClient).toHaveBeenCalledWith({
      socket: { reconnectStrategy: redisWrapper._._localReconnectStrategy },
    });
    expect(client).toBe(mockClient);
    expect(loggerSpy.error).not.toHaveBeenCalled();
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
    expect(redis.createClient).toHaveBeenCalledWith({ url: mockUrlUsable });
    expect(client).toBe(mockClient);
    expect(loggerSpy.error).not.toHaveBeenCalled();
  });

  it("_createMainClientAndConnect", async () => {
    const client = await redisWrapper._._createMainClientAndConnect();
    expect(redis.createClient).toHaveBeenCalledTimes(1);
    expect(client.connect).toHaveBeenCalledTimes(1);
    expect(redisWrapper._._getMainClient()).toBe(client);
    expect(mockClient.on).toHaveBeenCalledTimes(1);
    expect(mockClient.on).toHaveBeenCalledWith("error", expect.any(Function));
    expect(mockClient.subscribe).not.toHaveBeenCalled();
    expect(mockClient.publish).not.toHaveBeenCalled();
    expect(loggerSpy.error).not.toHaveBeenCalled();
  });

  it("_createSubscriberAndConnect", async () => {
    const client = await redisWrapper._._createSubscriberAndConnect();
    expect(redis.createClient).toHaveBeenCalledTimes(1);
    expect(redisWrapper._._getSubscriberClient()).toBe(client);
    expect(mockClient.on).toHaveBeenCalledTimes(1);
    expect(mockClient.on).toHaveBeenCalledWith("error", expect.any(Function));
    expect(mockClient.subscribe).not.toHaveBeenCalled();
    expect(mockClient.publish).not.toHaveBeenCalled();
    expect(loggerSpy.error).not.toHaveBeenCalled();
  });

  it("_clientExec", async () => {
    const result = await redisWrapper._._clientExec("set", { key: "key", value: "value" });
    const client = redisWrapper._._getMainClient();
    expect(redis.createClient).toHaveBeenCalledTimes(1);
    expect(redis.createClient).toHaveReturnedWith(client);
    expect(client.on).toHaveBeenCalledTimes(1);
    expect(client.on).toHaveBeenCalledWith("error", expect.any(Function));
    expect(mockClient.set).toHaveBeenCalledTimes(1);
    expect(mockClient.set).toHaveBeenCalledWith("key", "value");
    expect(result).toBe("setreturn");
    expect(loggerSpy.error).not.toHaveBeenCalled();
  });

  it("get key", async () => {
    const result = await redisWrapper.get("key");
    expect(mockClient.get).toHaveBeenCalledTimes(1);
    expect(mockClient.get).toHaveBeenCalledWith("key");
    expect(result).toBe("getreturn");
    expect(loggerSpy.error).not.toHaveBeenCalled();
  });

  it("getObject key", async () => {
    const resultObj = { result: "result" };
    mockClient.get.mockImplementationOnce(async () => JSON.stringify(resultObj));
    const result = await redisWrapper.getObject("key");
    expect(mockClient.get).toHaveBeenCalledTimes(1);
    expect(mockClient.get).toHaveBeenCalledWith("key");
    expect(result).toMatchObject(resultObj);
    expect(loggerSpy.error).not.toHaveBeenCalled();
  });

  it("set key value", async () => {
    const result = await redisWrapper.set("key", "value");
    expect(mockClient.set).toHaveBeenCalledTimes(1);
    expect(mockClient.set).toHaveBeenCalledWith("key", "value");
    expect(result).toBe("setreturn");
    expect(loggerSpy.error).not.toHaveBeenCalled();
  });

  it("setObject key value", async () => {
    const inputObj = { input: "input" };
    const result = await redisWrapper.setObject("key", inputObj);
    expect(mockClient.set).toHaveBeenCalledTimes(1);
    expect(mockClient.set).toHaveBeenCalledWith("key", JSON.stringify(inputObj));
    expect(result).toBe("setreturn");
    expect(loggerSpy.error).not.toHaveBeenCalled();
  });

  it("watchedGetSet", async () => {
    const oldValue = "oldValue";
    mockClient.get.mockImplementationOnce(async () => oldValue);
    mockMultiClient.exec.mockImplementationOnce(async () => ["OK"]);
    const newValue = "newValue";
    const newValueCallback = jest.fn(() => newValue);
    const result = await redisWrapper.watchedGetSet("key", newValueCallback);

    expect(mockClient.watch).toHaveBeenCalledTimes(1);
    expect(mockClient.watch).toHaveBeenCalledWith("key");
    expect(mockClient.get).toHaveBeenCalledTimes(1);
    expect(mockClient.get).toHaveBeenCalledWith("key");
    expect(newValueCallback).toHaveBeenCalledTimes(1);
    expect(newValueCallback).toHaveBeenCalledWith(oldValue);
    expect(mockMultiClient.set).toHaveBeenCalledTimes(1);
    expect(mockMultiClient.set).toHaveBeenCalledWith("key", newValue);
    expect(mockMultiClient.exec).toHaveBeenCalledTimes(1);
    expect(mockMultiClient.exec).toHaveBeenCalledWith();
    expect(result).toBe(newValue);
    expect(loggerSpy.error).not.toHaveBeenCalled();
  });

  it("watchedGetSetObject", async () => {
    const oldValue = { oldValue: "oldValue" };
    mockClient.get.mockImplementationOnce(async () => JSON.stringify(oldValue));
    mockMultiClient.exec.mockImplementationOnce(async () => ["OK"]);
    const newValue = { newValue: "newValue" };
    const newValueCallback = jest.fn(() => newValue);
    const result = await redisWrapper.watchedGetSetObject("key", newValueCallback);

    expect(mockClient.watch).toHaveBeenCalledTimes(1);
    expect(mockClient.watch).toHaveBeenCalledWith("key");
    expect(mockClient.get).toHaveBeenCalledTimes(1);
    expect(mockClient.get).toHaveBeenCalledWith("key");
    expect(newValueCallback).toHaveBeenCalledTimes(1);
    expect(newValueCallback).toHaveBeenCalledWith(oldValue);
    expect(mockMultiClient.set).toHaveBeenCalledTimes(1);
    expect(mockMultiClient.set).toHaveBeenCalledWith("key", JSON.stringify(newValue));
    expect(mockMultiClient.exec).toHaveBeenCalledTimes(1);
    expect(mockMultiClient.exec).toHaveBeenCalledWith();
    expect(result).toBe(newValue);
    expect(loggerSpy.error).not.toHaveBeenCalled();
  });

  it("watchedGetSetObject newValue = null", async () => {
    const oldValue = { oldValue: "oldValue" };
    mockClient.get.mockImplementationOnce(async () => JSON.stringify(oldValue));
    mockMultiClient.exec.mockImplementationOnce(async () => [1]);
    const newValue = null;
    const newValueCallback = jest.fn(() => newValue);
    const result = await redisWrapper.watchedGetSetObject("key", newValueCallback);

    expect(mockClient.watch).toHaveBeenCalledTimes(1);
    expect(mockClient.watch).toHaveBeenCalledWith("key");
    expect(mockClient.get).toHaveBeenCalledTimes(1);
    expect(mockClient.get).toHaveBeenCalledWith("key");
    expect(newValueCallback).toHaveBeenCalledTimes(1);
    expect(newValueCallback).toHaveBeenCalledWith(oldValue);
    expect(mockMultiClient.del).toHaveBeenCalledTimes(1);
    expect(mockMultiClient.del).toHaveBeenCalledWith("key");
    expect(mockMultiClient.exec).toHaveBeenCalledTimes(1);
    expect(mockMultiClient.exec).toHaveBeenCalledWith();
    expect(result).toBe(newValue);
    expect(loggerSpy.error).not.toHaveBeenCalled();
  });

  it("watchedGetSetObject oldValue = newValue", async () => {
    const oldValue = { oldValue: "oldValue" };
    mockClient.get.mockImplementationOnce(async () => JSON.stringify(oldValue));
    const newValueCallback = jest.fn((oldValue) => oldValue);
    const result = await redisWrapper.watchedGetSetObject("key", newValueCallback);

    expect(mockClient.watch).toHaveBeenCalledTimes(1);
    expect(mockClient.watch).toHaveBeenCalledWith("key");
    expect(mockClient.get).toHaveBeenCalledTimes(1);
    expect(mockClient.get).toHaveBeenCalledWith("key");
    expect(newValueCallback).toHaveBeenCalledTimes(1);
    expect(newValueCallback).toHaveBeenCalledWith(oldValue);
    expect(mockMultiClient.set).not.toHaveBeenCalled();
    expect(mockMultiClient.del).not.toHaveBeenCalled();
    expect(mockMultiClient.exec).not.toHaveBeenCalled();
    expect(result).toMatchObject(oldValue);
    expect(loggerSpy.error).not.toHaveBeenCalled();
  });

  it("watchedGetSetObject 2x attempts", async () => {
    const oldValue1 = { oldValue1: "oldValue" };
    const oldValue2 = { oldValue2: "oldValue" };
    mockClient.get.mockImplementationOnce(async () => JSON.stringify(oldValue1));
    mockClient.get.mockImplementationOnce(async () => JSON.stringify(oldValue2));
    mockMultiClient.exec.mockImplementationOnce(async () => null);
    mockMultiClient.exec.mockImplementationOnce(async () => ["OK"]);
    const newValue1 = { newValue1: "newValue" };
    const newValue2 = { newValue2: "newValue" };
    const newValueCallback = jest.fn();
    newValueCallback.mockImplementationOnce(() => newValue1);
    newValueCallback.mockImplementationOnce(() => newValue2);
    const result = await redisWrapper.watchedGetSetObject("key", newValueCallback);

    expect(mockClient.watch).toHaveBeenCalledTimes(2);
    expect(mockClient.watch).toHaveBeenNthCalledWith(1, "key");
    expect(mockClient.watch).toHaveBeenNthCalledWith(2, "key");
    expect(mockClient.get).toHaveBeenCalledTimes(2);
    expect(mockClient.get).toHaveBeenNthCalledWith(1, "key");
    expect(mockClient.get).toHaveBeenNthCalledWith(2, "key");
    expect(newValueCallback).toHaveBeenCalledTimes(2);
    expect(newValueCallback).toHaveBeenNthCalledWith(1, oldValue1);
    expect(newValueCallback).toHaveBeenNthCalledWith(2, oldValue2);
    expect(mockMultiClient.set).toHaveBeenCalledTimes(2);
    expect(mockMultiClient.set).toHaveBeenNthCalledWith(1, "key", JSON.stringify(newValue1));
    expect(mockMultiClient.set).toHaveBeenNthCalledWith(2, "key", JSON.stringify(newValue2));
    expect(mockMultiClient.exec).toHaveBeenCalledTimes(2);
    expect(mockMultiClient.exec).toHaveBeenNthCalledWith(1);
    expect(mockMultiClient.exec).toHaveBeenNthCalledWith(2);
    expect(result).toBe(newValue2);
    expect(loggerSpy.error).not.toHaveBeenCalled();
  });

  it("publishMessage", async () => {
    const result = await redisWrapper.publishMessage(channel, message);
    expect(mockClient.publish).toHaveBeenCalledTimes(1);
    expect(mockClient.publish).toHaveBeenCalledWith(channel, message);
    expect(result).toBe("publishreturn");
    expect(loggerSpy.error).not.toHaveBeenCalled();
  });

  it("_subscribedMessageHandler error", async () => {
    redisWrapper._._setRedisIsOnCF(true);
    const mockUrl = "rediss://BAD_USERNAME:pwd@mockUrl";
    env.cfServiceCredentials.mockImplementationOnce(() => ({ uri: mockUrl }));
    redisWrapper.registerMessageHandler(channel, mockMessageHandler);
    redisWrapper.registerMessageHandler(channel, mockMessageHandlerTwo);
    await redisWrapper.subscribe(channel);

    const error = new Error("bad");
    mockMessageHandlerTwo.mockRejectedValue(error);
    await redisWrapper._._subscribedMessageHandler(message, channel);

    expect(loggerSpy.error).toHaveBeenCalledTimes(1);
    expect(loggerSpy.error).toHaveBeenCalledWith(
      expect.objectContaining({
        jse_cause: error,
      })
    );
  });

  it("registerMessageHandler and subscribe", async () => {
    redisWrapper.registerMessageHandler(channel, mockMessageHandler);
    await redisWrapper.subscribe(channel);

    const subscriber = redisWrapper._._getSubscriberClient();
    expect(redis.createClient).toHaveBeenCalledTimes(1);
    expect(redis.createClient).toHaveReturnedWith(subscriber);
    expect(subscriber.on).toHaveBeenCalledTimes(1);
    expect(subscriber.on).toHaveBeenCalledWith("error", expect.any(Function));
    expect(subscriber.subscribe).toHaveBeenCalledTimes(1);
    expect(subscriber.subscribe).toHaveBeenCalledWith(channel, redisWrapper._._subscribedMessageHandler);
    expect(mockClient.publish).not.toHaveBeenCalled();

    redisWrapper.registerMessageHandler(channel, mockMessageHandlerTwo);

    await redisWrapper._._subscribedMessageHandler(message, channel);
    expect(mockMessageHandler).toHaveBeenCalledTimes(1);
    expect(mockMessageHandler).toHaveBeenCalledWith(message);
    expect(mockMessageHandlerTwo).toHaveBeenCalledTimes(1);
    expect(mockMessageHandlerTwo).toHaveBeenCalledWith(message);
    expect(loggerSpy.error).not.toHaveBeenCalled();
  });

  it("removeMessageHandler and unsubscribe", async () => {
    redisWrapper._._getMessageHandlers().removeAllHandlers(channel);
    redisWrapper.registerMessageHandler(channel, mockMessageHandler);
    redisWrapper.registerMessageHandler(channel, mockMessageHandlerTwo);
    redisWrapper.registerMessageHandler(channelTwo, mockMessageHandlerTwo);

    redisWrapper.removeMessageHandler(channel, mockMessageHandler);
    redisWrapper.removeMessageHandler(channel, mockMessageHandlerTwo);
    await redisWrapper.unsubscribe(channel);
    const subscriber = redisWrapper._._getSubscriberClient();
    await redisWrapper._._subscribedMessageHandler(message, channel);

    expect(subscriber.unsubscribe).toHaveBeenCalledTimes(1);
    expect(subscriber.unsubscribe).toHaveBeenCalledWith(channel);
    expect(mockMessageHandler).not.toHaveBeenCalled();
    expect(mockMessageHandlerTwo).not.toHaveBeenCalled();

    expect(loggerSpy.error).not.toHaveBeenCalled();
  });

  it("removeAllMessageHandlers", async () => {
    redisWrapper._._getMessageHandlers().removeAllHandlers(channel);
    redisWrapper.registerMessageHandler(channel, mockMessageHandler);
    redisWrapper.registerMessageHandler(channel, mockMessageHandlerTwo);
    redisWrapper.registerMessageHandler(channelTwo, mockMessageHandlerTwo);

    redisWrapper.removeAllMessageHandlers(channel);
    await redisWrapper.unsubscribe(channel);
    const subscriber = redisWrapper._._getSubscriberClient();
    await redisWrapper._._subscribedMessageHandler(message, channel);

    expect(subscriber.unsubscribe).toHaveBeenCalledTimes(1);
    expect(subscriber.unsubscribe).toHaveBeenCalledWith(channel);
    expect(mockMessageHandler).not.toHaveBeenCalled();
    expect(mockMessageHandlerTwo).not.toHaveBeenCalled();
    expect(loggerSpy.error).not.toHaveBeenCalled();
  });
});
