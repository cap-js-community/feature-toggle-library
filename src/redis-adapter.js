/**
 * redis-adapter is a thin wrapper around the node redis module.
 *
 * @see {@link https://www.npmjs.com/package/redis|redis on npm}
 * @module redis-adapter
 */
"use strict";

const redis = require("@redis/client");
const VError = require("verror");
const { CfEnv } = require("./shared/cf-env");
const { Logger } = require("./shared/logger");
const { HandlerCollection } = require("./shared/handler-collection");
const { Semaphore } = require("./shared/semaphore");
const { tryJsonParse } = require("./shared/static");

const COMPONENT_NAME = "/RedisAdapter";
const VERROR_CLUSTER_NAME = "RedisAdapterError";

const INTEGRATION_MODE = Object.freeze({
  CF_REDIS_CLUSTER: "CF_REDIS_CLUSTER",
  CF_REDIS: "CF_REDIS",
  LOCAL_REDIS: "LOCAL_REDIS",
  NO_REDIS: "NO_REDIS",
});
const CF_REDIS_SERVICE_LABEL = "redis-cache";
const REDIS_CLIENT_DEFAULT_PING_INTERVAL = 4 * 60000;

const cfEnv = CfEnv.getInstance();
const logger = new Logger(COMPONENT_NAME);

const MODE = Object.freeze({
  RAW: "raw",
  OBJECT: "object",
});

let __messageHandlers;
let __customCredentials;
let __customClientOptions;
let __activeOptionsTuple;
let __canGetClientPromise;
let __mainClientPromise;
let __subscriberClientPromise;
let __integrationModePromise;
const _reset = () => {
  __messageHandlers = new HandlerCollection();
  __customCredentials = null;
  __customClientOptions = null;
  __activeOptionsTuple = null;
  __canGetClientPromise = null;
  __mainClientPromise = null;
  __subscriberClientPromise = null;
  __integrationModePromise = null;
};
_reset();

const _logErrorOnEvent = (err) =>
  cfEnv.isOnCf ? logger.error(err) : logger.warning("%s | %O", err.message, VError.info(err));

const _subscribedMessageHandler = async (message, channel) => {
  const handlers = __messageHandlers.getHandlers(channel);
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

const _getRedisOptionsTuple = () => {
  if (!__activeOptionsTuple) {
    const defaultClientOptions = {
      pingInterval: REDIS_CLIENT_DEFAULT_PING_INTERVAL,
      socket: {
        host: "localhost",
        port: 6379,
      },
    };

    const credentials = __customCredentials || cfEnv.cfServiceCredentialsForLabel(CF_REDIS_SERVICE_LABEL);
    const hasCredentials = Object.keys(credentials).length > 0;

    const isCluster = !!credentials.cluster_mode;
    const credentialClientOptions = hasCredentials
      ? {
          password: credentials.password,
          socket: {
            host: credentials.hostname,
            port: credentials.port,
            tls: credentials.tls,
          },
        }
      : undefined;

    // NOTE: documentation is buried here https://github.com/redis/node-redis/blob/master/docs/client-configuration.md
    const redisClientOptions = {
      ...defaultClientOptions,
      ...credentialClientOptions,
      ...__customClientOptions,
      // https://nodejs.org/docs/latest-v22.x/api/net.html#socketconnectoptions-connectlistener
      // https://nodejs.org/docs/latest-v22.x/api/tls.html#tlsconnectoptions-callback
      // https://nodejs.org/docs/latest-v22.x/api/tls.html#tlscreatesecurecontextoptions
      socket: {
        ...defaultClientOptions.socket,
        ...credentialClientOptions?.socket,
        ...__customClientOptions?.socket,
      },
    };

    // NOTE: Azure and GCP have an object in their service binding credentials under tls, however it's filled
    //   with nonsensical values like:
    //   - "ca": "null", a literal string spelling null, or
    //   - "server_ca": "null", where "server_ca" is not a recognized property that could be set on a socket.
    //   For reference: https://nodejs.org/docs/latest-v22.x/api/tls.html#tlscreatesecurecontextoptions
    // NOTE: We normalize the tls value to boolean here, because @redis/client needs a boolean.
    if (Object.prototype.hasOwnProperty.call(redisClientOptions.socket, "tls")) {
      redisClientOptions.socket.tls = !!redisClientOptions.socket.tls;
    }

    __activeOptionsTuple = [isCluster, redisClientOptions];
  }

  return __activeOptionsTuple;
};

/**
 * Lazily create a new redis client. Client creation transparently handles both the Cloud Foundry "redis-cache" service
 * (hyperscaler option) and a local redis-server.
 *
 * @returns {RedisClient|RedisCluster}
 * @private
 */
const _createClientBase = (clientName) => {
  try {
    const [isCluster, redisClientOptions] = _getRedisOptionsTuple();
    if (isCluster) {
      return redis.createCluster({
        rootNodes: [redisClientOptions], // NOTE: assume this ignores everything but socket/url
        // https://github.com/redis/node-redis/issues/1782
        defaults: redisClientOptions, // NOTE: assume this ignores socket/url
      });
    }
    return redis.createClient(redisClientOptions);
  } catch (err) {
    throw new VError(
      { name: VERROR_CLUSTER_NAME, cause: err, info: { clientName } },
      "error during create client with redis service"
    );
  }
};

const _createClientAndConnect = async (clientName, { doLogEvents = true } = {}) => {
  let client = null;
  try {
    client = _createClientBase(clientName);
  } catch (err) {
    throw new VError({ name: VERROR_CLUSTER_NAME, cause: err, info: { clientName } }, "error during create client");
  }

  // NOTE: documentation about events is here https://github.com/redis/node-redis?tab=readme-ov-file#events
  if (doLogEvents) {
    client.on("error", (err) => {
      _logErrorOnEvent(
        new VError({ name: VERROR_CLUSTER_NAME, cause: err, info: { clientName } }, "caught error event")
      );
    });
    client.on("reconnecting", () => {
      logger.warning("client '%s' is reconnecting", clientName);
    });
  }

  try {
    await client.connect();
  } catch (err) {
    throw new VError({ name: VERROR_CLUSTER_NAME, cause: err, info: { clientName } }, "error during initial connect");
  }
  return client;
};

const _closeClientBase = async (client) => {
  if (client?.isOpen) {
    await client.quit();
  }
};

const setCustomOptions = (customCredentials, customClientOptions) => {
  __customCredentials = customCredentials;
  __customClientOptions = customClientOptions;
};

const _canGetClient = async () => {
  if (__canGetClientPromise === null) {
    __canGetClientPromise = (async () => {
      try {
        const silentClient = await _createClientAndConnect("silent", { doLogEvents: false });
        await _closeClientBase(silentClient);
        return true;
      } catch {} // eslint-disable-line no-empty
      return false;
    })();
  }
  return await __canGetClientPromise;
};

const _getIntegrationMode = async () => {
  const canGetClient = await _canGetClient();
  if (!canGetClient) {
    return INTEGRATION_MODE.NO_REDIS;
  }
  if (cfEnv.isOnCf) {
    const [isCluster] = _getRedisOptionsTuple();
    return isCluster ? INTEGRATION_MODE.CF_REDIS_CLUSTER : INTEGRATION_MODE.CF_REDIS;
  }
  return INTEGRATION_MODE.LOCAL_REDIS;
};

const getIntegrationMode = async () => {
  if (__integrationModePromise === null) {
    __integrationModePromise = _getIntegrationMode();
  }
  return await __integrationModePromise;
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
  if (!__mainClientPromise) {
    __mainClientPromise = _createClientAndConnect("main");
  }
  return await __mainClientPromise;
};

/**
 * Closes the main Redis client if it is open.
 *
 * @private
 */
const closeMainClient = async () => {
  await _closeClientBase(await __mainClientPromise);
  __mainClientPromise = null;
};

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
  if (!__subscriberClientPromise) {
    __subscriberClientPromise = _createClientAndConnect("subscriber");
  }
  return await __subscriberClientPromise;
};

