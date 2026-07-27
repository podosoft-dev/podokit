---
name: podokit-deploy
description: Plan, inspect, apply, verify, and roll back PodoKit Kubernetes releases with an explicit deployment profile and confirmation hash. Use when an agent needs to initialize a .podokit/deploy profile, diagnose a target cluster, preview a release, perform an approved deployment, inspect rollout state, verify public endpoints, or prepare an application rollback.
---

# Deploy a PodoKit application

1. Run `npx @podosoft/podokit status`, `npx @podosoft/podokit diff`, and `npx @podosoft/podokit doctor`. Stop if managed-file conflicts or unsupported framework versions could make the image unreliable.
2. Read [references/profile.md](references/profile.md) before creating or changing a deployment profile.
3. Run `npx @podosoft/podokit deploy doctor --profile <name>`. Resolve every failure without printing Secret values.
4. Run `npx @podosoft/podokit deploy plan --profile <name> --release <stable-semver> --json`.
5. Show the user the context, cluster fingerprint result, namespace, Helm release, exact images, current revision and status, actions, migration warning, and plan hash.
6. Do not apply until the user explicitly approves that exact plan.
7. Apply with `npx @podosoft/podokit deploy apply --profile <name> --release <stable-semver> --confirm <plan-hash>`.
8. Run `npx @podosoft/podokit deploy status --profile <name> --json` and `npx @podosoft/podokit deploy verify --profile <name> --json`.
9. Report the exact images, Helm revision, ready replicas, restart totals, and verification result.

For rollback, read [references/rollback.md](references/rollback.md), preview the target revision without `--confirm`, show the new plan hash, and obtain explicit approval.

Never create or rotate cluster credentials, registry credentials, DNS, virtual machines, Kubernetes Secrets, or backup repositories. Never put a password, token, private key, connection URL containing credentials, or Secret value in a profile, command argument, log, or report.
