/**
 * TODO overview jsdoc
 */
"use strict";

const redis = require("redis");
const VError = require("verror");
const { Logger } = require("./logger");
const { HandlerCollection } = require("./handlerCollection");
const { isOnCF, cfServiceCredentials } = require("./env");

const COMPONENT_NAME = "/RedisWrapper";
const VERROR_CLUSTER_NAME = "RedisWrapperError";
const logger = Logger(COMPONENT_NAME);

const MODE = Object.freeze({
  RAW: "raw",
  OBJECT: "object",
});

let redisIsOnCF = isOnCF;
let mainClient = null;
let subscriberClient = null;
let messageHandlers = new HandlerCollection();

const _reset = () => {
  redisIsOnCF = isOnCF;
  mainClient = null;
  subscriberClient = null;
  messageHandlers = new HandlerCollection();
};

const _logErrorOnEvent = (err, ...messages) =>
  redisIsOnCF
    ? logger.error(
        messages.length
          ? new VError({ name: VERROR_CLUSTER_NAME, cause: err }, ...messages)
          : new VError({ name: VERROR_CLUSTER_NAME, cause: err })
      )
    : logger.warning("error caught during event: %s", err.message);

const _subscribedMessageHandler = async (message, channel) => {
  const handlers = messageHandlers.getHandlers(channel);
  return handlers.length === 0
    ? null
    : await Promise.all(
        handlers.map(async (handler) => {
          try {
            return await handler(message);
          } catch (err) {
            _logErrorOnEvent(err, "error during message handler %O", {
              handler: handler.name || "anonymous",
              channel,
            });
          }
        })
      );
};

/**
 * Lazily create a new redis client. Client creation transparently handles both the Cloud Foundry "redis-cache" service
 * (hyperscaler option) and a local redis-server.
 *
 * @returns {RedisClient}
 * @private
 */
const _createClientBase = () => {
  if (redisIsOnCF) {
    try {
      const credentials = cfServiceCredentials({ label: "redis-cache" });
      // NOTE: settings the user explicitly to empty resolves auth problems, see
      // https://github.com/go-redis/redis/issues/1343
      const url = credentials.uri.replace(/(?<=rediss:\/\/)[\w-]+?(?=:)/, "");
      return redis.createClient({ url });
    } catch (err) {
      throw new VError(
        { name: VERROR_CLUSTER_NAME, cause: err },
        "error during create client with redis-cache service"
      );
    }
  } else {
    return redis.createClient();
  }
};

const _createClientAndConnect = async (errorHandler) => {
  let client = null;
  try {
    client = _createClientBase();
  } catch (err) {
    throw new VError({ name: VERROR_CLUSTER_NAME, cause: err }, "error during create client");
  }

  client.on("error", errorHandler);

  try {
    await client.connect();
  } catch (err) {
    throw new VError({ name: VERROR_CLUSTER_NAME, cause: err }, "error during initial connect");
  }
  return client;
};

/**
 * Lazily create a regular client to be used
 * - for getting/setting values
 * - as message publisher
 *
 * Only one publisher is necessary for any number of channels.
 *
 * @returns {RedisClient}
 * @private
 */
const _createMainClientAndConnect = async () => {
  if (!mainClient) {
    const mainClientErrorHandler = async (err) => {
      _logErrorOnEvent(err, "error event on main redis client");
      if (mainClient) {
        let quitError = null;
        try {
          await mainClient.quit();
        } catch (err) {
          quitError = err;
        }
        mainClient = null;
        if (quitError) {
          throw new VError({ name: VERROR_CLUSTER_NAME, cause: err }, "error during quit");
        }
      }
    };
    mainClient = await _createClientAndConnect(mainClientErrorHandler);
  }
  return mainClient;
};

/**
 * Lazily create a client to be used as a subscriber. Subscriber clients are in a special state and cannot be used for
 * other commands.
 *
 * Only one subscriber is necessary for any number of channels.
 *
 * @returns {RedisClient}
 * @private
 */
