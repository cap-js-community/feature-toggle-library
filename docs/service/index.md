---
layout: default
title: Plugin and Service
nav_order: 3
---

<!-- prettier-ignore-start -->
# Service
{: .no_toc }
<!-- prettier-ignore-end -->

<!-- prettier-ignore -->
- TOC
{: toc}

## Plugin Settings

Here is a list of all plugin settings that can be used in `package.json` under this library's node
`cds.featureToggles`. At least one of _configFile_ or _config_ needs to be set, for the initialization to work.

| setting            | type   | meaning                                                                   |
| :----------------- | :----- | :------------------------------------------------------------------------ |
| configFile         | string | path of the [configuration]({{ site.baseurl }}/usage/#configuration) file |
| config             | object | inline configuration (only recommended for toy projects)                  |
| serviceAccessRoles | array  | see below                                                                 |

_serviceAccessRoles_<br>
Per default the service endpoints are accessible only to users with the CAP pseudo-role
[system-user](https://cap.cloud.sap/docs/guides/authorization#pseudo-roles). Different projects have their own access
role preferences, so this setting allows them to set a list of strings, which represent the roles required to access
the service. For details see [@requires](https://cap.cloud.sap/docs/guides/authorization#requires).

## Service Endpoints

These service endpoints will enable operations teams to understand and modify toggle states. For practical requests,
check the [http file](https://github.com/cap-js-community/feature-toggle-library/blob/main/example-cap-server/http/feature-service.http)
in our example CAP Server.

### Read Server Memory State

Get all information about the current in-memory state of all toggles.

<b>Example Request/Response</b>

- Request
  ```http
  GET /rest/feature/state
  Authorization: ...
  ```
- Response
  ```
  HTTP/1.1 200 OK
  ...
  ```
  ```json
  {
    "/check/priority": {
      "fallbackValue": 0,
      "config": {
        "TYPE": "number",
        "VALIDATION": "^\\d+$",
        "ALLOWED_SCOPES": ["user", "tenant"]
      }
    },
    "/memory/logInterval": {
      "fallbackValue": 0,
      "config": {
        "TYPE": "number",
        "VALIDATION": "^\\d+$"
      }
    }
  }
  ```

---

### Update Toggle

Update the toggle state on Redis, which in turn is published to all server instances.

<b>Example Request/Responses</b>

- Valid Request
  ```http
  POST /rest/feature/redisUpdate
  Authorization: ...
  Content-Type: application/json
  ```
  ```json
  {
    "key": "/check/priority",
    "value": 10,
    "scope": { "tenant": "people" }
  }
  ```
- Response

  ```
  HTTP/1.1 204 No Content
  ...
  ```

- Invalid Request
  ```http
  POST /rest/feature/redisUpdate
  Authorization: ...
  Content-Type: application/json
  ```
  ```json
  {
    "key": "/check/priority",
    "value": "test"
  }
  ```
- Response
  ```
  HTTP/1.1 422 Unprocessable Entity
  ...
  ```
  ```json
  {
    "error": {
      "message": "value \"test\" has invalid type string, must be number",
      "code": "422",
      "@Common.numericSeverity": 4
    }
  }
  ```

## Service Endpoints for Debugging

The service also offers additional endpoints to analyze problems.

### Re-Sync Server with Redis

Force server to re-sync with Redis, this should never be necessary. It returns the same JSON structure as
`/state`, after re-syncing.

<b>Example Request/Response</b>

- Request
  ```http
  POST /rest/feature/redisRead
  Authorization: ...
  ```
- Response<br>
  Same as [Read Server Memory State](#read-server-memory-state).

---

### Send Redis Command

Send an arbitrary command to Redis. [https://redis.io/commands/](https://redis.io/commands/)

<b>Example Request/Responses</b>

- Request INFO
  ```http
  POST /rest/feature/redisSendCommand
  Authorization: ...
  Content-Type: application/json
  ```
  ```json
  {
    "command": ["INFO"]
  }
  ```
- Response
  ```
  HTTP/1.1 200 OK
  ...
  ```
  ```
  # Server
  redis_version:4.0.10
  redis_git_sha1:0
  redis_git_dirty:0
  redis_build_id:0
  ...
  ```
- Request KEYS
  ```http
  POST /rest/feature/redisSendCommand
  Authorization: ...
  Content-Type: application/json
  ```
  ```json
  {
    "command": ["KEYS", "features-*"]
  }
  ```
- Response
  ```
  HTTP/1.1 200 OK
  ...
  ```
  ```json
  ["features-...", "..."]
  ```
