"use strict";

const { promiseAllDone } = require("./promiseAllDone");

/**
 * HandlerCollection keeps track of lists of (async) handlers that can be triggered together.
 */
class HandlerCollection {
  constructor() {
    this.__handlers = Object.create(null);
  }

  _handlers() {
    return this.__handlers;
  }

  /**
   * hasHandlers is true if and only if the collection has handlers for the given key.
   *
   * @param {string} key identifier for the handler list
   * @returns {boolean}
   */
  hasHandlers(key) {
    return Object.prototype.hasOwnProperty.call(this.__handlers, key);
  }

  /**
   * Use registerHandler to register a given handler in the list of a given key. Duplicate registrations are possible
   * and handlers will be called as many times as they are registered.
   *
   * @param {string} key identifier for the handler list
   * @param {function} handler
   */
  registerHandler(key, handler) {
    if (!this.hasHandlers(key)) {
      this.__handlers[key] = [handler];
    } else {
      this.__handlers[key].push(handler);
    }
    return this.__handlers[key].length;
  }

  /**
   * Use removeHandler to remove a given handler from the list of a given key. Duplicate registrations will be removed
   * together.
   *
   * @param {string} key identifier for the handler list
   * @param {function} handler
   */
  removeHandler(key, handler) {
    if (!this.hasHandlers(key)) {
      return 0;
    }
    while (true) {
      const index = this.__handlers[key].findIndex((currentHandler) => currentHandler === handler);
      if (index !== -1) {
        this.__handlers[key].splice(index, 1);
      } else {
        break;
      }
    }
    if (this.__handlers[key].length === 0) {
      Reflect.deleteProperty(this.__handlers, key);
      return 0;
    }
    return this.__handlers[key].length;
  }

  /**
   * Use removeAllHandlers to remove all handlers for a given key.
   *
   * @param {string} key identifier for the handler list
   */
  removeAllHandlers(key) {
    if (this.hasHandlers(key)) {
      Reflect.deleteProperty(this.__handlers, key);
    }
    return 0;
  }

  /**
   * @callback errorCallback function to handle cases where handlers throw an error
   * @param {Error} err
   * @param {string} key
   * @param {function} handler
   */
  /**
   * Use triggerHandlers trigger all handlers with given args with a callback for error handling.
   *
   * @param {string} key identifier for the handler list
   * @param {Array} args args to pass to all handlers
   * @param {errorCallback} errorHandler function to handle cases where handlers throw an error
   * @returns {Array} array of individual handler results, or errorHandler results for those cases where handlers failed
   */
  // NOTE: For all current usecases, errorHandler could also be passed as part of registerHandler. We keep it here,
  //   since triggerHandlers could have more relevant runtime information than registerHandler, but this might change
  //   with future use cases.
  async triggerHandlers(key, args, errorHandler) {
    if (!this.hasHandlers(key)) {
      return;
    }
    return promiseAllDone(
      this.__handlers[key].map(async (handler) => {
        try {
          return await handler(...args);
        } catch (err) {
          return errorHandler(err, key, handler);
        }
      })
    );
  }
}

module.exports = { HandlerCollection };
