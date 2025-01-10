"use strict";

const { CfEnv } = require("../src/shared/cf-env");
const envMock = CfEnv.getInstance();
jest.mock("../src/shared/cf-env", () => require("./__mocks__/cf-env"));

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

const redisAdapter = require("../src/redis-adapter");

const channel = "channel";
const channelTwo = "channelTwo";
const message = "message";

let loggerSpy = {
  info: jest.spyOn(redisAdapter._._getLogger(), "info"),
  error: jest.spyOn(redisAdapter._._getLogger(), "error"),
};

describe("redis-adapter test", () => {
  afterEach(() => {
    jest.clearAllMocks();
    redisAdapter._._reset();
    envMock._reset();
  });

  test("_createMainClientAndConnect/_createSubscriberClientAndConnect shortcut", async () => {
    const shortcutMain = "shortcutMain";
    const shortcutSubscriber = "shortcutSubscriber";
    redisAdapter._._setMainClient(shortcutMain);
    redisAdapter._._setSubscriberClient(shortcutSubscriber);
    const mainClient = await redisAdapter.getMainClient();
    const subscriberClient = await redisAdapter.getSubscriberClient();

    expect(redis.createClient).not.toHaveBeenCalled();
    expect(mainClient).toBe(shortcutMain);
    expect(subscriberClient).toBe(shortcutSubscriber);
    expect(loggerSpy.error).not.toHaveBeenCalled();
  });

  test("_createClientBase local", async () => {
    envMock.isOnCf = false;
    const client = redisAdapter._._createClientBase();

    expect(redis.createClient).toHaveBeenCalledTimes(1);
    expect(redis.createClient.mock.calls[0]).toMatchInlineSnapshot(`
      [
        {
          "socket": {
            "family": 4,
            "reconnectStrategy": [Function],
          },
          "url": "redis://localhost:6379",
        },
      ]
    `);
    expect(client).toBe(mockClient);
    expect(loggerSpy.error).not.toHaveBeenCalled();
  });

  test("_createClientBase on CF", async () => {
    const mockUrl = "rediss://BAD_USERNAME:pwd@mockUrl";
    const mockUrlUsable = mockUrl.replace("BAD_USERNAME", "");

    envMock.isOnCf = true;
    envMock.cfServiceCredentialsForLabel.mockReturnValueOnce({ uri: mockUrl });

    const client = redisAdapter._._createClientBase();

    expect(envMock.cfServiceCredentialsForLabel).toHaveBeenCalledTimes(1);
    expect(envMock.cfServiceCredentialsForLabel).toHaveBeenCalledWith("redis-cache");
    expect(redis.createClient).toHaveBeenCalledTimes(1);
    expect(redis.createClient).toHaveBeenCalledWith({ url: mockUrlUsable });
    expect(client).toBe(mockClient);
    expect(loggerSpy.error).not.toHaveBeenCalled();
  });

  test("getMainClient", async () => {
    const client = await redisAdapter.getMainClient();
    expect(redis.createClient).toHaveBeenCalledTimes(1);
    expect(client.connect).toHaveBeenCalledTimes(1);
    expect(redisAdapter._._getMainClient()).toBe(client);
    expect(mockClient.on).toHaveBeenCalledTimes(2);
    expect(mockClient.on).toHaveBeenCalledWith("error", expect.any(Function));
    expect(mockClient.on).toHaveBeenCalledWith("reconnecting", expect.any(Function));
    expect(mockClient.SUBSCRIBE).not.toHaveBeenCalled();
    expect(mockClient.PUBLISH).not.toHaveBeenCalled();
    expect(loggerSpy.error).not.toHaveBeenCalled();
  });

  test("getSubscriberClient", async () => {
    const client = await redisAdapter.getSubscriberClient();
    expect(redis.createClient).toHaveBeenCalledTimes(1);
    expect(redisAdapter._._getSubscriberClient()).toBe(client);
    expect(mockClient.on).toHaveBeenCalledTimes(2);
    expect(mockClient.on).toHaveBeenCalledWith("error", expect.any(Function));
    expect(mockClient.on).toHaveBeenCalledWith("reconnecting", expect.any(Function));
    expect(mockClient.SUBSCRIBE).not.toHaveBeenCalled();
    expect(mockClient.PUBLISH).not.toHaveBeenCalled();
    expect(loggerSpy.error).not.toHaveBeenCalled();
  });

  test("_clientExec", async () => {
    const result = await redisAdapter._._clientExec("SET", { key: "key", value: "value" });
    const client = redisAdapter._._getMainClient();
    expect(redis.createClient).toHaveBeenCalledTimes(1);
    expect(redis.createClient).toHaveReturnedWith(client);
    expect(client.on).toHaveBeenCalledTimes(2);
    expect(client.on).toHaveBeenCalledWith("error", expect.any(Function));
    expect(client.on).toHaveBeenCalledWith("reconnecting", expect.any(Function));
    expect(mockClient.SET).toHaveBeenCalledTimes(1);
    expect(mockClient.SET).toHaveBeenCalledWith("key", "value");
    expect(result).toBe("SET_return");
    expect(loggerSpy.error).not.toHaveBeenCalled();
  });

  test("type key", async () => {
    const result = await redisAdapter.type("key");
    expect(mockClient.TYPE).toHaveBeenCalledTimes(1);
    expect(mockClient.TYPE).toHaveBeenCalledWith("key");
    expect(result).toBe("TYPE_return");
    expect(loggerSpy.error).not.toHaveBeenCalled();
  });

  test("get key", async () => {
    const result = await redisAdapter.get("key");
    expect(mockClient.GET).toHaveBeenCalledTimes(1);
    expect(mockClient.GET).toHaveBeenCalledWith("key");
    expect(result).toBe("GET_return");
    expect(loggerSpy.error).not.toHaveBeenCalled();
  });

  test("getObject key", async () => {
    const resultObj = { result: "result" };
    mockClient.GET.mockImplementationOnce(async () => JSON.stringify(resultObj));
    const result = await redisAdapter.getObject("key");
    expect(mockClient.GET).toHaveBeenCalledTimes(1);
    expect(mockClient.GET).toHaveBeenCalledWith("key");
    expect(result).toMatchObject(resultObj);
    expect(loggerSpy.error).not.toHaveBeenCalled();
  });

  test("set key value", async () => {
    const result = await redisAdapter.set("key", "value");
    expect(mockClient.SET).toHaveBeenCalledTimes(1);
    expect(mockClient.SET).toHaveBeenCalledWith("key", "value");
    expect(result).toBe("SET_return");
    expect(loggerSpy.error).not.toHaveBeenCalled();
  });

  test("setObject key value", async () => {
    const inputObj = { input: "input" };
    const result = await redisAdapter.setObject("key", inputObj);
    expect(mockClient.SET).toHaveBeenCalledTimes(1);
    expect(mockClient.SET).toHaveBeenCalledWith("key", JSON.stringify(inputObj));
    expect(result).toBe("SET_return");
    expect(loggerSpy.error).not.toHaveBeenCalled();
  });

  test("del key", async () => {
    const result = await redisAdapter.del("key");
    expect(mockClient.DEL).toHaveBeenCalledTimes(1);
    expect(mockClient.DEL).toHaveBeenCalledWith("key");
    expect(result).toBe("DEL_return");
    expect(loggerSpy.error).not.toHaveBeenCalled();
  });

  test("watchedGetSet", async () => {
    const oldValue = "oldValue";
    mockClient.GET.mockImplementationOnce(async () => oldValue);
    mockMultiClient.EXEC.mockImplementationOnce(async () => ["OK"]);
    const newValue = "newValue";
    const newValueCallback = jest.fn(() => newValue);
    const result = await redisAdapter.watchedGetSet("key", newValueCallback);

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

  test("watchedGetSetObject", async () => {
    const oldValue = { oldValue: "oldValue" };
    mockClient.GET.mockImplementationOnce(async () => JSON.stringify(oldValue));
    mockMultiClient.EXEC.mockImplementationOnce(async () => ["OK"]);
    const newValue = { newValue: "newValue" };
    const newValueCallback = jest.fn(() => newValue);
    const result = await redisAdapter.watchedGetSetObject("key", newValueCallback);

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

  test("watchedGetSetObject newValue = null", async () => {
    const oldValue = { oldValue: "oldValue" };
    mockClient.GET.mockImplementationOnce(async () => JSON.stringify(oldValue));
    mockMultiClient.EXEC.mockImplementationOnce(async () => [1]);
    const newValue = null;
    const newValueCallback = jest.fn(() => newValue);
    const result = await redisAdapter.watchedGetSetObject("key", newValueCallback);

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

  test("watchedGetSetObject oldValue = newValue", async () => {
    const oldValue = { oldValue: "oldValue" };
    mockClient.GET.mockImplementationOnce(async () => JSON.stringify(oldValue));
    const newValueCallback = jest.fn((oldValue) => oldValue);
    const result = await redisAdapter.watchedGetSetObject("key", newValueCallback);

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

  test("watchedGetSetObject 2x attempts on exec null reply", async () => {
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
    const result = await redisAdapter.watchedGetSetObject("key", newValueCallback);

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

  test("watchedGetSetObject with exec keeps returning null", async () => {
    const newValue1 = { newValue1: "newValue" };
    const oldValue1 = { oldValue1: "oldValue" };
    mockClient.GET.mockImplementation(async () => JSON.stringify(oldValue1));
    mockMultiClient.EXEC.mockImplementation(async () => null);
    const newValueCallback = jest.fn(() => newValue1);
    await expect(redisAdapter.watchedGetSetObject("key", newValueCallback)).rejects.toMatchInlineSnapshot(
      `[RedisAdapterError: exceeded watched get set attempt limit]`
    );

    expect(mockClient.WATCH).toHaveBeenCalledTimes(10);
    expect(mockClient.WATCH).toHaveBeenNthCalledWith(10, "key");
    expect(mockClient.GET).toHaveBeenCalledTimes(10);
    expect(mockClient.GET).toHaveBeenNthCalledWith(10, "key");
    expect(newValueCallback).toHaveBeenCalledTimes(10);
    expect(newValueCallback).toHaveBeenNthCalledWith(10, oldValue1);
    expect(mockMultiClient.SET).toHaveBeenCalledTimes(10);
    expect(mockMultiClient.SET).toHaveBeenNthCalledWith(10, "key", JSON.stringify(newValue1));
    expect(mockMultiClient.EXEC).toHaveBeenCalledTimes(10);
    expect(mockMultiClient.EXEC).toHaveBeenNthCalledWith(10);
    expect(loggerSpy.error).not.toHaveBeenCalled();
    mockClient.GET.mockClear();
    mockMultiClient.EXEC.mockClear();
  });

  test("watchedGetSetObject 2x attempts on exec throw", async () => {
    const oldValue1 = { oldValue1: "oldValue" };
    const oldValue2 = { oldValue2: "oldValue" };
    mockClient.GET.mockImplementationOnce(async () => JSON.stringify(oldValue1));
    mockClient.GET.mockImplementationOnce(async () => JSON.stringify(oldValue2));
    mockMultiClient.EXEC.mockImplementationOnce(async () => {
      throw new Error("fail");
    });
    mockMultiClient.EXEC.mockImplementationOnce(async () => ["OK"]);
    const newValue1 = { newValue1: "newValue" };
    const newValue2 = { newValue2: "newValue" };
    const newValueCallback = jest.fn();
    newValueCallback.mockImplementationOnce(() => newValue1);
    newValueCallback.mockImplementationOnce(() => newValue2);
    const result = await redisAdapter.watchedGetSetObject("key", newValueCallback);

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

  test("watchedGetSetObject with exec keeps throwing", async () => {
    const newValue1 = { newValue1: "newValue" };
    const oldValue1 = { oldValue1: "oldValue" };
    mockClient.GET.mockImplementation(async () => JSON.stringify(oldValue1));
    mockMultiClient.EXEC.mockRejectedValue(new Error("fail"));
    const newValueCallback = jest.fn(() => newValue1);
    await expect(redisAdapter.watchedGetSetObject("key", newValueCallback)).rejects.toMatchInlineSnapshot(
      `[RedisAdapterError: error during watched get set: fail]`
    );

    expect(mockClient.WATCH).toHaveBeenCalledTimes(10);
    expect(mockClient.WATCH).toHaveBeenNthCalledWith(10, "key");
    expect(mockClient.GET).toHaveBeenCalledTimes(10);
    expect(mockClient.GET).toHaveBeenNthCalledWith(10, "key");
    expect(newValueCallback).toHaveBeenCalledTimes(10);
    expect(newValueCallback).toHaveBeenNthCalledWith(10, oldValue1);
    expect(mockMultiClient.SET).toHaveBeenCalledTimes(10);
    expect(mockMultiClient.SET).toHaveBeenNthCalledWith(10, "key", JSON.stringify(newValue1));
    expect(mockMultiClient.EXEC).toHaveBeenCalledTimes(10);
    expect(mockMultiClient.EXEC).toHaveBeenNthCalledWith(10);
    expect(loggerSpy.error).not.toHaveBeenCalled();
    mockClient.GET.mockClear();
    mockMultiClient.EXEC.mockClear();
  });

  test("watchedHashGetSetObject", async () => {
    const oldValue = { oldValue: "oldValue" };
    mockClient.HGET.mockImplementationOnce(async () => JSON.stringify(oldValue));
    mockMultiClient.EXEC.mockImplementationOnce(async () => [1]);
    const newValue = { newValue: "newValue" };
    const newValueCallback = jest.fn(() => newValue);
    const result = await redisAdapter.watchedHashGetSetObject("key", "field", newValueCallback);

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

  test("publishMessage", async () => {
    const result = await redisAdapter.publishMessage(channel, message);
    expect(mockClient.PUBLISH).toHaveBeenCalledTimes(1);
    expect(mockClient.PUBLISH).toHaveBeenCalledWith(channel, message);
    expect(result).toBe("PUBLISH_return");
    expect(loggerSpy.error).not.toHaveBeenCalled();
  });

  test("_subscribedMessageHandler error", async () => {
    const mockUrl = "rediss://BAD_USERNAME:pwd@mockUrl";

    envMock.isOnCf = true;
    envMock.cfServiceCredentialsForLabel.mockReturnValueOnce({ uri: mockUrl });

    redisAdapter.registerMessageHandler(channel, mockMessageHandler);
    redisAdapter.registerMessageHandler(channel, mockMessageHandlerTwo);
    await redisAdapter.subscribe(channel);

    const error = new Error("bad");
    mockMessageHandlerTwo.mockRejectedValue(error);
    await redisAdapter._._subscribedMessageHandler(message, channel);

    expect(loggerSpy.error).toHaveBeenCalledTimes(1);
    expect(loggerSpy.error).toHaveBeenCalledWith(
      expect.objectContaining({
        jse_cause: error,
      })
    );
  });

  test("registerMessageHandler and subscribe", async () => {
    redisAdapter.registerMessageHandler(channel, mockMessageHandler);
    await redisAdapter.subscribe(channel);

    const subscriber = redisAdapter._._getSubscriberClient();
    expect(redis.createClient).toHaveBeenCalledTimes(1);
    expect(redis.createClient).toHaveReturnedWith(subscriber);
    expect(subscriber.on).toHaveBeenCalledTimes(2);
    expect(subscriber.on).toHaveBeenCalledWith("error", expect.any(Function));
    expect(subscriber.on).toHaveBeenCalledWith("reconnecting", expect.any(Function));
    expect(subscriber.SUBSCRIBE).toHaveBeenCalledTimes(1);
    expect(subscriber.SUBSCRIBE).toHaveBeenCalledWith(channel, redisAdapter._._subscribedMessageHandler);
    expect(mockClient.PUBLISH).not.toHaveBeenCalled();

    redisAdapter.registerMessageHandler(channel, mockMessageHandlerTwo);

    await redisAdapter._._subscribedMessageHandler(message, channel);
    expect(mockMessageHandler).toHaveBeenCalledTimes(1);
    expect(mockMessageHandler).toHaveBeenCalledWith(message);
    expect(mockMessageHandlerTwo).toHaveBeenCalledTimes(1);
    expect(mockMessageHandlerTwo).toHaveBeenCalledWith(message);
    expect(loggerSpy.error).not.toHaveBeenCalled();
  });

  test("removeMessageHandler and unsubscribe", async () => {
    redisAdapter._._getMessageHandlers().removeAllHandlers(channel);
    redisAdapter.registerMessageHandler(channel, mockMessageHandler);
    redisAdapter.registerMessageHandler(channel, mockMessageHandlerTwo);
    redisAdapter.registerMessageHandler(channelTwo, mockMessageHandlerTwo);

    redisAdapter.removeMessageHandler(channel, mockMessageHandler);
    redisAdapter.removeMessageHandler(channel, mockMessageHandlerTwo);
    await redisAdapter.unsubscribe(channel);
    const subscriber = redisAdapter._._getSubscriberClient();
    await redisAdapter._._subscribedMessageHandler(message, channel);

    expect(subscriber.UNSUBSCRIBE).toHaveBeenCalledTimes(1);
    expect(subscriber.UNSUBSCRIBE).toHaveBeenCalledWith(channel);
    expect(mockMessageHandler).not.toHaveBeenCalled();
    expect(mockMessageHandlerTwo).not.toHaveBeenCalled();

    expect(loggerSpy.error).not.toHaveBeenCalled();
  });

  test("removeAllMessageHandlers", async () => {
    redisAdapter._._getMessageHandlers().removeAllHandlers(channel);
    redisAdapter.registerMessageHandler(channel, mockMessageHandler);
    redisAdapter.registerMessageHandler(channel, mockMessageHandlerTwo);
    redisAdapter.registerMessageHandler(channelTwo, mockMessageHandlerTwo);

    redisAdapter.removeAllMessageHandlers(channel);
    await redisAdapter.unsubscribe(channel);
    const subscriber = redisAdapter._._getSubscriberClient();
    await redisAdapter._._subscribedMessageHandler(message, channel);

    expect(subscriber.UNSUBSCRIBE).toHaveBeenCalledTimes(1);
    expect(subscriber.UNSUBSCRIBE).toHaveBeenCalledWith(channel);
    expect(mockMessageHandler).not.toHaveBeenCalled();
    expect(mockMessageHandlerTwo).not.toHaveBeenCalled();
    expect(loggerSpy.error).not.toHaveBeenCalled();
  });
});