/**
 * Closes the subscriber Redis client if it is open.
 *
 * @private
 */
const closeSubscriberClient = async () => {
  await _closeClientBase(await __subscriberClientPromise);
  __subscriberClientPromise = null;
};

const _clientExec = async (functionName, argsObject) => {
  const mainClient = await getMainClient();

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
  const mainClient = await getMainClient();

  try {
    const [isCluster] = _getRedisOptionsTuple();
    if (isCluster) {
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
  return result === null ? null : (tryJsonParse(result) ?? null);
};

/**
 * Asynchronously get all entries under a given hash.
 *
 * @param key
 * @returns {Promise<object|null>}
 */
const hashGetAll = async (key) => await _clientExec("HGETALL", { key });

/**
 * Asynchronously get all entries under a given hash and parse the values into objects.
 *
 * @param key
 * @returns {Promise<object|null>}
 */
const hashGetAllObjects = async (key) => {
  const result = await hashGetAll(key);
  return result === null
    ? null
    : Object.entries(result).reduce((acc, [key, value]) => {
        acc[key] = tryJsonParse(value) ?? null;
        return acc;
      }, {});
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
  const mainClient = await getMainClient();

  let lastAttemptError = null;
  let badReplyError = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await mainClient.WATCH(key);

      const oldValueRaw = useHash ? await mainClient.HGET(key, field) : await mainClient.GET(key);
      const oldValue =
        mode === MODE.RAW ? oldValueRaw : oldValueRaw === null ? null : (tryJsonParse(oldValueRaw) ?? null);
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

const _watchedGetSetExclusive = Semaphore.makeExclusiveQueuing(_watchedGetSet);

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
  const subscriberClient = await getSubscriberClient();
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
  const subscriberClient = await getSubscriberClient();
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
const registerMessageHandler = (channel, handler) => __messageHandlers.registerHandler(channel, handler);

/**
 * Stop a given handler from processing messages of a given subscribed channel.
 *
 * @param channel whose messages should not be processed
 * @param handler to remove
 */
const removeMessageHandler = (channel, handler) => __messageHandlers.removeHandler(channel, handler);

/**
 * Stop all handlers from processing messages of a given subscribed channel.
 *
 * @param channel whose messages should not be processed
 */
const removeAllMessageHandlers = (channel) => __messageHandlers.removeAllHandlers(channel);

module.exports = {
  REDIS_INTEGRATION_MODE: INTEGRATION_MODE,
  setCustomOptions,
  getIntegrationMode,
  getMainClient,
  closeMainClient,
  getSubscriberClient,
  closeSubscriberClient,
  sendCommand,
  type,
  get,
  getObject,
  hashGetAll,
  hashGetAllObjects,
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
    _getMessageHandlers: () => __messageHandlers,
    _getLogger: () => logger,
    _getMainClient: () => __mainClientPromise,
    _setMainClient: (value) => (__mainClientPromise = value),
    _getSubscriberClient: () => __subscriberClientPromise,
    _setSubscriberClient: (value) => (__subscriberClientPromise = value),
    _subscribedMessageHandler,
    _createClientBase,
    _createClientAndConnect,
    _clientExec,
  },
};
