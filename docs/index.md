---
layout: home
title: Overview
nav_order: 1
---

# SAP BTP Feature Toggle Library

SAP BTP feature toggle library enables Node.js applications using the SAP Cloud Application Programming Model to maintain live-updatable feature toggles via Redis.

## Getting Started (CAP Feature Toggles)

- Set up project with `@sap/cds`.
- Install library:

  ```bash
  npm install --save @cap-js-community/feature-toggle-library
  ```

- For CAP Feature Toggles everything is configured automatically.
- The library acts as a CDS-Plugin and registers a `FeatureService`, which is used to check and update toggles.
- For details see [Example CAP Server](https://github.com/cap-js-community/feature-toggle-library/blob/main/example-cap-server).

## Getting Started (Custom Configuration)

- Same as previous section.
- Write `toggles.yaml` configuration file:

  ```yaml
  # info: check api priority; 0 means access is disabled
  /check/priority:
    type: number
    fallbackValue: 0
    validations:
      - scopes: [user, tenant]
      - regex: '^\d+$'
  ```

- Add configuration path to `package.json`:

  ```json
  {
    "cds": {
      "featureToggles": {
        "configFile": "./toggles.yaml"
      }
    }
  }
  ```

- Write usage code in handlers:

  ```javascript
  const toggles = require("@cap-js-community/feature-toggle-library");

  const priorityHandler = async (context) => {
    const user = context.user.id;
    const tenant = context.tenant;
    const value = toggles.getFeatureValue("/check/priority", { user, tenant });
    if (value <= 0) {
      return context.reject("blocked");
    } else if (value < 10) {
      return context.reply("welcome");
    } else {
      return context.reply("very welcome");
    }
  };
  ```

## Features

- Maintain feature toggle states consistently across multiple app instances.
- Feature toggle changes are published from Redis to subscribed app instances with publish/subscribe pattern [PUB/SUB](https://redis.io/topics/pubsub).
- Horizontal app scaling is supported and new app instances will start with the correct state, or fallback values, if they cannot connect to Redis.
- Feature toggle values can be changed specifically for accessors with certain scopes, e.g., for specific tenants, users,...
- Users can register change handler callbacks for specific toggles.
- Users can register custom input validation callbacks for specific toggles.
- Works as a [CDS-Plugin](https://cap.cloud.sap/docs/node.js/cds-plugins) and provides a REST service to read and manipulate toggles.

## Peers

- [CAP Extensibility Feature Toggles](peers/#cap-extensibility-feature-toggles)
- [SAP Feature Flags Service](peers/#sap-feature-flags-service)

## Further Topics

- Configuration and code snippets: [Usage](usage)
- CDS-Plugin and REST service: [Plugin and Service](plugin)
- Fundamental concepts: [Concepts](concepts)
