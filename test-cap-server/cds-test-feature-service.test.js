"use strict";

const cds = require("@sap/cds");
const toggles = require("../src");

const FEATURE = {
  A: "/test/feature_a",
  B: "/test/feature_b",
};

const server = cds.test("test-cap-server");
const systemCall = { validateStatus: () => true, auth: { username: "system", password: "system" } };

describe("test-cap-server feature-service", () => {
  beforeEach(async () => {
    await Promise.all(Object.keys(FEATURE).map((key) => toggles.resetFeatureValue(key)));
  });
  afterEach(() => {
    jest.clearAllMocks();
  });

  const featureBChanges = [
    {
      key: FEATURE.B,
      value: 2,
    },
    {
      key: FEATURE.B,
      value: 20,
      scope: {
        tenant: "a",
      },
    },
    {
      key: FEATURE.B,
      value: 30,
      scope: {
        tenant: "b",
      },
    },
  ];

  test.each(["/rest/feature/redisSendCommand"])("%s is forbidden for system", async (endpoint) => {
    const response = await server.post(endpoint, {}, systemCall);
    expect(response.status).toBe(403);
  });

  test("state response no change", async () => {
    const response = await server.get("/rest/feature/state", systemCall);
    expect(response.status).toBe(200);
    expect(response.data).toMatchSnapshot();
  });

  test("state response with changes", async () => {
    await server.post("/rest/feature/redisUpdate", featureBChanges, systemCall);
    const response = await server.get("/rest/feature/state", systemCall);
    expect(response.status).toBe(200);
    expect(response.data).toMatchSnapshot();
  });

  test("redisRead response no change", async () => {
    const response = await server.post("/rest/feature/redisRead", {}, systemCall);
    expect(response.status).toBe(200);
    expect(response.data).toMatchInlineSnapshot(`
      {
        "/test/feature_b": {
          "config": {
            "SOURCE": "RUNTIME",
            "TYPE": "number",
          },
          "fallbackValue": 1,
          "rootValue": 2,
          "scopedValues": {
            "tenant::a": 20,
            "tenant::b": 30,
          },
        },
      }
    `);
  });

  test("redisRead response with changes", async () => {
    await server.post("/rest/feature/redisUpdate", featureBChanges, systemCall);
    const response = await server.post("/rest/feature/redisRead", {}, systemCall);
    expect(response.status).toBe(200);
    expect(response.data).toMatchInlineSnapshot(`
{
  "/test/feature_b": {
    "config": {
      "SOURCE": "RUNTIME",
      "TYPE": "number",
    },
    "fallbackValue": 1,
    "rootValue": 2,
    "scopedValues": {
      "tenant::a": 20,
      "tenant::b": 30,
    },
  },
}
`);
  });

  test("redisUpdate response success", async () => {
    const response = await server.post(
      "/rest/feature/redisUpdate",
      {
        key: FEATURE.A,
        value: true,
      },
      systemCall
    );
    expect(response.status).toBe(204);
    expect(response.data).toMatchInlineSnapshot(`""`);
  });

  test("redisUpdate response validation fail", async () => {
    const response = await server.post(
      "/rest/feature/redisUpdate",
      {
        key: FEATURE.A,
        value: 100,
      },
      systemCall
    );
    expect(response.status).toBe(422);
    expect(response.data).toMatchInlineSnapshot(`
{
  "error": {
    "code": "422",
    "message": "value "100" has invalid type number, must be boolean",
    "target": "/test/feature_a",
  },
}
`);
  });
});
