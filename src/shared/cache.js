"use strict";

const DEFAULT_SEPARATOR = "##";
const DEFAULT_SIZE_LIMIT = 15;

/**
 * LazyCache is a cache where entries are built up lazily during the first access.
 */
class LazyCache {
  constructor({ separator = DEFAULT_SEPARATOR } = {}) {
    this.__data = Object.create(null);
    this.__separator = separator;
  }
  _separator() {
    return this.__separator;
  }
  _data() {
    return this.__data;
  }
  async _dataSettled() {
    return await Object.entries(this.__data).reduce(async (result, [key, value]) => {
      (await result)[key] = await value;
      return result;
    }, Promise.resolve({}));
  }
  _key(keyOrKeys) {
    return Array.isArray(keyOrKeys) ? keyOrKeys.join(this.__separator) : keyOrKeys;
  }
  has(keyOrKeys) {
    return Object.prototype.hasOwnProperty.call(this.__data, this._key(keyOrKeys));
  }
  get(keyOrKeys) {
    return this.__data[this._key(keyOrKeys)];
  }
  set(keyOrKeys, value) {
    this.__data[this._key(keyOrKeys)] = value;
    return this;
  }
  setCb(keyOrKeys, callback) {
    const resultOrPromise = callback();
    return this.set(
      keyOrKeys,
      resultOrPromise instanceof Promise
        ? resultOrPromise.catch((err) => {
            this.delete(keyOrKeys);
            return Promise.reject(err);
          })
        : resultOrPromise
    );
  }
  getSetCb(keyOrKeys, callback) {
    const key = this._key(keyOrKeys);
    if (!this.has(key)) {
      this.setCb(key, callback);
    }
    return this.get(key);
  }
  count() {
    return Object.keys(this.__data).length;
  }
  delete(keyOrKeys) {
    Reflect.deleteProperty(this.__data, this._key(keyOrKeys));
    return this;
  }
  clear() {
    this.__data = Object.create(null);
  }
}

/**
 * LimitedLazyCache is a variant of {@link LazyCache}, where the total number of entries is limited. New entries beyond
 * the limit will automatically evict the oldest entries in the cache.
 */
class LimitedLazyCache extends LazyCache {
  constructor({ separator = DEFAULT_SEPARATOR, sizeLimit = DEFAULT_SIZE_LIMIT } = {}) {
    super({ separator });
    this.__sizeLimit = sizeLimit;
    this.__keyQueue = [];
  }

  set(keyOrKeys, value) {
    const key = super._key(keyOrKeys);
    if (!super.has(key)) {
      this.__keyQueue.unshift(key);
      while (this.__keyQueue.length > this.__sizeLimit) {
        super.delete(this.__keyQueue.pop());
      }
    }
    return super.set(key, value);
  }
}

module.exports = {
  DEFAULT_SEPARATOR,
  DEFAULT_SIZE_LIMIT,
  LazyCache,
  LimitedLazyCache,
};
