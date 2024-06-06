"use strict";

const cds = require("@sap/cds");
const { SERVICE_ENDPOINTS } = require("../src/plugin");

describe("plugin", () => {
  test("all endpoints are covered", async () => {
    const csn = await cds.load(["./src/service/feature-service.cds"]);
    const csnEndpoints = Object.keys(csn.definitions).filter((name) => name.indexOf(".") !== -1);
    const coveredEndpoints = Object.values(SERVICE_ENDPOINTS).flat();
    expect(coveredEndpoints).toEqual(expect.arrayContaining(csnEndpoints));
    expect(csnEndpoints).toEqual(expect.arrayContaining(coveredEndpoints));
  });
});
