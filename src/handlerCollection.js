"use strict";

const { promiseAllDone } = require("./promiseAllDone");

// TODO jsdocs

class HandlerCollection {
  constructor() {
    this.__handlers = Object.create(null);
  }
  _handlers() {
    return this.__handlers;
  }
  hasHandlers(key) {
    return Object.prototype.hasOwnProperty.call(this.__handlers, key);
  }
  registerHandler(key, handler) {
    if (!this.hasHandlers(key)) {
      this.__handlers[key] = [handler];
    } else {
      this.__handlers[key].push(handler);
    }
    return this.__handlers[key].length;
  }
  removeHandler(key, handerInput) {
    if (!this.hasHandlers(key)) {
      return 0;
    }
    const index = this.__handlers[key].findIndex((handler) => handler === handerInput);
    this.__handlers[key].splice(index, 1);
    if (this.__handlers[key].length === 0) {
      Reflect.deleteProperty(this.__handlers, key);
      return 0;
    } else {
      return this.__handlers[key].length;
    }
  }
  removeAllHandlers(key) {
    if (this.hasHandlers(key)) {
      Reflect.deleteProperty(this.__handlers, key);
    }
    return 0;
  }

  /**
   *
   */
  async triggerHandlers(key, args, cbError) {
    if (!this.hasHandlers(key)) {
      return;
    }
    await promiseAllDone(
      this.__handlers[key].map(async (handler) => {
        try {
          await handler(...args);
        } catch (err) {
          cbError(err, key, handler);
        }
      })
    );
  }
}

module.exports = { HandlerCollection };
