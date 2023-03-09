"use strict";

/**
 * HandlerCollection keeps track of lists of (async) handlers.
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
   * Get a list of all handlers registered for a given key or an empty array.
   *
   * @param {string} key identifier for the handler list
   * @returns {Array<function>} list of all handlers in order of registration or an empty array
   */
  getHandlers(key) {
    return this.hasHandlers(key) ? this.__handlers[key].slice() : [];
  }

  /**
   * Use registerHandler to register given handler(s) for a given key. Duplicate registrations are possible.
   *
   * @param {string} key identifier for the handler list
   * @param {Array<function>} handlers
   */
  registerHandler(key, ...handlers) {
    const hasHandlers = this.hasHandlers(key);
    if (handlers.length === 0) {
      return hasHandlers ? this.__handlers[key].length : 0;
    }
    if (!hasHandlers) {
      this.__handlers[key] = handlers;
    } else {
      this.__handlers[key] = this.__handlers[key].concat(handlers);
    }
    return this.__handlers[key].length;
  }

  /**
   * Use removeHandler to remove given handler(s) for a given key. Duplicate registrations will be removed together.
   *
   * @param {string} key identifier for the handler list
   * @param {Array<function>} handlers
   */
  removeHandler(key, ...handlers) {
    const hasHandlers = this.hasHandlers(key);
    if (handlers.length === 0) {
      return hasHandlers ? this.__handlers[key].length : 0;
    }
    if (!hasHandlers) {
      return 0;
    }
    this.__handlers[key] = this.__handlers[key].filter((currentHandler) => !handlers.includes(currentHandler));
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
}

module.exports = { HandlerCollection };
