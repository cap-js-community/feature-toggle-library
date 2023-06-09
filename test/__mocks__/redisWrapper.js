"use strict";

const { REDIS_INTEGRATION_MODE } = jest.requireActual("../../src/redisWrapper");

const redisKey = "feature-key";
let mockRedisState = {};

const getObject = jest.fn(async (key) => {
  mockRedisState.values = mockRedisState.values ? mockRedisState.values : {};
  return mockRedisState.values[key];
});

const type = jest.fn(async () => "hash");

const watchedHashGetSetObject = jest.fn(async (key, field, newValueCallback) => {
  mockRedisState.values = mockRedisState.values ? mockRedisState.values : {};
  mockRedisState.values[key] = mockRedisState.values[key] ? mockRedisState.values[key] : {};
  mockRedisState.values[key][field] = await newValueCallback(mockRedisState.values[key][field]);
  return mockRedisState.values[key][field];
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
  watchedHashGetSetObject,
  subscribe: jest.fn(),
  getIntegrationMode: jest.fn(() => REDIS_INTEGRATION_MODE.CF_REDIS),
  _reset,
  _setValues,
  _setValue,
};
