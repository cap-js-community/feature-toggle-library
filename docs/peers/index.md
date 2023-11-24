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

In CAP, the features to be toggled are _pre-built extensions_ of CDS models. These extensions are either active or
inactive, i.e., boolean in nature. They are dynamic in the sense that they can be active for one request and inactive
for another based on the requesting user or tenant. However, their state never changes within the handling of a
request.

Our library supports these types of toggles, by acting as a _Feature Vector Provider_ for CDS, when the library is used
as a CDS-plugin. For details see: [Feature Vector Provider]({{ site.baseurl }}/plugin/#feature-vector-provider).

## SAP Feature Flags Service

Reference documentation:
[https://help.sap.com/docs/feature-flags-service](https://help.sap.com/docs/feature-flags-service)

feature flags service is a central platform service that offers centralized toggle state and a web interface to switch
toggles. => this approach necessitates that all toggle state queries do a web request, which is orders of magnitude
slower than the library running on the server in memory. however the interface is easier to use, and it may make sense
to integrate the service as an option into the library for better usability at some point.
