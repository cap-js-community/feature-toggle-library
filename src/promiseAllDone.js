"use strict";

async function promiseAllDone(iterable) {
  const results = await Promise.allSettled(iterable);
  const rejects = results.filter((entry) => {
    return entry.status === "rejected";
  });
  if (rejects.length === 1) {
    return Promise.reject(rejects[0].reason);
  } else if (rejects.length > 1) {
    return Promise.reject(new vError.MultiError(rejects.map((reject) => reject.reason)));
  }
  return results.map((entry) => {
    return entry.value;
  });
}

module.exports = { promiseAllDone };
