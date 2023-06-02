"use strict";

const mockCfEnv = {
  cfServiceCredentialsForLabel: jest.fn(),
};
jest.mock("../src/env", () => ({
  isOnCF: false,
  cfEnv: mockCfEnv,
}));

const mockMessageHandler = jest.fn();
const mockMessageHandlerTwo = jest.fn();
const mockMultiClient = {
  DEL: jest.fn(),
  SET: jest.fn(),
  HDEL: jest.fn(),
  HSET: jest.fn(),
  EXEC: jest.fn(),
};
const mockClient = {
  on: jest.fn(),
  connect: jest.fn(),
  TYPE: jest.fn(async () => "TYPE_return"),
  GET: jest.fn(async () => "GET_return"),
  SET: jest.fn(async () => "SET_return"),
  DEL: jest.fn(async () => "DEL_return"),
  HGET: jest.fn(async () => "HGET_return"),
  WATCH: jest.fn(async () => "WATCH_return"),
  PUBLISH: jest.fn(async () => "PUBLISH_return"),
  SUBSCRIBE: jest.fn(),
  UNSUBSCRIBE: jest.fn(),
  MULTI: jest.fn(() => mockMultiClient),
};

const redis = require("redis");
jest.mock("redis", () => ({
  createClient: jest.fn(() => mockClient),
}));

const redisWrapper = require("../src/redisWrapper");

