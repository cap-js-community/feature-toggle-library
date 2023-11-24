---
layout: default
title: Peers
nav_order: 2
---

<!-- prettier-ignore-start -->
# Peers
{: .no_toc }
<!-- prettier-ignore-end -->

<!-- prettier-ignore -->
- TOC
{: toc}

## CAP Extensibility Feature Toggles

Reference documentation:
[https://cap.cloud.sap/docs/guides/extensibility/feature-toggles](https://cap.cloud.sap/docs/guides/extensibility/feature-toggles)

cap extensibility feature toggles are concerned with the data model and how this can be adapted for specific tenants or
users. => these toggles can only be boolean and the full set of possible resulting models needs to be pre-computed at
build time to enable the dynamic switching.

For details see: [Feature Vector Provider]({{ site.baseurl }}/plugin/#feature-vector-provider)

## SAP Feature Flags Service

Reference documentation:
[https://help.sap.com/docs/feature-flags-service](https://help.sap.com/docs/feature-flags-service)

feature flags service is a central platform service that offers centralized toggle state and a web interface to switch
toggles. => this approach necessitates that all toggle state queries do a web request, which is orders of magnitude
slower than the library running on the server in memory. however the interface is easier to use, and it may make sense
to integrate the service as an option into the library for better usability at some point.
