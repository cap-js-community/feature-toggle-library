"use strict";

class DynamicIntervalController {
  constructor(callback, initialActive, initialWaitInterval) {
    this.callback = callback;
    this.active = initialActive;
    this.waitInterval = initialWaitInterval;
    this.isRunning = false;
    this.callbackTimeoutId = null;
    this._refresh();
  }

  async _callbackWrapperWithState() {
    this.isRunning = true;
    try {
      await this._callbackWrapper();
    } finally {
      this.isRunning = false;
    }
  }

  async _callbackWrapper() {
    this.callbackTimeoutId = null;
    if (!this.active) {
      return;
    }
    try {
      await this.callback();
    } finally {
      if (this.active) {
        this.callbackTimeoutId = setTimeout(this._callbackWrapperWithState.bind(this), this.waitInterval);
      }
    }
  }

  /**
   * A refresh with active=true kicks of a chain of callback => waitTime => callback => waitTime => ...
   *
   * Refresh during Off
   * => if active => start new chain
   * => if !active => fine already off
   *
   * Refresh during WaitTime
   * => if active => need to restart setTimeout (to respect new intervalTime)
   * => if !active => need to stop setTimeout
   *
   * Refresh during Callback
   * => if active => fine will keep running by itself
   * => if !active => fine will stop by itself after Callback
   */
  _refresh() {
    if (!this.isRunning && !this.callbackTimeoutId) {
      if (this.active) {
        this.callbackTimeoutId = setTimeout(this._callbackWrapperWithState.bind(this), 0);
      }
    } else if (this.callbackTimeoutId) {
      clearTimeout(this.callbackTimeoutId);
      if (this.active) {
        this.callbackTimeoutId = setTimeout(this._callbackWrapperWithState.bind(this), 0);
      } else {
        this.callbackTimeoutId = null;
      }
    }
  }

  setWaitInterval(value) {
    if (this.waitInterval === value) {
      return;
    }
    this.waitInterval = value;
    this._refresh();
  }

  setActive(value) {
    if (this.active === value) {
      return;
    }
    this.active = value;
    this._refresh();
  }
}

module.exports = { DynamicIntervalController };
