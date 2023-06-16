"use strict";

const {
  singleton: { getFeatureValue },
} = require("@cap-js-community/feature-toggle-library");

const { FEATURE } = require("../feature");

const BAD_REQUEST_ERROR_HTTP_CODE = 400;

const SUCCESS_RESPONSES = ["well done", "works", "42", "success", "huzzah", "celebrations"];

const checkHandler = async (context) => {
  return getFeatureValue(FEATURE.CHECK_API_ENABLED, { tenant: context.tenant, user: context.user.id })
    ? context.reply(SUCCESS_RESPONSES[Math.floor(Math.random() * SUCCESS_RESPONSES.length)])
    : context.error(BAD_REQUEST_ERROR_HTTP_CODE);
};

module.exports = async (srv) => {
  const { check } = srv.operations("CheckService");
  srv.on(check, checkHandler);
};
