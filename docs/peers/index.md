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

This SAP BTP service is designed to assist applications with microservice or multi-component architecture in harmonizing
and managing their feature delivery and runtime state. To accomplish this, it provides a service instance with
centralized state that can be queried with a web API or accessed via a dashboard to alter feature states.

We believe this approach works well in practice for many applications. However, our library follows a somewhat different
philosophy for feature toggle management:

- We don't have a dashboard to get an overview of the active feature states in applications with multiple parts.
- We don't have any rollout concepts, like gradual rollout or similar. Our library is client-side, hence decentralized,
  and it has no holistic view of how many servers or end-users use it.
- We encourage that the feature configuration is part of the application source code, in human-readable yaml form, in
  order to keep the code in sync with the respective features.
- We use redis for state persistence and this allows us to use a sub/pub pattern to keep the local state of many
  application instances in sync without polling.
- We focus on input validation and allow flexible, expressive toggle states of different types.

We could imagine supporting the service as an alternative to redis and our source-versioned configuration files at
some point. The service does not come with an associated client library, so there are natural synergies where our
library can help in terms of caching and local state management.
