"use strict";

const {
  singleton: { getFeatureValue },
} = require("@cap-js-community/feature-toggle-library");

const { FEATURE } = require("../feature");

const BAD_REQUEST_ERROR_HTTP_CODE = 400;

const SUCCESS_RESPONSES = ["well done", "works", "42", "success", "huzzah", "celebrations"];

const priorityHandler = async (context) => {
  const value = getFeatureValue(FEATURE.CHECK_API_PRIORITY, { user: context.user.id, tenant: context.tenant });
  return value > 0
    ? context.reply(value + " | " + SUCCESS_RESPONSES[Math.floor(Math.random() * SUCCESS_RESPONSES.length)])
    : context.error(BAD_REQUEST_ERROR_HTTP_CODE);
};

module.exports = async (srv) => {
  const { priority } = srv.operations("CheckService");
  srv.on(priority, priorityHandler);
};
