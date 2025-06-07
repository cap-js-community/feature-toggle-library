"use strict";

const priorityHandler = (srv) => async (context) => {
  // NOTE: srv.model is the base service model without extensions, context.model is the extended service model if
  //   features are active otherwise undefined.
  const { "CheckService.priority": priority } = (context.model ?? srv.model).definitions;
  const isFtsToggled = Boolean(priority["@marked"]);
  return context.reply(isFtsToggled);
};

module.exports = async (srv) => {
  const { priority } = srv.operations;
  srv.on(priority, priorityHandler(srv));
};
