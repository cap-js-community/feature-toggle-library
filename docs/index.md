---
layout: home
title: Home
nav_order: 1
---

# BTP Feature Toggles

BTP Feature Toggles is a nodejs library, which will enable Cloud Foundry applications to maintain live-updatable feature
toggles.

## Install or Upgrade

```bash
npm install @sap/btp-feature-toggles@latest --save --@sap:registry=https://int.repositories.cloud.sap/artifactory/api/npm/build-releases-npm/
```

## Core Features

- maintain feature toggle states consistently across multiple app instances
- feature toggle changes are published from Redis to subscribed app instance with a publish/subscribe pattern [PUB/SUB](https://redis.io/topics/pubsub)
- horizontal app scaling is supported and new app instances will start with the current state,
  or fallback values, if they cannot connect to Redis
- concurrent updates are handled cleanly with retries using Redis' variant of [transactions](https://redis.io/topics/transactions)
- user-code can register callbacks for updates to specific toggles or query the current in-memory state
- user-code can register callbacks for input validation on specific toggles
- even without Redis, the feature toggles will locally keep all state changes until restart

## Further topics

- Configuration and User Code examples: [Usage](usage)
- Explanation of Redis integration: [Architecture](architecture)
- CAP service example: [CAP Example](cap-example)
