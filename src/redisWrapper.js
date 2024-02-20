/**
 * TODO overview jsdoc
 */
"use strict";

const redis = require("redis");
const VError = require("verror");
const { Logger } = require("./logger");
const cfEnv = require("./env");
const { HandlerCollection } = require("./shared/handlerCollection");
const { Semaphore } = require("./shared/semaphore");

const COMPONENT_NAME = "/RedisWrapper";
const VERROR_CLUSTER_NAME = "RedisWrapperError";

const INTEGRATION_MODE = Object.freeze({
  CF_REDIS_CLUSTER: "CF_REDIS_CLUSTER",
  CF_REDIS: "CF_REDIS",
  LOCAL_REDIS: "LOCAL_REDIS",
  NO_REDIS: "NO_REDIS",
});
const CF_REDIS_SERVICE_LABEL = "redis-cache";

const logger = new Logger(COMPONENT_NAME);

const MODE = Object.freeze({
  RAW: "raw",
  OBJECT: "object",
});

let messageHandlers;
let mainClient;
let subscriberClient;
let integrationMode;
const _reset = () => {
  messageHandlers = new HandlerCollection();
  mainClient = null;
  subscriberClient = null;
  integrationMode = null;
};
_reset();

const _logErrorOnEvent = (err) =>
  cfEnv.isOnCf ? logger.error(err) : logger.warning("%s | %O", err.message, VError.info(err));

const _subscribedMessageHandler = async (message, channel) => {
  const handlers = messageHandlers.getHandlers(channel);
  return handlers.length === 0
    ? null
    : await Promise.all(
        handlers.map(async (handler) => {
          try {
            return await handler(message);
          } catch (err) {
            _logErrorOnEvent(
              new VError(
                {
                  name: VERROR_CLUSTER_NAME,
                  cause: err,
                  info: {
                    handler: handler.name || "anonymous",
                    channel,
                  },
                },
                "error during message handler"
              )
            );
          }
        })
      );
};

const _localReconnectStrategy = () =>
  new VError({ name: VERROR_CLUSTER_NAME }, "disabled reconnect, because we are not running on cloud foundry");

/**
 * Lazily create a new redis client. Client creation transparently handles both the Cloud Foundry "redis-cache" service
 * (hyperscaler option) and a local redis-server.
 *
 * @returns {RedisClient|RedisCluster}
 * @private
 */
