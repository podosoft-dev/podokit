---
"@podosoft/podokit": minor
---

Derive every proxy trust setting from one profile field, `exposure.edgeProxies`: the number of reverse proxies in front of the deployment (new Kubernetes profiles 0, new Compose profiles 1). The renderers set `XFF_DEPTH` to `edgeProxies` + 1 behind a Kubernetes Ingress, `edgeProxies` for a NodePort or a directly published Compose web service, and 1 behind the Compose gateway; `ADDRESS_HEADER`, `PROTOCOL_HEADER`, and `HOST_HEADER` only behind a proxy; and `TRUSTED_PROXY_HOPS` 1 for the API. `runtimeConfig` now refuses `ADDRESS_HEADER`, `XFF_DEPTH`, `TRUSTED_PROXY_HOPS`, and `TRUSTED_PROXY_HEADER`. Compose deployments behind a proxy now trust `X-Forwarded-Proto` and `X-Forwarded-Host`, which the guide told them to enable through keys the profile refused, and a NodePort profile without edge proxies stops trusting forwarded headers. `podo deploy doctor` warns when `edgeProxies`, `trustedProxyCidrs`, and direct paths contradict each other.
