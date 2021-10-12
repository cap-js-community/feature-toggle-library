"use strict";

const { promiseAllDone } = require("./promiseAllDone");

class HandlerCollection {
  constructor() {
    this.__handlers = Object.create(null);
  }
  _handlers() {
    return this.__handlers;
  }
  hasHandlers(id) {
    return Object.prototype.hasOwnProperty.call(this.__handlers, id);
  }
  registerHandler(id, handler) {
    if (!this.hasHandlers(id)) {
      this.__handlers[id] = [handler];
    } else {
      this.__handlers[id].push(handler);
    }
    return this.__handlers[id].length;
  }
  removeHandler(id, handerInput) {
    if (!this.hasHandlers(id)) {
      return 0;
    }
    const index = this.__handlers[id].findIndex((handler) => handler === handerInput);
    this.__handlers[id].splice(index, 1);
    if (this.__handlers[id].length === 0) {
      Reflect.deleteProperty(this.__handlers, id);
      return 0;
    } else {
      return this.__handlers[id].length;
    }
  }
  removeAllHandlers(id) {
    if (this.hasHandlers(id)) {
      Reflect.deleteProperty(this.__handlers, id);
    }
    return 0;
  }
  async triggerHandlers(id, args, cbError) {
    if (!this.hasHandlers(id)) {
      return;
    }
    await promiseAllDone(
      this.__handlers[id].map(async (handler) => {
        try {
          await handler(...args);
        } catch (err) {
          cbError(err, id, handler.name);
        }
      })
    );
  }
}

module.exports = { HandlerCollection };
