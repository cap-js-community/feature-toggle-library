---
layout: default
title: Service
nav_order: 3
---

<!-- prettier-ignore-start -->
# Service
{: .no_toc }
<!-- prettier-ignore-end -->

<!-- prettier-ignore -->
- TOC
{: toc}

## CDS-Plugin Settings

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