const _createSubscriberAndConnect = async () => {
  if (!subscriberClient) {
    const subscriberClientErrorHandler = async (err) => {
      _logErrorOnEvent(err, "error event on subscriber redis client");
      if (subscriberClient) {
        let quitError = null;
        try {
          await subscriberClient.quit();
        } catch (err) {
          quitError = err;
        }
        subscriberClient = null;
        if (quitError) {
          throw new VError({ name: VERROR_CLUSTER_NAME, cause: err }, "error during quit");
        }
      }
    };
    subscriberClient = await _createClientAndConnect(subscriberClientErrorHandler);
  }
  return subscriberClient;
};

const _clientExec = async (functionName, argsObject) => {
  if (!mainClient) {
    mainClient = await _createMainClientAndConnect();
  }

  try {
    return await mainClient[functionName](...Object.values(argsObject));
  } catch (err) {
    throw new VError(
      { name: VERROR_CLUSTER_NAME, cause: err, info: { functionName, ...argsObject } },
      "error during redis client %s",
      functionName
    );
  }
};

/**
 * Asynchronously get the value for a given key.
 *
 * @param key
 * @returns {Promise<string|null>}
 */
const get = async (key) => _clientExec("get", { key });

/**
 * Asynchronously get the value for a given key and parse it into an object.
 *
 * @param key
 * @returns {Promise<*>}
 */
const getObject = async (key) => {
  const result = await get(key);
  return result === null ? null : JSON.parse(result);
};

/**
 * Asynchronously set the value for a given key.
 *
 * @param key
 * @param value
 * @returns {Promise<*>}
 */
const set = async (key, value) => _clientExec("set", { key, value });

/**
 * Asynchronously set a stringified object as value for a given key.
 *
 * @param key
 * @param value
 * @returns {Promise<*>}
 */
const setObject = async (key, value) => {
  const valueRaw = JSON.stringify(value);
  return set(key, valueRaw);
};

const _watchedGetSet = async (key, newValueCallback, mode = MODE.OBJECT, attempts = 10) => {
  if (!mainClient) {
    mainClient = await _createMainClientAndConnect();
  }

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await mainClient.watch(key);

      const oldValueRaw = await mainClient.get(key);
      const oldValue = mode === MODE.RAW ? oldValueRaw : oldValueRaw === null ? null : JSON.parse(oldValueRaw);
      const newValue = await newValueCallback(oldValue);
      const newValueRaw = mode === MODE.RAW ? newValue : newValue === null ? null : JSON.stringify(newValue);

      if (oldValueRaw === newValueRaw) {
        return oldValue;
      }

      const doDelete = newValueRaw === null;
      const clientMulti = mainClient.multi();
      if (doDelete) {
        clientMulti.del(key);
      } else {
        clientMulti.set(key, newValueRaw);
      }
      const replies = await clientMulti.exec();
      if (replies !== null) {
        if (!Array.isArray(replies) || replies.length !== 1 || replies[0] !== (doDelete ? 1 : "OK")) {
          throw new VError(
            { name: VERROR_CLUSTER_NAME, info: { key, attempt, attempts, replies } },
            "received unexpected replies from redis"
          );
        }
        return newValue;
      }
    } catch (err) {
      throw new VError({ name: VERROR_CLUSTER_NAME, cause: err, info: { key } }, "error during watched get set");
    }
  }
  throw new VError({ name: VERROR_CLUSTER_NAME, info: { key, attempts } }, "reached watched get set attempt limit");
};

/**
 * Asynchronously get and then set new value for a given key. The key is optimistically locked, meaning if someone else
 * updates the key concurrently, we lose one attempt and try again until the attempt limit is reached. For subsequent
 * tries, newValueCallback is called each time with the then current old value.
 *
 * Both old and new value are expected to be shallow javascript objects or null. If the key is unknown to redis, the old
 * value passed into newValueCallback is null. If the new value is null, this results in the key being deleted.
 *
 * This function will throw when one of the client instructions fail or when the attempt limit is reached.
 *
 * @param key               key to watch and modify
 * @param newValueCallback  asynchronous callback to compute new value for key, gets old value as input
 * @param attempts          number of attempts to modify key with optimistic locking
 * @returns {Promise<*>}    promise for the new value that was set
 */
