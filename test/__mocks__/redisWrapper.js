"use strict";

const { REDIS_INTEGRATION_MODE } = jest.requireActual("../../src/redisWrapper");

const featuresKey = "feature-key";
let mockRedisState = {};

const getObject = jest.fn(async (key) => {
  mockRedisState.values = mockRedisState.values ? mockRedisState.values : {};
  return mockRedisState.values[key];
});

const watchedGetSetObject = jest.fn(async (key, newValueCallback) => {
  mockRedisState.values = mockRedisState.values ? mockRedisState.values : {};
  mockRedisState.values[key] = await newValueCallback(mockRedisState.values[key]);
  return mockRedisState.values[key];
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
  mockRedisState.values[featuresKey] = values;
};

const _setValue = async (key, value) => {
  mockRedisState.values = mockRedisState.values ? mockRedisState.values : {};
  mockRedisState.values[featuresKey] = mockRedisState.values[featuresKey] ? mockRedisState.values[featuresKey] : {};
  mockRedisState.values[featuresKey][key] = value;
};

module.exports = {
  registerMessageHandler,
  publishMessage,
  getObject,
  watchedGetSetObject,
  subscribe: jest.fn(),
  getIntegrationMode: jest.fn(() => REDIS_INTEGRATION_MODE.NO_REDIS),
  _reset,
  _setValues,
  _setValue,
};
