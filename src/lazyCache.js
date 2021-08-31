"use strict";

const SEPARATOR = "##";

class LazyCache {
  constructor() {
    this._data = Object.create(null);
  }
  static _key(keyOrKeys) {
    return Array.isArray(keyOrKeys) ? keyOrKeys.join(SEPARATOR) : keyOrKeys;
  }
  _data() {
    return this._data;
  }
  has(keyOrKeys) {
    return Object.prototype.hasOwnProperty.call(this._data, LazyCache._key(keyOrKeys));
  }
  get(keyOrKeys) {
    return this._data[LazyCache._key(keyOrKeys)];
  }
  set(keyOrKeys, value) {
    this._data[LazyCache._key(keyOrKeys)] = value;
    return this;
  }
  setCb(keyOrKeys, callback, ...args) {
    return this.set(keyOrKeys, callback(...args));
  }
  async setCbAsync(keyOrKeys, callback, ...args) {
    return this.set(keyOrKeys, await callback(...args));
  }
  getSetCb(keyOrKeys, callback, ...args) {
    const key = LazyCache._key(keyOrKeys);
    if (!this.has(key)) {
      this.setCb(key, callback, ...args);
    }
    return this.get(key);
  }
  async getSetCbAsync(keyOrKeys, callback, ...args) {
    const key = LazyCache._key(keyOrKeys);
    if (!this.has(key)) {
      await this.setCbAsync(key, callback, ...args);
    }
    return this.get(key);
  }
  delete(keyOrKeys) {
    Reflect.deleteProperty(this._data, LazyCache._key(keyOrKeys));
    return this;
  }
  clear() {
    this._data = Object.create(null);
  }
}

module.exports = {
  LazyCache,
};