const watchedGetSet = async (key, newValueCallback, attempts = 10) =>
  _watchedGetSet(key, newValueCallback, MODE.RAW, attempts);

/**
 * See {@link watchedGetSet}. Difference here is that it does an implicit JSON.parse/JSON.stringify before getting and
 * setting.
 *
 * @param key               key to watch and modify
 * @param newValueCallback  asynchronous callback to compute new value for key, gets old value as input
 * @param attempts          number of attempts to modify key with optimistic locking
 * @returns {Promise<*>}    promise for the new value that was set
 */
const watchedGetSetObject = async (key, newValueCallback, attempts = 10) =>
  _watchedGetSet(key, newValueCallback, MODE.OBJECT, attempts);

/**
 * Asynchronously publish a given message on a given channel. This will lazily create the necessary publisher client.
 * Errors will be re-thrown.
 *
 * @param channel to publish the message on
 * @param message to publish
 * @returns {Promise<void>}
 */
const publishMessage = async (channel, message) => _clientExec("publish", { channel, message });

/**
 * Subscribe to a given channel. New messages will be processed on all registered message handlers for that channel.
 * This will lazily create the necessary subscriber client. Errors happening during channel subscribe will be thrown
 * and event errors will be logged.
 *
 * @param channel whose messages should be processed
 */
const subscribe = async (channel) => {
  if (!subscriberClient) {
    subscriberClient = await _createSubscriberAndConnect();
  }
  try {
    await subscriberClient.subscribe(channel, _subscribedMessageHandler);
  } catch (err) {
    throw new VError({ name: VERROR_CLUSTER_NAME, cause: err }, "error during subscribe");
  }
};

/**
 * Unsubscribe from a given channel. Errors happening during channel unsubscribe will be thrown and event errors will
 * be logged.
 *
 * @param channel whose messages should no longer be processed
 */
const unsubscribe = async (channel) => {
  if (!subscriberClient) {
    subscriberClient = await _createSubscriberAndConnect();
  }
  try {
    await subscriberClient.unsubscribe(channel);
  } catch (err) {
    throw new VError({ name: VERROR_CLUSTER_NAME, cause: err }, "error during unsubscribe");
  }
};

/**
 * Register a given handler for messages of a given channel. This will lazily create the necessary subscriber client.
 * Errors happening during channel subscribe will be thrown and event errors will be logged.
 *
 * @param channel whose messages should be processed
 * @param handler to process messages
 */
const registerMessageHandler = (channel, handler) => messageHandlers.registerHandler(channel, handler);

/**
 * Stop a given handler from processing messages of a given subscribed channel.
 *
 * @param channel whose messages should not be processed
 * @param handler to remove
 */
const removeMessageHandler = (channel, handler) => messageHandlers.removeHandler(channel, handler);

/**
 * Stop all handlers from processing messages of a given subscribed channel.
 *
 * @param channel whose messages should not be processed
 */
const removeAllMessageHandlers = (channel) => messageHandlers.removeAllHandlers(channel);

module.exports = {
  get,
  getObject,
  set,
  setObject,
  watchedGetSet,
  watchedGetSetObject,
  publishMessage,
  subscribe,
  unsubscribe,
  registerMessageHandler,
  removeMessageHandler,
  removeAllMessageHandlers,

  _: {
    _reset,
    _getMessageHandlers: () => messageHandlers,
    _getLogger: () => logger,
    _setRedisIsOnCF: (value) => (redisIsOnCF = value),
    _getMainClient: () => mainClient,
    _setMainClient: (value) => (mainClient = value),
    _getSubscriberClient: () => subscriberClient,
    _setSubscriberClient: (value) => (subscriberClient = value),
    _subscribedMessageHandler,
    _createClientBase,
    _createClientAndConnect,
    _createMainClientAndConnect,
    _createSubscriberAndConnect,
    _clientExec,
  },
};
