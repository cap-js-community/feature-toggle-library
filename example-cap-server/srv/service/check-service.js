"use strict";

const toggles = require("@cap-js-community/feature-toggle-library");

const { CHECK_API_PRIORITY } = require("../feature");

const LOW_VALUE_RESPONSES = ["hello", "barely made it"];

const MEDIUM_VALUE_RESPONSES = ["welcome", "take a seat", "step right up"];
const MEDIUM_BOUNDARY = 10;

const HIGH_VALUE_RESPONSES = ["well done", "full success", "huzzah", "celebrations"];
const HIGH_BOUNDARY = 100;

const priorityHandler = (srv) => async (context) => {
  // NOTE: srv.model is the base service model without extensions, context.model is the extended service model if
  //   features are active otherwise undefined.
  const { "CheckService.priority": priority } = (context.model ?? srv.model).definitions;
  const isFtsToggled = Boolean(priority["@marked"]);
  const value = toggles.getFeatureValue(CHECK_API_PRIORITY, { user: context.user.id, tenant: context.tenant });
  const messages =
    value >= HIGH_BOUNDARY
      ? HIGH_VALUE_RESPONSES
      : value >= MEDIUM_BOUNDARY
        ? MEDIUM_VALUE_RESPONSES
        : LOW_VALUE_RESPONSES;
  const message = [value, messages[Math.floor(Math.random() * messages.length)], `isFtsToggled ${isFtsToggled}`].join(
    " | "
  );
  return context.reply(message);
};

module.exports = async (srv) => {
  const { priority } = srv.operations;
  srv.on(priority, priorityHandler(srv));
};
