"use strict";

let cfEnv;

const mockCfAppEnv = {
  application_id: "f84d681e-7123-442f-b8ea-2c747c11e145",
  application_name: "afc-backend",
  application_uris: ["skyfin-dev-afc-backend.cfapps.sap.hana.ondemand.com"],
  cf_api: "https://api.cf.sap.hana.ondemand.com",
  limits: {
    fds: 32768,
  },
  name: "afc-backend",
  organization_id: "792854a5-6fa0-456f-bbe7-17a4400fad6c",
  organization_name: "skyfin",
  space_id: "0215304c-3d6f-4f02-ae4f-a9bd6a9d46e9",
  space_name: "dev",
  uris: ["skyfin-dev-afc-backend.cfapps.sap.hana.ondemand.com"],
  users: null,
};

const mockCfServicesEnv = {
  "redis-cache": [
    {
      binding_guid: "39d69d64-63b8-4006-9d98-e43e417d5ecc",
      binding_name: null,
      credentials: {
        cluster_mode: false,
        hostname: "redis-cache-hostname",
        password: "",
        port: 1428,
        tls: true,
        uri: "rediss://no-user-name-for-redis:redis-cache-uri-password@redis-cache-uri-hostname",
      },
      instance_guid: "89daca6f-8a9a-48d1-a832-652d3265afa1",
      instance_name: "afc-redis",
      label: "redis-cache",
      name: "afc-redis",
      plan: "development",
      provider: null,
      syslog_drain_url: null,
      tags: ["cache"],
      volume_mounts: [],
    },
  ],
  "service-manager": [
    {
      binding_guid: "cd099cda-2306-48d4-aaaf-7c2630e0a318",
      binding_name: null,
      credentials: {
        clientid: "sb-e78c539a-1602-42ef-ad7f-aa71e99e5b2d!b5874|service-manager!b4065",
        clientsecret: "",
        sm_url: "https://service-manager.cfapps.sap.hana.ondemand.com",
        url: "https://skyfin.authentication.sap.hana.ondemand.com",
        xsappname: "e78c539a-1602-42ef-ad7f-aa71e99e5b2d!b5874|service-manager!b4065",
      },
      instance_guid: "e78c539a-1602-42ef-ad7f-aa71e99e5b2d",
      instance_name: "afc-service-manager",
      label: "service-manager",
      name: "afc-service-manager",
      plan: "container",
      provider: null,
      syslog_drain_url: null,
      tags: [],
      volume_mounts: [],
    },
  ],
  xsuaa: [
    {
      binding_guid: "9d00417e-ef03-452e-ae02-5e2f5a817e28",
      binding_name: null,
      credentials: {
        apiurl: "https://api.authentication.sap.hana.ondemand.com",
        clientid: "sb-afc-dev!t5874",
        clientsecret: "",
        "credential-type": "instance-secret",
        identityzone: "skyfin",
        identityzoneid: "7b20408e-3fe0-4ade-aa2e-ad97baac72e8",
        sburl: "https://internal-xsuaa.authentication.sap.hana.ondemand.com",
        subaccountid: "7b20408e-3fe0-4ade-aa2e-ad97baac72e8",
        tenantid: "7b20408e-3fe0-4ade-aa2e-ad97baac72e8",
        tenantmode: "shared",
        uaadomain: "authentication.sap.hana.ondemand.com",
        url: "https://skyfin.authentication.sap.hana.ondemand.com",
        verificationkey: "",
        xsappname: "afc-dev!t5874",
        zoneid: "7b20408e-3fe0-4ade-aa2e-ad97baac72e8",
      },
      instance_guid: "e020b20a-eb23-4475-91ec-d525f8738fd7",
      instance_name: "afc-uaa",
      label: "xsuaa",
      name: "afc-uaa",
      plan: "application",
      provider: null,
      syslog_drain_url: null,
      tags: ["xsuaa"],
      volume_mounts: [],
    },
  ],
};

let backupCfAppEnv;
let backupCfServicesEnv;

describe("cfenv test", () => {
  beforeAll(() => {
    backupCfAppEnv = process.env.VCAP_APPLICATION;
    backupCfServicesEnv = process.env.VCAP_SERVICES;
    process.env.VCAP_APPLICATION = JSON.stringify(mockCfAppEnv);
    process.env.VCAP_SERVICES = JSON.stringify(mockCfServicesEnv);
    cfEnv = require("../../src/shared/env");
  });

  afterAll(() => {
    if (backupCfAppEnv !== undefined) {
      process.env.VCAP_APPLICATION = backupCfAppEnv;
    } else {
      Reflect.deleteProperty(process.env, "VCAP_APPLICATION");
    }
    if (backupCfServicesEnv !== undefined) {
      process.env.VCAP_SERVICES = backupCfServicesEnv;
    } else {
      Reflect.deleteProperty(process.env, "VCAP_SERVICES");
    }
  });

  test("cfApp", () => {
    expect(cfEnv.cfApp).toStrictEqual(mockCfAppEnv);
  });

  test("cfServices", () => {
    expect(cfEnv.cfServices).toStrictEqual(mockCfServicesEnv);
  });

  test("cfServiceCredentials", () => {
    expect(cfEnv.cfServiceCredentials({ label: "redis-cache" })).toStrictEqual(
      mockCfServicesEnv["redis-cache"][0].credentials
    );
    expect(cfEnv.cfServiceCredentials({ xxx: "redis-cache" })).toStrictEqual({});
    expect(cfEnv.cfServiceCredentials({ label: "xxx" })).toStrictEqual({});
  });

  test("cfServiceCredentialsForLabel", () => {
    expect(cfEnv.cfServiceCredentialsForLabel("redis-cache")).toStrictEqual(
      mockCfServicesEnv["redis-cache"][0].credentials
    );
    expect(cfEnv.cfServiceCredentials("xxx")).toStrictEqual({});
  });
});
