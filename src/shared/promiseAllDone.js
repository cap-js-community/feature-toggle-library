"use strict";

const VError = require("verror");

/**
 * The regular Promise.all() cannot do proper error-handling. It will reject as soon as the first of the passed in
 * promises rejects. Any subsequent rejects are unhandled exceptions.
 *
 * With promiseAllDone you can mitigate that behavior. It will wait for all passed promises to complete and collect any
 * number of occurring errors in a single VError.MultiError.
 */
async function promiseAllDone(iterable) {
  const results = await Promise.allSettled(iterable);
  const rejects = results.filter((entry) => {
    return entry.status === "rejected";
  });
  if (rejects.length === 1) {
    return Promise.reject(rejects[0].reason);
  } else if (rejects.length > 1) {
    return Promise.reject(new VError.MultiError(rejects.map((reject) => reject.reason)));
  }
  return results.map((entry) => {
    return entry.value;
  });
}

module.exports = { promiseAllDone };
