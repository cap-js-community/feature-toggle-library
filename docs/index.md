---
layout: home
title: Home
nav_order: 1
---

# SAP BTP Feature Toggle Library

SAP BTP feature toggle library enables Node.js applications using the SAP Cloud Application Programming Model to maintain live-updatable feature toggles via Redis.

## Install or Upgrade

```bash
npm install --save @cap-js-community/feature-toggle-library
```

## Features

- maintain feature toggle states consistently across multiple app instances
- feature toggle changes are published from Redis to subscribed app instance with publish/subscribe pattern [PUB/SUB](https://redis.io/topics/pubsub)
- horizontal app scaling is supported and new app instances will start with the correct state, or fallback values, if they cannot connect to Redis
- feature toggles can be changed only for accesses with specific scopes, i.e, for specific tenants
- users can register change handler callbacks for specific toggles
- users can register custom input validation callbacks for specific toggles

## Further topics

- Configuration and code snippets: [Usage](usage)
- Architecture and related concepts: [Architecture](architecture)
- CAP server example: [CAP Example](https://github.com/cap-js-community/feature-toggle-library/blob/main/example/cap-server)
