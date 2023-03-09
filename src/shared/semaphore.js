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
}

module.exports = { Semaphore };