const _createClientBase = () => {
  if (cfEnv.isOnCf) {
    try {
      // NOTE: settings the user explicitly to empty resolves auth problems, see
      // https://github.com/go-redis/redis/issues/1343
      const redisCredentials = cfEnv.cfServiceCredentialsForLabel(CF_REDIS_SERVICE_LABEL);
      const redisIsCluster = redisCredentials.cluster_mode;
      const url = redisCredentials.uri.replace(/(?<=rediss:\/\/)[\w-]+?(?=:)/, "");
      if (redisIsCluster) {
        return redis.createCluster({
          rootNodes: [{ url }],
          // https://github.com/redis/node-redis/issues/1782
          defaults: {
            password: redisCredentials.password,
            socket: { tls: redisCredentials.tls },
          },
        });
      }
      return redis.createClient({ url });
    } catch (err) {
      throw new VError({ name: VERROR_CLUSTER_NAME, cause: err }, "error during create client with redis service");
    }
  } else {
    // NOTE: documentation is buried here https://github.com/redis/node-redis/blob/master/docs/client-configuration.md
    // NOTE: we make the host explicit here to avoid ipv4/ipv6 ambivalence problems that got introduced with node v18
    return redis.createClient({ socket: { host: "127.0.0.1", reconnectStrategy: _localReconnectStrategy } });
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

const _closeClientBase = async (client) => {
  if (client?.isOpen) {
    await client.quit();
  }
};

const _clientErrorHandlerBase = async (client, err, clientName) => {
  _logErrorOnEvent(new VError({ name: VERROR_CLUSTER_NAME, cause: err, info: { clientName } }, "caught error event"));
  try {
    await _closeClientBase(client);
  } catch (closeError) {
    _logErrorOnEvent(
      new VError({ name: VERROR_CLUSTER_NAME, cause: closeError, info: { clientName } }, "error during client close")
    );
  }
};

/**
 * Lazily create a regular client to be used
 * - for getting/setting values
 * - as message publisher
 *
 * Only one publisher is necessary for any number of channels.
 *
 * @returns {RedisClient|RedisCluster}
 * @private
 */
const getMainClient = async () => {
  if (!mainClient) {
    mainClient = await _createClientAndConnect(async function (err) {
      mainClient = null;
      await _clientErrorHandlerBase(this, err, "main");
    });
  }
  return mainClient;
};

/**
 * Closes the main Redis client if it is open.
 *
 * @private
 */
const closeMainClient = async () => await _closeClientBase(mainClient);

/**
 * Lazily create a client to be used as a subscriber. Subscriber clients are in a special state and cannot be used for
 * other commands.
 *
 * Only one subscriber is necessary for any number of channels.
 *
 * @returns {RedisClient|RedisCluster}
 * @private
 */
const getSubscriberClient = async () => {
  if (!subscriberClient) {
    subscriberClient = await _createClientAndConnect(async function (err) {
      subscriberClient = null;
      await _clientErrorHandlerBase(this, err, "subscriber");
    });
  }
  return subscriberClient;
};

/**
 * Closes the subscriber Redis client if it is open.
 *
 * @private
 */
const closeSubscriberClient = async () => await _closeClientBase(subscriberClient);

const _clientExec = async (functionName, argsObject) => {
  if (!mainClient) {
    mainClient = await getMainClient();
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
 * Asynchronously sends a command to redis.
 *
 * @param {Array<string>} command
 * @returns {Promise<any>}
 */
const sendCommand = async (command) => {
  // NOTE: _clientExec would not work here, because its error logging does not allow for args with array fields
  if (!mainClient) {
    mainClient = await getMainClient();
  }

  try {
    const redisIsCluster = cfEnv.cfServiceCredentialsForLabel(CF_REDIS_SERVICE_LABEL).cluster_mode;
    if (redisIsCluster) {
      // NOTE: the cluster sendCommand API has a different signature, where it takes two optional args: firstKey and
      //   isReadonly before the command
      return await mainClient.sendCommand(undefined, undefined, command);
    }
    return await mainClient.sendCommand(command);
  } catch (err) {
    throw new VError(
      { name: VERROR_CLUSTER_NAME, cause: err, info: { command: JSON.stringify(command) } },
      "error during redis client sendCommand"
    );
  }
};

/**
 * Asynchronously get the type for a given key.
 *
 * @param key
 * @returns {Promise<string|null>}
 */
const type = async (key) => await _clientExec("TYPE", { key });

/**
 * Asynchronously get the value for a given key.
 *
 * @param key
 * @returns {Promise<string|null>}
 */
const get = async (key) => await _clientExec("GET", { key });

/**
 * Asynchronously get the value for a given key and parse it into an object.
 *
 * @param key
 * @returns {Promise<object|null>}
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
 * @param options
 * @returns {Promise<string|number>}
 */
const set = async (key, value, options) => await _clientExec("SET", { key, value, ...(options && { options }) });

/**
 * Asynchronously set a stringified object as value for a given key.
 *
 * @param key
 * @param value
 * @param options
 * @returns {Promise<object|null>}
 */
const setObject = async (key, value, options) => {
  const valueRaw = JSON.stringify(value);
  return set(key, valueRaw, options);
};

/**
 * Asynchronously delete a given key.
 *
 * @param key
 * @returns {Promise<number>}
 */
const del = async (key) => await _clientExec("DEL", { key });

const _watchedGetSet = async (key, newValueCallback, { field, mode = MODE.OBJECT, attempts = 10 } = {}) => {
  const useHash = field !== undefined;
  if (!mainClient) {
    mainClient = await getMainClient();
  }

  let lastAttemptError = null;
  let badReplyError = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await mainClient.WATCH(key);

      const oldValueRaw = useHash ? await mainClient.HGET(key, field) : await mainClient.GET(key);
      const oldValue = mode === MODE.RAW ? oldValueRaw : oldValueRaw === null ? null : JSON.parse(oldValueRaw);
      const newValue = await newValueCallback(oldValue);
      const newValueRaw = mode === MODE.RAW ? newValue : newValue === null ? null : JSON.stringify(newValue);

      if (oldValueRaw === newValueRaw) {
        return oldValue;
      }

      let validFirstReplies;
      const doDelete = newValueRaw === null;
      const clientMulti = mainClient.MULTI();
      if (doDelete) {
        useHash ? clientMulti.HDEL(key, field) : clientMulti.DEL(key);
        validFirstReplies = [0, 1];
      } else {
        useHash ? clientMulti.HSET(key, field, newValueRaw) : clientMulti.SET(key, newValueRaw);
        validFirstReplies = useHash ? [0, 1] : ["OK"];
      }
      const replies = await clientMulti.EXEC();
      if (replies === null) {
        // NOTE: EXEC can return null, if the operations was aborted, i.e., should be retried.
        lastAttemptError = null;
        continue;
      }
      if (!Array.isArray(replies) || replies.length !== 1 || !validFirstReplies.includes(replies[0])) {
        badReplyError = new VError(
          { name: VERROR_CLUSTER_NAME, info: { key, ...(field && { field }), attempt, attempts, replies } },
          "received unexpected replies from redis"
        );
        break;
      }
      return newValue;
    } catch (err) {
      lastAttemptError = err;
    }
  }
  if (badReplyError) {
    throw badReplyError;
  }
  if (lastAttemptError) {
    throw new VError(
      { name: VERROR_CLUSTER_NAME, cause: lastAttemptError, info: { key, ...(field && { field }), attempts } },
      "error during watched get set"
    );
  }
  throw new VError(
    { name: VERROR_CLUSTER_NAME, info: { key, ...(field && { field }), attempts } },
    "exceeded watched get set attempt limit"
  );
};

const _watchedGetSetExclusive = Semaphore.makeExclusive(_watchedGetSet);

/**
 * @callback NewValueCallback
 * @see watchedGetSet
 *
 * @param {string}  oldValue  previous value or null if the value was not set
 * @returns {string} new value to set for
 */
/**
 * @callback NewObjectValueCallback
 * @see watchedGetSetObject
 * @see watchedHashGetSetObject
 *
 * @param {object}  oldValue  previous value or null if the value was not set
 * @returns {object} new value to set for
 */
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
 * @param {string}            key               key to watch and modify
 * @param {NewValueCallback}  newValueCallback  asynchronous callback to compute new value for key, gets old value as
 *                                                input
 * @param {number}            attempts          number of attempts to modify key with optimistic locking
 * @returns {Promise<string>}  promise for the new value that was set
 */
const watchedGetSet = async (key, newValueCallback, attempts = 10) =>
  _watchedGetSetExclusive(key, newValueCallback, { mode: MODE.RAW, attempts });

/**
 * See {@link watchedGetSet}. Difference here is that it does an implicit JSON.parse/JSON.stringify before getting and
 * setting.
 *
 * @param {string}                  key               key to watch and modify
 * @param {NewObjectValueCallback}  newValueCallback  asynchronous callback to compute new value for key, gets old
 *                                                      value as input
 * @param {number}                  attempts          number of attempts to modify key with optimistic locking
 * @returns {Promise<object>}  promise for the new value that was set
 */
const watchedGetSetObject = async (key, newValueCallback, attempts = 10) =>
  _watchedGetSetExclusive(key, newValueCallback, { mode: MODE.OBJECT, attempts });

/**
 * See {@link watchedGetSetObject}. In addition to an implicit JSON.parse/JSON.stringify this interface will use the
 * hash variants HGET/HSET/HDEL for the underlying modifications.
 *
 * @param {string}                  key               key with hash fields to watch
 * @param {string}                  field             hash field to modify
 * @param {NewObjectValueCallback}  newValueCallback  asynchronous callback to compute new value for hash field, gets
 *                                                      old value as input
 * @param {number}                  attempts          number of attempts to modify hash field with optimistic locking
 * @returns {Promise<object>}  promise for the new value that was set
 */
const watchedHashGetSetObject = async (key, field, newValueCallback, attempts = 10) =>
  _watchedGetSetExclusive(key, newValueCallback, { field, mode: MODE.OBJECT, attempts });

/**
 * Asynchronously publish a given message on a given channel. This will lazily create the necessary publisher client.
 * Errors will be re-thrown.
 *
 * @param channel to publish the message on
 * @param message to publish
 * @returns {Promise<void>}
 */
const publishMessage = async (channel, message) => await _clientExec("PUBLISH", { channel, message });

/**
 * Subscribe to a given channel. New messages will be processed on all registered message handlers for that channel.
 * This will lazily create the necessary subscriber client. Errors happening during channel subscribe will be thrown
 * and event errors will be logged.
 *
 * @param channel whose messages should be processed
 */
const subscribe = async (channel) => {
  if (!subscriberClient) {
    subscriberClient = await getSubscriberClient();
  }
  try {
    await subscriberClient.SUBSCRIBE(channel, _subscribedMessageHandler);
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
    subscriberClient = await getSubscriberClient();
  }
  try {
    await subscriberClient.UNSUBSCRIBE(channel);
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

const _getIntegrationMode = async () => {
  if (cfEnv.isOnCf) {
    const redisIsCluster = cfEnv.cfServiceCredentialsForLabel(CF_REDIS_SERVICE_LABEL).cluster_mode;
    return redisIsCluster ? INTEGRATION_MODE.CF_REDIS_CLUSTER : INTEGRATION_MODE.CF_REDIS;
  }
  try {
    await getMainClient();
    return INTEGRATION_MODE.LOCAL_REDIS;
  } catch {
    // eslint-ignore-line no-empty
  }
  return INTEGRATION_MODE.NO_REDIS;
};

const getIntegrationMode = async () => {
  if (integrationMode === null) {
    integrationMode = await _getIntegrationMode();
  }
  return integrationMode;
};

module.exports = {
  REDIS_INTEGRATION_MODE: INTEGRATION_MODE,
  getMainClient,
  closeMainClient,
  getSubscriberClient,
  closeSubscriberClient,
  getIntegrationMode,
  sendCommand,
  type,
  get,
  getObject,
  set,
  del,
  setObject,
  watchedGetSet,
  watchedGetSetObject,
  watchedHashGetSetObject,
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
    _getMainClient: () => mainClient,
    _setMainClient: (value) => (mainClient = value),
    _getSubscriberClient: () => subscriberClient,
    _setSubscriberClient: (value) => (subscriberClient = value),
    _subscribedMessageHandler,
    _localReconnectStrategy,
    _createClientBase,
    _createClientAndConnect,
    _clientExec,
  },
};
