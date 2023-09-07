"use strict";

const UUID_REGEX = /\b[0-9a-f]{8}\b-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-\b[0-9a-f]{12}\b/;

const validateTenantScope = (newValue, scopeMap) => {
  const tenant = scopeMap?.tenant;
  if (tenant && !UUID_REGEX.test(tenant)) {
    return {
      errorMessage: 'tenant scope is not a valid uuid: "{0}"',
      errorMessageValues: [tenant],
    };
  }
};

module.exports = {
  validateTenantScope,
};
