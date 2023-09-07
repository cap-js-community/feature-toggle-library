"use strict";

const TENANT_SCOPE_REGEX = /^(people|pets)$/;

const validateTenantScope = (newValue, scopeMap) => {
  const tenant = scopeMap?.tenant;
  if (tenant && !TENANT_SCOPE_REGEX.test(tenant)) {
    return {
      errorMessage: 'tenant scope is invalid, only people and pets are allowed: "{0}"',
      errorMessageValues: [tenant],
    };
  }
};

module.exports = {
  validateTenantScope,
};
