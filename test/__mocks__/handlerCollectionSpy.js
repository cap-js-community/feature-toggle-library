"use strict";

const { HandlerCollection } = jest.requireActual("../../src/handlerCollection");

// NOTE this spies on every method of the underlying class
module.exports = {
  HandlerCollection: jest.fn((...args) => {
    const instance = new HandlerCollection(...args);
    return Object.fromEntries(
      Object.getOwnPropertyNames(HandlerCollection.prototype)
        .filter((member) => member !== "constructor")
        .map((member) => [member, jest.fn((...args) => instance[member].bind(instance)(...args))])
    );
  }),
};
