---
"@podosoft/podokit": minor
---

Start production deployments with the audit log on, and let `podo deploy doctor` warn. With the `audit-log` module installed, `podo deploy init` sets `AUDIT_LOG_ENABLED: "true"` in the profile's `runtimeConfig` for both drivers, and the module adds it to the example `infra/k3s/configmap.yaml`. The doctor now checks the profile against the application before it contacts the target and reports settings that deploy but probably not as intended as `warn` lines (`"warning": true` in JSON), which do not stop `apply`; it warns when `AUDIT_LOG_ENABLED` is missing or not `"true"`.
