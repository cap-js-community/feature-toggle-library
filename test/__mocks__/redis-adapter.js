"use strict";

const { REDIS_INTEGRATION_MODE } = jest.requireActual("../../src/redis-adapter");

const redisKey = "feature-key";
let mockRedisState = {};

const getObject = jest.fn(async (key) => {
  mockRedisState.values = mockRedisState.values ? mockRedisState.values : {};
  return mockRedisState.values[key];
});

const hashGetAllObjects = jest.fn(async () => {
  mockRedisState.values = mockRedisState.values ? mockRedisState.values : {};
  return mockRedisState.values[redisKey];
});

const type = jest.fn(async () => "hash");

const watchedHashGetSetObject = jest.fn(async (key, field, newValueCallback) => {
  mockRedisState.values = mockRedisState.values ? mockRedisState.values : {};
  mockRedisState.values[key] = mockRedisState.values[key] ? mockRedisState.values[key] : {};
  const newValue = await newValueCallback(mockRedisState.values[key][field]);
  if (newValue === null) {
    Reflect.deleteProperty(mockRedisState.values[key], field);
  } else {
    mockRedisState.values[key][field] = newValue;
  }
  return newValue;
});

const registerMessageHandler = jest.fn((channel, handler) => {
  mockRedisState.handlers = mockRedisState.handlers ? mockRedisState.handlers : {};
  if (!Array.isArray(mockRedisState.handlers[channel])) {
    mockRedisState.handlers[channel] = [];
  }
  mockRedisState.handlers[channel].push(handler);
});

const publishMessage = jest.fn(async (channel, message) => {
  mockRedisState.handlers = mockRedisState.handlers ? mockRedisState.handlers : {};
  if (!Array.isArray(mockRedisState.handlers[channel])) {
    return;
  }
  return Promise.all(mockRedisState.handlers[channel].map((handler) => handler(message)));
});

const _reset = () => {
  mockRedisState = {};
};

const _setValues = async (values) => {
  mockRedisState.values = mockRedisState.values ? mockRedisState.values : {};
  mockRedisState.values[redisKey] = values;
};

const _setValue = async (key, value) => {
  mockRedisState.values = mockRedisState.values ? mockRedisState.values : {};
  mockRedisState.values[redisKey] = mockRedisState.values[redisKey] ? mockRedisState.values[redisKey] : {};
  mockRedisState.values[redisKey][key] = value;
};

module.exports = {
  REDIS_INTEGRATION_MODE,
  registerMessageHandler,
  publishMessage,
  type,
  getObject,
  hashGetAllObjects,
  watchedHashGetSetObject,
  subscribe: jest.fn(),
  getIntegrationMode: jest.fn(() => REDIS_INTEGRATION_MODE.CF_REDIS),
  setClientOptions: jest.fn(),
  _reset,
  _setValues,
  _setValue,
};
