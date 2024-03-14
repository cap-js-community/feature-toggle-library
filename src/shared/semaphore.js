"use strict";

/**
 * The goal of this class is to ensure mutually exclusive code execution within one node runtime.
 *
 * usage:
 * const semaphore = new Semaphore();
 *
 * const criticalCodeExclusive = async () => {
 *   await semaphore.acquire();
 *   try {
 *     await criticalCode();
 *   } finally {
 *     semaphore.release();
 *   }
 * }
 *
 *
 * https://en.wikipedia.org/wiki/Semaphore_(programming)
 */

class Semaphore {
  constructor() {
    this.promiseCurrentSemaphore = Promise.resolve();
    this.resolveCurrentSemaphore = null;
  }

  /**
   * Returns a promise used to wait for semaphore to become available. This method should be awaited.
   * @returns A promise that gets resolved when execution is allowed to proceed.
   *
   * @alias wait
   */
  async acquire() {
    const promiseSemaphoreReleased = this.promiseCurrentSemaphore;
    let resolveSemaphoreReleased;
    this.promiseCurrentSemaphore = new Promise((resolve) => {
      resolveSemaphoreReleased = resolve;
    });

    await promiseSemaphoreReleased;
    this.resolveCurrentSemaphore = resolveSemaphoreReleased;
  }

  /**
   * Release semaphore. If there are other functions waiting, one of them will continue to execute in a future
   * iteration of the event loop.
   *
   * @alias signal
   */
  release() {
    if (this.resolveCurrentSemaphore) {
      this.resolveCurrentSemaphore();
    }
  }

  /**
   * Take an async function and turn it into an exclusively executing async function. Calls during async execution will
   * be queued and executed serially.
   */
  static makeExclusiveQueuing(cb) {
    const semaphore = new Semaphore();
    return async (...args) => {
      await semaphore.acquire();
      try {
        return await cb(...args);
      } finally {
        semaphore.release();
      }
    };
  }

  /**
   * Take an async function and turn it into an exclusively executing async function. Calls during async execution will
   * get a promise for the result of the exclusive caller.
   */
  static makeExclusiveReturning(cb) {
    let isRunning;
    let runningPromise;
    return async (...args) => {
      if (isRunning) {
        return runningPromise;
      }
      isRunning = true;
      try {
        runningPromise = cb(...args);
        return await runningPromise;
      } finally {
        isRunning = false;
      }
    };
  }
}

module.exports = { Semaphore };