const channel = "channel";
const channelTwo = "channelTwo";
const message = "message";

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
    const mainClient = await redisWrapper.getMainClient();
    const subscriberClient = await redisWrapper.getSubscriberClient();

    expect(redis.createClient).not.toHaveBeenCalled();
    expect(mainClient).toBe(shortcutMain);
    expect(subscriberClient).toBe(shortcutSubscriber);
    expect(loggerSpy.error).not.toHaveBeenCalled();
  });

  it("_createClientBase local", async () => {
    redisWrapper._._setRedisIsOnCF(false);
    const client = redisWrapper._._createClientBase();

    expect(redis.createClient).toHaveBeenCalledTimes(1);
    expect(redis.createClient.mock.calls[0]).toMatchInlineSnapshot(`
      [
        {
          "socket": {
            "host": "127.0.0.1",
            "reconnectStrategy": [Function],
          },
        },
      ]
    `);
    expect(client).toBe(mockClient);
    expect(loggerSpy.error).not.toHaveBeenCalled();
  });

  it("_createClientBase on CF", async () => {
    redisWrapper._._setRedisIsOnCF(true);
    const mockUrl = "rediss://BAD_USERNAME:pwd@mockUrl";
    const mockUrlUsable = mockUrl.replace("BAD_USERNAME", "");
    mockCfEnv.cfServiceCredentialsForLabel.mockImplementationOnce(() => ({ uri: mockUrl }));

    const client = redisWrapper._._createClientBase();

    expect(mockCfEnv.cfServiceCredentialsForLabel).toHaveBeenCalledTimes(1);
    expect(mockCfEnv.cfServiceCredentialsForLabel).toHaveBeenCalledWith("redis-cache");
    expect(redis.createClient).toHaveBeenCalledTimes(1);
    expect(redis.createClient).toHaveBeenCalledWith({ url: mockUrlUsable });
    expect(client).toBe(mockClient);
    expect(loggerSpy.error).not.toHaveBeenCalled();
  });

  it("getMainClient", async () => {
    const client = await redisWrapper.getMainClient();
    expect(redis.createClient).toHaveBeenCalledTimes(1);
    expect(client.connect).toHaveBeenCalledTimes(1);
    expect(redisWrapper._._getMainClient()).toBe(client);
    expect(mockClient.on).toHaveBeenCalledTimes(1);
    expect(mockClient.on).toHaveBeenCalledWith("error", expect.any(Function));
    expect(mockClient.SUBSCRIBE).not.toHaveBeenCalled();
    expect(mockClient.PUBLISH).not.toHaveBeenCalled();
    expect(loggerSpy.error).not.toHaveBeenCalled();
  });

  it("getSubscriberClient", async () => {
    const client = await redisWrapper.getSubscriberClient();
    expect(redis.createClient).toHaveBeenCalledTimes(1);
    expect(redisWrapper._._getSubscriberClient()).toBe(client);
    expect(mockClient.on).toHaveBeenCalledTimes(1);
    expect(mockClient.on).toHaveBeenCalledWith("error", expect.any(Function));
    expect(mockClient.SUBSCRIBE).not.toHaveBeenCalled();
    expect(mockClient.PUBLISH).not.toHaveBeenCalled();
    expect(loggerSpy.error).not.toHaveBeenCalled();
  });

  it("_clientExec", async () => {
    const result = await redisWrapper._._clientExec("SET", { key: "key", value: "value" });
    const client = redisWrapper._._getMainClient();
    expect(redis.createClient).toHaveBeenCalledTimes(1);
    expect(redis.createClient).toHaveReturnedWith(client);
    expect(client.on).toHaveBeenCalledTimes(1);
    expect(client.on).toHaveBeenCalledWith("error", expect.any(Function));
    expect(mockClient.SET).toHaveBeenCalledTimes(1);
    expect(mockClient.SET).toHaveBeenCalledWith("key", "value");
    expect(result).toBe("SET_return");
    expect(loggerSpy.error).not.toHaveBeenCalled();
  });

  it("type key", async () => {
    const result = await redisWrapper.type("key");
    expect(mockClient.TYPE).toHaveBeenCalledTimes(1);
    expect(mockClient.TYPE).toHaveBeenCalledWith("key");
    expect(result).toBe("TYPE_return");
    expect(loggerSpy.error).not.toHaveBeenCalled();
  });

  it("get key", async () => {
    const result = await redisWrapper.get("key");
    expect(mockClient.GET).toHaveBeenCalledTimes(1);
    expect(mockClient.GET).toHaveBeenCalledWith("key");
    expect(result).toBe("GET_return");
    expect(loggerSpy.error).not.toHaveBeenCalled();
  });

  it("getObject key", async () => {
    const resultObj = { result: "result" };
    mockClient.GET.mockImplementationOnce(async () => JSON.stringify(resultObj));
    const result = await redisWrapper.getObject("key");
    expect(mockClient.GET).toHaveBeenCalledTimes(1);
    expect(mockClient.GET).toHaveBeenCalledWith("key");
    expect(result).toMatchObject(resultObj);
    expect(loggerSpy.error).not.toHaveBeenCalled();
  });

  it("set key value", async () => {
    const result = await redisWrapper.set("key", "value");
    expect(mockClient.SET).toHaveBeenCalledTimes(1);
    expect(mockClient.SET).toHaveBeenCalledWith("key", "value");
    expect(result).toBe("SET_return");
    expect(loggerSpy.error).not.toHaveBeenCalled();
  });

  it("setObject key value", async () => {
    const inputObj = { input: "input" };
    const result = await redisWrapper.setObject("key", inputObj);
    expect(mockClient.SET).toHaveBeenCalledTimes(1);
    expect(mockClient.SET).toHaveBeenCalledWith("key", JSON.stringify(inputObj));
    expect(result).toBe("SET_return");
    expect(loggerSpy.error).not.toHaveBeenCalled();
  });

  it("del key", async () => {
    const result = await redisWrapper.del("key");
    expect(mockClient.DEL).toHaveBeenCalledTimes(1);
    expect(mockClient.DEL).toHaveBeenCalledWith("key");
    expect(result).toBe("DEL_return");
    expect(loggerSpy.error).not.toHaveBeenCalled();
  });

  it("watchedGetSet", async () => {
    const oldValue = "oldValue";
    mockClient.GET.mockImplementationOnce(async () => oldValue);
    mockMultiClient.EXEC.mockImplementationOnce(async () => ["OK"]);
    const newValue = "newValue";
    const newValueCallback = jest.fn(() => newValue);
    const result = await redisWrapper.watchedGetSet("key", newValueCallback);

    expect(mockClient.WATCH).toHaveBeenCalledTimes(1);
    expect(mockClient.WATCH).toHaveBeenCalledWith("key");
    expect(mockClient.GET).toHaveBeenCalledTimes(1);
    expect(mockClient.GET).toHaveBeenCalledWith("key");
    expect(newValueCallback).toHaveBeenCalledTimes(1);
    expect(newValueCallback).toHaveBeenCalledWith(oldValue);
    expect(mockMultiClient.SET).toHaveBeenCalledTimes(1);
    expect(mockMultiClient.SET).toHaveBeenCalledWith("key", newValue);
    expect(mockMultiClient.EXEC).toHaveBeenCalledTimes(1);
    expect(mockMultiClient.EXEC).toHaveBeenCalledWith();
    expect(result).toBe(newValue);
    expect(loggerSpy.error).not.toHaveBeenCalled();
  });

  it("watchedGetSetObject", async () => {
    const oldValue = { oldValue: "oldValue" };
    mockClient.GET.mockImplementationOnce(async () => JSON.stringify(oldValue));
    mockMultiClient.EXEC.mockImplementationOnce(async () => ["OK"]);
    const newValue = { newValue: "newValue" };
    const newValueCallback = jest.fn(() => newValue);
    const result = await redisWrapper.watchedGetSetObject("key", newValueCallback);

    expect(mockClient.WATCH).toHaveBeenCalledTimes(1);
    expect(mockClient.WATCH).toHaveBeenCalledWith("key");
    expect(mockClient.GET).toHaveBeenCalledTimes(1);
    expect(mockClient.GET).toHaveBeenCalledWith("key");
    expect(newValueCallback).toHaveBeenCalledTimes(1);
    expect(newValueCallback).toHaveBeenCalledWith(oldValue);
    expect(mockMultiClient.SET).toHaveBeenCalledTimes(1);
    expect(mockMultiClient.SET).toHaveBeenCalledWith("key", JSON.stringify(newValue));
    expect(mockMultiClient.EXEC).toHaveBeenCalledTimes(1);
    expect(mockMultiClient.EXEC).toHaveBeenCalledWith();
    expect(result).toBe(newValue);
    expect(loggerSpy.error).not.toHaveBeenCalled();
  });

  it("watchedGetSetObject newValue = null", async () => {
    const oldValue = { oldValue: "oldValue" };
    mockClient.GET.mockImplementationOnce(async () => JSON.stringify(oldValue));
    mockMultiClient.EXEC.mockImplementationOnce(async () => [1]);
    const newValue = null;
    const newValueCallback = jest.fn(() => newValue);
    const result = await redisWrapper.watchedGetSetObject("key", newValueCallback);

    expect(mockClient.WATCH).toHaveBeenCalledTimes(1);
    expect(mockClient.WATCH).toHaveBeenCalledWith("key");
    expect(mockClient.GET).toHaveBeenCalledTimes(1);
    expect(mockClient.GET).toHaveBeenCalledWith("key");
    expect(newValueCallback).toHaveBeenCalledTimes(1);
    expect(newValueCallback).toHaveBeenCalledWith(oldValue);
    expect(mockMultiClient.DEL).toHaveBeenCalledTimes(1);
    expect(mockMultiClient.DEL).toHaveBeenCalledWith("key");
    expect(mockMultiClient.EXEC).toHaveBeenCalledTimes(1);
    expect(mockMultiClient.EXEC).toHaveBeenCalledWith();
    expect(result).toBe(newValue);
    expect(loggerSpy.error).not.toHaveBeenCalled();
  });

  it("watchedGetSetObject oldValue = newValue", async () => {
    const oldValue = { oldValue: "oldValue" };
    mockClient.GET.mockImplementationOnce(async () => JSON.stringify(oldValue));
    const newValueCallback = jest.fn((oldValue) => oldValue);
    const result = await redisWrapper.watchedGetSetObject("key", newValueCallback);

    expect(mockClient.WATCH).toHaveBeenCalledTimes(1);
    expect(mockClient.WATCH).toHaveBeenCalledWith("key");
    expect(mockClient.GET).toHaveBeenCalledTimes(1);
    expect(mockClient.GET).toHaveBeenCalledWith("key");
    expect(newValueCallback).toHaveBeenCalledTimes(1);
    expect(newValueCallback).toHaveBeenCalledWith(oldValue);
    expect(mockMultiClient.SET).not.toHaveBeenCalled();
    expect(mockMultiClient.DEL).not.toHaveBeenCalled();
    expect(mockMultiClient.EXEC).not.toHaveBeenCalled();
    expect(result).toMatchObject(oldValue);
    expect(loggerSpy.error).not.toHaveBeenCalled();
  });

  it("watchedGetSetObject 2x attempts", async () => {
    const oldValue1 = { oldValue1: "oldValue" };
    const oldValue2 = { oldValue2: "oldValue" };
    mockClient.GET.mockImplementationOnce(async () => JSON.stringify(oldValue1));
    mockClient.GET.mockImplementationOnce(async () => JSON.stringify(oldValue2));
    mockMultiClient.EXEC.mockImplementationOnce(async () => null);
    mockMultiClient.EXEC.mockImplementationOnce(async () => ["OK"]);
    const newValue1 = { newValue1: "newValue" };
    const newValue2 = { newValue2: "newValue" };
    const newValueCallback = jest.fn();
    newValueCallback.mockImplementationOnce(() => newValue1);
    newValueCallback.mockImplementationOnce(() => newValue2);
    const result = await redisWrapper.watchedGetSetObject("key", newValueCallback);

    expect(mockClient.WATCH).toHaveBeenCalledTimes(2);
    expect(mockClient.WATCH).toHaveBeenNthCalledWith(1, "key");
    expect(mockClient.WATCH).toHaveBeenNthCalledWith(2, "key");
    expect(mockClient.GET).toHaveBeenCalledTimes(2);
    expect(mockClient.GET).toHaveBeenNthCalledWith(1, "key");
    expect(mockClient.GET).toHaveBeenNthCalledWith(2, "key");
    expect(newValueCallback).toHaveBeenCalledTimes(2);
    expect(newValueCallback).toHaveBeenNthCalledWith(1, oldValue1);
    expect(newValueCallback).toHaveBeenNthCalledWith(2, oldValue2);
    expect(mockMultiClient.SET).toHaveBeenCalledTimes(2);
    expect(mockMultiClient.SET).toHaveBeenNthCalledWith(1, "key", JSON.stringify(newValue1));
    expect(mockMultiClient.SET).toHaveBeenNthCalledWith(2, "key", JSON.stringify(newValue2));
    expect(mockMultiClient.EXEC).toHaveBeenCalledTimes(2);
    expect(mockMultiClient.EXEC).toHaveBeenNthCalledWith(1);
    expect(mockMultiClient.EXEC).toHaveBeenNthCalledWith(2);
    expect(result).toBe(newValue2);
    expect(loggerSpy.error).not.toHaveBeenCalled();
  });

  it("watchedHashGetSetObject", async () => {
    const oldValue = { oldValue: "oldValue" };
    mockClient.HGET.mockImplementationOnce(async () => JSON.stringify(oldValue));
    mockMultiClient.EXEC.mockImplementationOnce(async () => [1]);
    const newValue = { newValue: "newValue" };
    const newValueCallback = jest.fn(() => newValue);
    const result = await redisWrapper.watchedHashGetSetObject("key", "field", newValueCallback);

    expect(mockClient.WATCH).toHaveBeenCalledTimes(1);
    expect(mockClient.WATCH).toHaveBeenCalledWith("key");
    expect(mockClient.HGET).toHaveBeenCalledTimes(1);
    expect(mockClient.HGET).toHaveBeenCalledWith("key", "field");
    expect(newValueCallback).toHaveBeenCalledTimes(1);
    expect(newValueCallback).toHaveBeenCalledWith(oldValue);
    expect(mockMultiClient.HSET).toHaveBeenCalledTimes(1);
    expect(mockMultiClient.HSET).toHaveBeenCalledWith("key", "field", JSON.stringify(newValue));
    expect(mockMultiClient.EXEC).toHaveBeenCalledTimes(1);
    expect(mockMultiClient.EXEC).toHaveBeenCalledWith();
    expect(result).toBe(newValue);
    expect(loggerSpy.error).not.toHaveBeenCalled();
  });

  it("publishMessage", async () => {
    const result = await redisWrapper.publishMessage(channel, message);
    expect(mockClient.PUBLISH).toHaveBeenCalledTimes(1);
    expect(mockClient.PUBLISH).toHaveBeenCalledWith(channel, message);
    expect(result).toBe("PUBLISH_return");
    expect(loggerSpy.error).not.toHaveBeenCalled();
  });

  it("_subscribedMessageHandler error", async () => {
    redisWrapper._._setRedisIsOnCF(true);
    const mockUrl = "rediss://BAD_USERNAME:pwd@mockUrl";
    mockCfEnv.cfServiceCredentialsForLabel.mockImplementationOnce(() => ({ uri: mockUrl }));
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
    expect(subscriber.SUBSCRIBE).toHaveBeenCalledTimes(1);
    expect(subscriber.SUBSCRIBE).toHaveBeenCalledWith(channel, redisWrapper._._subscribedMessageHandler);
    expect(mockClient.PUBLISH).not.toHaveBeenCalled();

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

    expect(subscriber.UNSUBSCRIBE).toHaveBeenCalledTimes(1);
    expect(subscriber.UNSUBSCRIBE).toHaveBeenCalledWith(channel);
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

    expect(subscriber.UNSUBSCRIBE).toHaveBeenCalledTimes(1);
    expect(subscriber.UNSUBSCRIBE).toHaveBeenCalledWith(channel);
    expect(mockMessageHandler).not.toHaveBeenCalled();
    expect(mockMessageHandlerTwo).not.toHaveBeenCalled();
    expect(loggerSpy.error).not.toHaveBeenCalled();
  });
});
