import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import type {
  DeployProfileV1,
  ResourceProfile,
  StatefulDependencyProfile,
  WorkloadProfile,
} from "./deploy-profile";
import { profilePath } from "./deploy-profile";
import { API_PATH_PREFIX, apiPathBase } from "./api-paths";
import { readAppProxyTimeouts, type AppProxyTimeouts } from "./app-proxy-timeouts";
import { idleTimeoutConfig, proxyTrustConfig, shutdownDrainSeconds } from "./deploy-schema";
import { readManifest } from "./lockfile";
import {
  resolveToolchain,
  toolchainMigrationCommand,
  toolchainWorkerCommand,
} from "./toolchain";

export interface DeploymentRuntime {
  root: string;
  dependencyChart: string;
  applicationChart: string;
  migrationManifest: string;
  dependencyManifest: string;
  applicationManifest: string;
  dependencies: RenderedDependency[];
}

export interface DeploymentImages {
  api: string;
  web: string;
  postgres: string | null;
  redis: string | null;
  objectStorage: string | null;
  objectStorageClient: string | null;
}

function quote(value: string): string {
  return JSON.stringify(value);
}

function yamlScalar(value: string): string {
  return /^(?!null$|true$|false$|~$)[A-Za-z_][A-Za-z0-9_./:-]*$/i.test(value)
    ? value
    : quote(value);
}

function yamlStringSequence(values: string[]): string {
  return `[${values.map((value) => yamlScalar(value)).join(", ")}]`;
}

function digest(parts: string[]): string {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part).update("\0");
  return `sha256:${hash.digest("hex")}`;
}

/** The pod-template annotation whose change makes Kubernetes replace a workload's pods. */
export const ROLLOUT_STATE_ANNOTATION = "podokit.example.com/rollout-state-checksum";
/** Recorded on each dependency StatefulSet: the checksum of the Secret it reads. */
export const SECRET_CHECKSUM_ANNOTATION = "podokit.example.com/secret-checksum";
/** Recorded on each dependency StatefulSet: its pod template without the image and rollout checksum. */
export const DEFINITION_CHECKSUM_ANNOTATION = "podokit.example.com/definition-checksum";

/**
 * What decides when pods restart for a change Kubernetes cannot see in the
 * manifest: a Secret read through env is fixed when the container starts.
 */
export interface KubernetesRolloutState {
  /** A digest of each referenced Secret's identity, by Secret name; never the identity itself. */
  secrets: Record<string, string>;
  /**
   * The rollout checksum a dependency StatefulSet keeps, by name: its live value,
   * when nothing it reads has changed since the last apply.
   */
  keep: Record<string, string>;
}

/** One rendered dependency StatefulSet, as the plan compares it with the live one. */
export interface RenderedDependency {
  name: string;
  image: string;
  args: string[] | null;
  secretName: string;
  imagePullSecret: string;
  secretChecksum: string;
  rolloutChecksum: string;
  definitionChecksum: string;
}

export function secretIdentityDigest(name: string, identity: string): string {
  return digest(["secret-identity", name, identity]);
}

/** The Secrets each workload reads through env, by workload name. */
export function workloadSecrets(profile: DeployProfileV1): Record<string, string[]> {
  const release = profile.target.release;
  const result: Record<string, string[]> = {
    [`${release}-api`]: [profile.secrets.api.name],
    [`${release}-web`]: profile.secrets.web ? [profile.secrets.web.name] : [],
  };
  if (profile.workloads.worker) result[`${release}-worker`] = [profile.secrets.api.name];
  if (profile.dependencies.postgres.mode === "inCluster") {
    result[`${release}-postgres`] = [profile.dependencies.postgres.secretName];
  }
  if (profile.dependencies.redis.mode === "inCluster") {
    result[`${release}-redis`] = [profile.dependencies.redis.secretName];
  }
  if (profile.dependencies.objectStorage.mode === "inCluster") {
    result[`${release}-minio`] = [profile.dependencies.objectStorage.secretName];
  }
  return result;
}

export function workloadSecretChecksum(state: KubernetesRolloutState, names: string[]): string {
  return digest([
    "workload-secrets",
    JSON.stringify([...names].sort().map((name) => [name, state.secrets[name] ?? null])),
  ]);
}

/**
 * The pod-template value for an input checksum. PodoKit 1.6.5 and earlier stamped
 * every workload with this function of one checksum over all referenced Secrets.
 */
export function rolloutChecksum(inputChecksum: string): string {
  return digest(["rollout-state", inputChecksum]);
}

function offlineRolloutState(profile: DeployProfileV1): KubernetesRolloutState {
  const secrets: Record<string, string> = {};
  for (const name of Object.values(workloadSecrets(profile)).flat()) {
    secrets[name] = digest(["offline-secret", name]);
  }
  return { secrets, keep: {} };
}

function podTemplateAnnotations(
  rolloutStateChecksum: string,
  runtimeConfigDigest?: string,
): string {
  const annotations = [
    `${ROLLOUT_STATE_ANNOTATION}: ${quote(rolloutStateChecksum)}`,
    ...(runtimeConfigDigest
      ? [`podokit.example.com/runtime-config-checksum: ${quote(runtimeConfigDigest)}`]
      : []),
  ];
  return `      annotations:
${annotations.map((annotation) => `        ${annotation}`).join("\n")}`;
}

function storageClassLine(dependency: StatefulDependencyProfile): string {
  return dependency.storageClassName
    ? `        storageClassName: ${quote(dependency.storageClassName)}\n`
    : "";
}

function resources(profile: ResourceProfile, indent = 10): string {
  const pad = " ".repeat(indent);
  return `${pad}resources:
${pad}  requests:
${pad}    cpu: ${quote(profile.cpuRequest)}
${pad}    memory: ${quote(profile.memoryRequest)}
${pad}  limits:
${pad}    cpu: ${quote(profile.cpuLimit)}
${pad}    memory: ${quote(profile.memoryLimit)}
`;
}

function labels(name: string, indent = 4): string {
  const pad = " ".repeat(indent);
  return `${pad}app.kubernetes.io/name: ${name}
${pad}app.kubernetes.io/managed-by: podokit
`;
}

interface DependencyResources {
  manifest: string;
  rendered: RenderedDependency;
}

interface DependencyPod {
  name: string;
  secretName: string;
  image: string;
  args: string[] | null;
  /** The StatefulSet's `template:` block, starting at its two-space indent. */
  template: (image: string, rolloutStateChecksum: string) => string;
  /** The `volumeClaimTemplates:` block and anything after the StatefulSet. */
  rest: string;
}

/**
 * A dependency StatefulSet whose pods restart only for their own changes: their
 * image, their definition, or the one Secret they read. The rollout checksum is
 * kept at its live value while that Secret is unchanged, so the pod template stays
 * byte for byte what was applied, and the StatefulSet's own annotations, which
 * Kubernetes does not roll pods for, record what the checksum was derived from.
 */
function dependencyStatefulSet(
  profile: DeployProfileV1,
  state: KubernetesRolloutState,
  pod: DependencyPod,
): DependencyResources {
  const secretChecksum = workloadSecretChecksum(state, [pod.secretName]);
  const rolloutStateChecksum = state.keep[pod.name] ?? rolloutChecksum(secretChecksum);
  const definitionChecksum = digest([
    "dependency-definition",
    pod.template("<image>", "<rollout-state>"),
  ]);
  const manifest = `apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: ${pod.name}
  annotations:
    ${SECRET_CHECKSUM_ANNOTATION}: ${quote(secretChecksum)}
    ${DEFINITION_CHECKSUM_ANNOTATION}: ${quote(definitionChecksum)}
spec:
  serviceName: ${pod.name}
  replicas: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: ${pod.name}
${pod.template(pod.image, rolloutStateChecksum)}${pod.rest}`;
  return {
    manifest,
    rendered: {
      name: pod.name,
      image: pod.image,
      args: pod.args,
      secretName: pod.secretName,
      imagePullSecret: profile.secrets.imagePull,
      secretChecksum,
      rolloutChecksum: rolloutStateChecksum,
      definitionChecksum,
    },
  };
}

function volumeClaimTemplates(dependency: StatefulDependencyProfile): string {
  return `  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
${storageClassLine(dependency)}        accessModes: [ReadWriteOnce]
        resources:
          requests:
            storage: ${quote(dependency.storageSize)}
`;
}

function postgresResources(
  profile: DeployProfileV1,
  image: string | null,
  state: KubernetesRolloutState,
): DependencyResources | null {
  const dependency = profile.dependencies.postgres;
  if (dependency.mode !== "inCluster") return null;
  const name = `${profile.target.release}-postgres`;
  const args = dependency.maxConnections === undefined
    ? null
    : ["-c", `max_connections=${dependency.maxConnections}`];
  const statefulSet = dependencyStatefulSet(profile, state, {
    name,
    secretName: dependency.secretName,
    image: image ?? dependency.image,
    args,
    template: (podImage, rolloutStateChecksum) => `  template:
    metadata:
${podTemplateAnnotations(rolloutStateChecksum)}
      labels:
${labels(name, 8)}    spec:
      imagePullSecrets:
        - name: ${profile.secrets.imagePull}
      securityContext:
        fsGroup: 70
        seccompProfile: { type: RuntimeDefault }
      containers:
        - name: postgres
          image: ${quote(podImage)}
          imagePullPolicy: IfNotPresent
${args === null ? "" : `          args: ["-c", ${quote(args[1]!)}]\n`}          env:
            - name: POSTGRES_USER
              valueFrom:
                secretKeyRef: { name: ${dependency.secretName}, key: POSTGRES_USER }
            - name: POSTGRES_PASSWORD
              valueFrom:
                secretKeyRef: { name: ${dependency.secretName}, key: POSTGRES_PASSWORD }
            - name: POSTGRES_DB
              valueFrom:
                secretKeyRef: { name: ${dependency.secretName}, key: POSTGRES_DB }
          ports:
            - { name: postgres, containerPort: 5432 }
          readinessProbe:
            exec:
              command: [sh, -c, 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"']
            periodSeconds: 5
          livenessProbe:
            exec:
              command: [sh, -c, 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"']
            initialDelaySeconds: 30
            periodSeconds: 10
          resources:
            requests: { cpu: "250m", memory: "512Mi" }
            limits: { cpu: "2000m", memory: "2Gi" }
          volumeMounts:
            - { name: data, mountPath: /var/lib/postgresql/data }
`,
    rest: volumeClaimTemplates(dependency),
  });
  return {
    ...statefulSet,
    manifest: `apiVersion: v1
kind: Service
metadata:
  name: ${name}
  labels:
${labels(name)}spec:
  selector:
    app.kubernetes.io/name: ${name}
  ports:
    - name: postgres
      port: 5432
      targetPort: 5432
---
${statefulSet.manifest}`,
  };
}

function redisResources(
  profile: DeployProfileV1,
  image: string | null,
  state: KubernetesRolloutState,
): DependencyResources | null {
  const dependency = profile.dependencies.redis;
  if (dependency.mode !== "inCluster") return null;
  const name = `${profile.target.release}-redis`;
  const statefulSet = dependencyStatefulSet(profile, state, {
    name,
    secretName: dependency.secretName,
    image: image ?? dependency.image,
    args: null,
    template: (podImage, rolloutStateChecksum) => `  template:
    metadata:
${podTemplateAnnotations(rolloutStateChecksum)}
      labels:
${labels(name, 8)}    spec:
      imagePullSecrets:
        - name: ${profile.secrets.imagePull}
      securityContext:
        fsGroup: 1000
        seccompProfile: { type: RuntimeDefault }
      containers:
        - name: redis
          image: ${quote(podImage)}
          imagePullPolicy: IfNotPresent
          command: [sh, -c, 'exec redis-server --appendonly yes --dir /data --requirepass "$REDIS_PASSWORD"']
          env:
            - name: REDIS_PASSWORD
              valueFrom:
                secretKeyRef: { name: ${dependency.secretName}, key: REDIS_PASSWORD }
          ports:
            - { name: redis, containerPort: 6379 }
          readinessProbe:
            exec:
              command: [sh, -c, 'redis-cli -a "$REDIS_PASSWORD" --no-auth-warning ping | grep -qx PONG']
            periodSeconds: 5
          livenessProbe:
            exec:
              command: [sh, -c, 'redis-cli -a "$REDIS_PASSWORD" --no-auth-warning ping | grep -qx PONG']
            initialDelaySeconds: 20
            periodSeconds: 10
          resources:
            requests: { cpu: "50m", memory: "64Mi" }
            limits: { cpu: "500m", memory: "256Mi" }
          volumeMounts:
            - { name: data, mountPath: /data }
`,
    rest: volumeClaimTemplates(dependency),
  });
  return {
    ...statefulSet,
    manifest: `apiVersion: v1
kind: Service
metadata:
  name: ${name}
spec:
  selector:
    app.kubernetes.io/name: ${name}
  ports:
    - name: redis
      port: 6379
      targetPort: 6379
---
${statefulSet.manifest}`,
  };
}

function objectStorageResources(
  profile: DeployProfileV1,
  image: string | null,
  clientImage: string | null,
  state: KubernetesRolloutState,
): DependencyResources | null {
  const dependency = profile.dependencies.objectStorage;
  if (dependency.mode !== "inCluster") return null;
  const name = `${profile.target.release}-minio`;
  const initializationHash = createHash("sha256")
    .update(`${clientImage ?? dependency.clientImage}\0${dependency.bucket}`)
    .digest("hex")
    .slice(0, 8);
  const statefulSet = dependencyStatefulSet(profile, state, {
    name,
    secretName: dependency.secretName,
    image: image ?? dependency.image,
    args: ["server", "/data"],
    template: (podImage, rolloutStateChecksum) => `  template:
    metadata:
${podTemplateAnnotations(rolloutStateChecksum)}
      labels:
${labels(name, 8)}    spec:
      imagePullSecrets:
        - name: ${profile.secrets.imagePull}
      securityContext:
        fsGroup: 1000
        seccompProfile: { type: RuntimeDefault }
      containers:
        - name: minio
          image: ${quote(podImage)}
          imagePullPolicy: IfNotPresent
          args: [server, /data]
          env:
            - name: MINIO_ROOT_USER
              valueFrom:
                secretKeyRef: { name: ${dependency.secretName}, key: MINIO_ROOT_USER }
            - name: MINIO_ROOT_PASSWORD
              valueFrom:
                secretKeyRef: { name: ${dependency.secretName}, key: MINIO_ROOT_PASSWORD }
          ports:
            - { name: api, containerPort: 9000 }
          readinessProbe:
            httpGet: { path: /minio/health/ready, port: 9000 }
            periodSeconds: 5
          livenessProbe:
            httpGet: { path: /minio/health/live, port: 9000 }
            initialDelaySeconds: 20
            periodSeconds: 10
          resources:
            requests: { cpu: "250m", memory: "512Mi" }
            limits: { cpu: "2000m", memory: "2Gi" }
          volumeMounts:
            - { name: data, mountPath: /data }
`,
    rest: `${volumeClaimTemplates(dependency)}---
apiVersion: batch/v1
kind: Job
metadata:
  name: ${profile.target.release}-minio-init-${initializationHash}
  labels:
${labels(`${profile.target.release}-minio-initialize`)}spec:
  backoffLimit: 6
  ttlSecondsAfterFinished: 600
  template:
    metadata:
      labels:
${labels(`${profile.target.release}-minio-initialize`, 8)}    spec:
      imagePullSecrets:
        - name: ${profile.secrets.imagePull}
      restartPolicy: OnFailure
      securityContext:
        seccompProfile: { type: RuntimeDefault }
      containers:
        - name: initialize
          image: ${quote(clientImage ?? dependency.clientImage)}
          imagePullPolicy: IfNotPresent
          command:
            - sh
            - -ec
            - |
              until mc alias set target http://${name}:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"; do sleep 2; done
              mc mb --ignore-existing target/${dependency.bucket}
              cat >/tmp/policy.json <<'POLICY'
              {"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["s3:GetBucketLocation","s3:ListBucket"],"Resource":["arn:aws:s3:::${dependency.bucket}"]},{"Effect":"Allow","Action":["s3:GetObject","s3:PutObject","s3:DeleteObject"],"Resource":["arn:aws:s3:::${dependency.bucket}/*"]}]}
              POLICY
              mc admin policy create target podokit-app /tmp/policy.json || mc admin policy info target podokit-app
              mc admin user add target "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY" || true
              mc admin policy attach target podokit-app --user "$S3_ACCESS_KEY_ID"
          env:
            - name: MINIO_ROOT_USER
              valueFrom:
                secretKeyRef: { name: ${dependency.secretName}, key: MINIO_ROOT_USER }
            - name: MINIO_ROOT_PASSWORD
              valueFrom:
                secretKeyRef: { name: ${dependency.secretName}, key: MINIO_ROOT_PASSWORD }
            - name: S3_ACCESS_KEY_ID
              valueFrom:
                secretKeyRef: { name: ${dependency.secretName}, key: S3_ACCESS_KEY_ID }
            - name: S3_SECRET_ACCESS_KEY
              valueFrom:
                secretKeyRef: { name: ${dependency.secretName}, key: S3_SECRET_ACCESS_KEY }
`,
  });
  return {
    ...statefulSet,
    manifest: `apiVersion: v1
kind: Service
metadata:
  name: ${name}
spec:
  selector:
    app.kubernetes.io/name: ${name}
  ports:
    - { name: api, port: 9000, targetPort: 9000 }
---
${statefulSet.manifest}`,
  };
}

/** The dependency chart's resources, and what each StatefulSet was rendered from. */
export function renderDependencies(
  profile: DeployProfileV1,
  images: Pick<DeploymentImages, "postgres" | "redis" | "objectStorage" | "objectStorageClient">,
  state: KubernetesRolloutState,
): { manifest: string; dependencies: RenderedDependency[] } {
  const resources = [
    postgresResources(profile, images.postgres, state),
    redisResources(profile, images.redis, state),
    objectStorageResources(profile, images.objectStorage, images.objectStorageClient, state),
  ].filter((entry): entry is DependencyResources => entry !== null);
  return {
    manifest: resources.map((entry) => entry.manifest).join("\n---\n"),
    dependencies: resources.map((entry) => entry.rendered),
  };
}

/** The Ingress controller appends its peer: the client, or the last edge proxy. */
export function kubernetesProxyTrust(profile: DeployProfileV1): Record<string, string> {
  return proxyTrustConfig(profile.exposure.edgeProxies + (profile.exposure.mode === "ingress" ? 1 : 0));
}

function derivedRuntimeConfig(
  profile: DeployProfileV1,
  proxyTimeouts: AppProxyTimeouts,
): Record<string, string> {
  const result: Record<string, string> = {
    PORT: "3000",
    BACKEND_INTERNAL_URL: `http://${profile.target.release}-api:3000`,
    ...idleTimeoutConfig(profile.runtimeConfig, proxyTimeouts),
    ...kubernetesProxyTrust(profile),
    ...profile.runtimeConfig,
  };
  if (profile.dependencies.postgres.mode === "inCluster") {
    result.POSTGRES_HOST = `${profile.target.release}-postgres`;
    result.POSTGRES_PORT = "5432";
  }
  if (profile.dependencies.redis.mode === "inCluster") {
    result.REDIS_HOST = `${profile.target.release}-redis`;
    result.REDIS_PORT = "6379";
  }
  if (profile.dependencies.objectStorage.mode === "inCluster") {
    result.S3_ENDPOINT = `http://${profile.target.release}-minio:9000`;
    result.S3_BUCKET = profile.dependencies.objectStorage.bucket;
    result.S3_FORCE_PATH_STYLE = "true";
  }
  return result;
}

function sortedRuntimeConfig(runtimeConfig: Record<string, string>): [string, string][] {
  return Object.entries(runtimeConfig).sort(([left], [right]) => left.localeCompare(right));
}

function configMap(profile: DeployProfileV1, runtimeConfig: Record<string, string>): string {
  const entries = sortedRuntimeConfig(runtimeConfig);
  return `apiVersion: v1
kind: ConfigMap
metadata:
  name: ${profile.target.release}-runtime
${entries.length ? `data:\n${entries.map(([key, value]) => `  ${key}: ${quote(value)}`).join("\n")}` : "data: {}"}
`;
}

// Every rendered API and web probe allows 2 s instead of the Kubernetes default
// of 1 s: above the API's 800 ms per-check readiness bound, and enough for a busy
// web server.
const PROBE_TIMEOUT_SECONDS = 2;

// A terminating pod still receives new connections until every node and the
// ingress controller drop it from the Service's endpoints, while the API and web
// servers stop accepting them on SIGTERM. The kubelet runs this sleep before it
// sends SIGTERM, so the pod keeps serving meanwhile. PodoKit's API and web images
// are Alpine-based and ship /bin/sleep; an exec hook works on every Kubernetes
// version, unlike the sleep action.
const PRE_STOP_SLEEP_SECONDS = 5;
// The API and web servers end their streams on SIGTERM, drain in-flight requests
// for SHUTDOWN_TIMEOUT seconds (30 unless set), which covers the /api proxy's
// default 30 s wait, and then force-close for up to one more; the API then closes
// its services within three. The grace period also counts the preStop sleep.
const SHUTDOWN_MARGIN_SECONDS = 5;

function terminationGracePeriodSeconds(runtimeConfig: Record<string, string>): number {
  return PRE_STOP_SLEEP_SECONDS + shutdownDrainSeconds(runtimeConfig) + SHUTDOWN_MARGIN_SECONDS;
}

function deployment(
  profile: DeployProfileV1,
  kind: "api" | "web",
  workload: WorkloadProfile,
  image: string,
  rolloutStateChecksum: string,
  runtimeConfigDigest: string,
  gracePeriodSeconds: number,
): string {
  const name = `${profile.target.release}-${kind}`;
  const workloadSecret = kind === "api" ? profile.secrets.api : profile.secrets.web;
  const secretEnvFrom = workloadSecret
    ? `            - secretRef: { name: ${workloadSecret.name} }
`
    : "";
  const probe =
    kind === "api"
      ? `          readinessProbe:
            httpGet: { path: /health/ready, port: 3000 }
            periodSeconds: 5
            timeoutSeconds: ${PROBE_TIMEOUT_SECONDS}
          livenessProbe:
            httpGet: { path: /health, port: 3000 }
            initialDelaySeconds: 20
            periodSeconds: 10
            timeoutSeconds: ${PROBE_TIMEOUT_SECONDS}
          startupProbe:
            httpGet: { path: /health, port: 3000 }
            failureThreshold: 30
            periodSeconds: 2
            timeoutSeconds: ${PROBE_TIMEOUT_SECONDS}
`
      : // The web server's own route: an API outage must not take the web pods
        // out of service or restart them.
        `          readinessProbe:
            httpGet: { path: /healthz, port: 3000 }
            periodSeconds: 5
            timeoutSeconds: ${PROBE_TIMEOUT_SECONDS}
          livenessProbe:
            httpGet: { path: /healthz, port: 3000 }
            initialDelaySeconds: 20
            periodSeconds: 10
            timeoutSeconds: ${PROBE_TIMEOUT_SECONDS}
`;
  return `apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${name}
  labels:
${labels(name)}spec:
  replicas: ${workload.replicas}
  strategy:
    type: RollingUpdate
    rollingUpdate: { maxUnavailable: 0, maxSurge: 1 }
  selector:
    matchLabels:
      app.kubernetes.io/name: ${name}
  template:
    metadata:
${podTemplateAnnotations(rolloutStateChecksum, runtimeConfigDigest)}
      labels:
${labels(name, 8)}    spec:
      imagePullSecrets:
        - name: ${profile.secrets.imagePull}
      securityContext:
        runAsNonRoot: true
        runAsUser: 100
        runAsGroup: 101
        seccompProfile: { type: RuntimeDefault }
      terminationGracePeriodSeconds: ${gracePeriodSeconds}
      containers:
        - name: ${kind}
          image: ${quote(image)}
          imagePullPolicy: IfNotPresent
          securityContext:
            allowPrivilegeEscalation: false
            capabilities: { drop: [ALL] }
          envFrom:
            - configMapRef: { name: ${profile.target.release}-runtime }
${secretEnvFrom}          ports:
            - { name: http, containerPort: 3000 }
          lifecycle:
            preStop:
              exec: { command: [sleep, "${PRE_STOP_SLEEP_SECONDS}"] }
${probe}${resources(workload.resources)}---
apiVersion: v1
kind: Service
metadata:
  name: ${name}
spec:
  selector:
    app.kubernetes.io/name: ${name}
  ports:
    - { name: http, port: 3000, targetPort: 3000 }
`;
}

function workerDeployment(
  profile: DeployProfileV1,
  image: string,
  rolloutStateChecksum: string,
  runtimeConfigDigest: string,
  command: string[],
): string {
  const workload = profile.workloads.worker;
  if (!workload) return "";
  const name = `${profile.target.release}-worker`;
  return `apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${name}
  labels:
${labels(name)}spec:
  replicas: ${workload.replicas}
  strategy:
    type: RollingUpdate
    rollingUpdate: { maxUnavailable: 0, maxSurge: 1 }
  selector:
    matchLabels:
      app.kubernetes.io/name: ${name}
  template:
    metadata:
${podTemplateAnnotations(rolloutStateChecksum, runtimeConfigDigest)}
      labels:
${labels(name, 8)}    spec:
      imagePullSecrets:
        - name: ${profile.secrets.imagePull}
      securityContext:
        runAsNonRoot: true
        runAsUser: 100
        runAsGroup: 101
        seccompProfile: { type: RuntimeDefault }
      containers:
        - name: worker
          image: ${quote(image)}
          imagePullPolicy: IfNotPresent
          command: ${yamlStringSequence(command)}
          envFrom:
            - configMapRef: { name: ${profile.target.release}-runtime }
            - secretRef: { name: ${profile.secrets.api.name} }
          securityContext:
            allowPrivilegeEscalation: false
            capabilities: { drop: [ALL] }
${resources(workload.resources)}`;
}

function disruptionBudget(profile: DeployProfileV1, kind: "api" | "web" | "worker"): string {
  const workload = profile.workloads[kind];
  if (!workload || workload.replicas < 2) return "";
  const name = `${profile.target.release}-${kind}`;
  return `apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: ${name}
spec:
  minAvailable: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: ${name}
`;
}

function ingressPath(path: string, pathType: string, service: string): string {
  return `          - path: ${quote(path)}
            pathType: ${pathType}
            backend:
              service:
                name: ${service}
                port: { number: 3000 }
`;
}

/**
 * Direct API paths need /api removed on the way to the API, which a standard
 * Ingress cannot express, so they get their own Ingress with a Traefik
 * stripPrefix middleware. ImplementationSpecific makes Traefik match the
 * trailing-slash prefix as a plain PathPrefix, and the Exact path adds the bare
 * path, so every controller version routes the same set of requests.
 */
function apiPathIngress(profile: DeployProfileV1, tls: string): string {
  if (profile.exposure.apiPaths.length === 0) return "";
  const apiService = `${profile.target.release}-api`;
  const middleware = `${profile.target.release}-strip-api-prefix`;
  const paths = profile.exposure.apiPaths
    .map((path) => {
      const base = apiPathBase(path);
      return (
        ingressPath(base, "Exact", apiService) +
        ingressPath(`${base}/`, "ImplementationSpecific", apiService)
      );
    })
    .join("");
  return `---
apiVersion: traefik.io/v1alpha1
kind: Middleware
metadata:
  name: ${middleware}
spec:
  stripPrefix:
    prefixes: [${quote(API_PATH_PREFIX)}]
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: ${profile.target.release}-api-paths
  annotations:
    traefik.ingress.kubernetes.io/router.middlewares: ${quote(`${profile.target.namespace}-${middleware}@kubernetescrd`)}
spec:
  ingressClassName: ${quote(profile.exposure.ingressClassName)}
${tls}  rules:
    - host: ${quote(profile.exposure.host)}
      http:
        paths:
${paths}`;
}

function exposure(profile: DeployProfileV1): string {
  const webService = `${profile.target.release}-web`;
  const apiService = `${profile.target.release}-api`;
  if (profile.exposure.mode === "nodePort") {
    return `apiVersion: v1
kind: Service
metadata:
  name: ${webService}-public
spec:
  type: NodePort
  selector:
    app.kubernetes.io/name: ${webService}
  ports:
    - { name: http, port: 80, targetPort: 3000 }
`;
  }
  const tls = profile.exposure.tlsSecretName
    ? `  tls:
    - hosts: [${quote(profile.exposure.host)}]
      secretName: ${quote(profile.exposure.tlsSecretName)}
`
    : "";
  const webSocketPaths = profile.exposure.webSocketPaths
    .map((path) => ingressPath(path, "Exact", apiService))
    .join("");
  return `apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: ${profile.target.release}
spec:
  ingressClassName: ${quote(profile.exposure.ingressClassName)}
${tls}  rules:
    - host: ${quote(profile.exposure.host)}
      http:
        paths:
${webSocketPaths}          - path: /
            pathType: Prefix
            backend:
              service:
                name: ${webService}
                port: { number: 3000 }
${apiPathIngress(profile, tls)}`;
}

function applicationManifest(
  profile: DeployProfileV1,
  images: DeploymentImages,
  state: KubernetesRolloutState,
  workerCommand: string[],
  runtimeConfig: Record<string, string>,
): string {
  const runtimeConfigDigest = digest(["runtime-config", JSON.stringify(sortedRuntimeConfig(runtimeConfig))]);
  const gracePeriodSeconds = terminationGracePeriodSeconds(runtimeConfig);
  const secrets = workloadSecrets(profile);
  const checksum = (kind: "api" | "web" | "worker"): string =>
    rolloutChecksum(workloadSecretChecksum(state, secrets[`${profile.target.release}-${kind}`] ?? []));
  return [
    configMap(profile, runtimeConfig),
    deployment(
      profile,
      "api",
      profile.workloads.api,
      images.api,
      checksum("api"),
      runtimeConfigDigest,
      gracePeriodSeconds,
    ),
    deployment(
      profile,
      "web",
      profile.workloads.web,
      images.web,
      checksum("web"),
      runtimeConfigDigest,
      gracePeriodSeconds,
    ),
    workerDeployment(
      profile,
      images.api,
      checksum("worker"),
      runtimeConfigDigest,
      workerCommand,
    ),
    disruptionBudget(profile, "api"),
    disruptionBudget(profile, "web"),
    profile.workloads.worker ? disruptionBudget(profile, "worker") : "",
    exposure(profile),
  ]
    .filter(Boolean)
    .join("\n---\n");
}

function migrationRuntimeEnv(runtimeConfig: Record<string, string>): string {
  return sortedRuntimeConfig(runtimeConfig)
    .map(
      ([key, value]) => `            - name: ${key}
              value: ${quote(value)}`,
    )
    .join("\n");
}

function migrationManifest(
  profile: DeployProfileV1,
  release: string,
  images: DeploymentImages,
  defaultCommand: string[],
  runtimeConfig: Record<string, string>,
): string {
  const releaseSlug = release.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const command = profile.migration?.command ?? defaultCommand;
  return `apiVersion: batch/v1
kind: Job
metadata:
  name: ${profile.target.release}-migrate-${releaseSlug}
  namespace: ${profile.target.namespace}
  labels:
${labels(`${profile.target.release}-migration`)}spec:
  # A failed migration is not retried: apply reports it with the pod's log
  # instead of starting it again after a back-off.
  backoffLimit: 0
  ttlSecondsAfterFinished: 3600
  template:
    metadata:
      labels:
${labels(`${profile.target.release}-migration`, 8)}    spec:
      restartPolicy: Never
      imagePullSecrets:
        - name: ${profile.secrets.imagePull}
      securityContext:
        runAsNonRoot: true
        runAsUser: 100
        runAsGroup: 101
        seccompProfile: { type: RuntimeDefault }
      containers:
        - name: migrate
          image: ${quote(images.api)}
          imagePullPolicy: IfNotPresent
          command: ${yamlStringSequence(command)}
          env:
${migrationRuntimeEnv(runtimeConfig)}
          envFrom:
            - secretRef: { name: ${profile.secrets.api.name} }
          securityContext:
            allowPrivilegeEscalation: false
            capabilities: { drop: [ALL] }
`;
}

function chart(directory: string, name: string, manifest: string): void {
  mkdirSync(join(directory, "templates"), { recursive: true });
  writeFileSync(
    join(directory, "Chart.yaml"),
    `apiVersion: v2\nname: ${name}\ndescription: Generated by PodoKit\nversion: 0.1.0\ntype: application\n`,
  );
  writeFileSync(join(directory, "resources.yaml"), manifest || "# No resources\n");
  writeFileSync(
    join(directory, "templates", "resources.yaml"),
    '{{ .Files.Get "resources.yaml" }}\n',
  );
}

export function renderDeployment(
  projectRoot: string,
  profileName: string,
  profile: DeployProfileV1,
  release: string,
  resolvedImages?: DeploymentImages,
  rolloutState?: KubernetesRolloutState,
  // Planning renders into a scratch directory, so it reads these from the project.
  proxyTimeouts: AppProxyTimeouts = readAppProxyTimeouts(projectRoot),
): DeploymentRuntime {
  profilePath(projectRoot, profileName);
  const images: DeploymentImages = resolvedImages ?? {
    api: `${profile.release.apiRepository}:${release}`,
    web: `${profile.release.webRepository}:${release}`,
    postgres:
      profile.dependencies.postgres.mode === "inCluster"
        ? profile.dependencies.postgres.image
        : null,
    redis:
      profile.dependencies.redis.mode === "inCluster"
        ? profile.dependencies.redis.image
        : null,
    objectStorage:
      profile.dependencies.objectStorage.mode === "inCluster"
        ? profile.dependencies.objectStorage.image
        : null,
    objectStorageClient:
      profile.dependencies.objectStorage.mode === "inCluster"
        ? profile.dependencies.objectStorage.clientImage
        : null,
  };
  const root = join(resolve(projectRoot), ".podokit", "runtime", "deploy", profileName);
  rmSync(root, { recursive: true, force: true });
  const dependencyChart = join(root, "dependencies");
  const applicationChart = join(root, "application");
  const state = rolloutState ?? offlineRolloutState(profile);
  const dependencies = renderDependencies(profile, images, state);
  const toolchain = readManifest(projectRoot)?.toolchain ?? resolveToolchain();
  const runtimeConfig = derivedRuntimeConfig(profile, proxyTimeouts);
  const application = applicationManifest(
    profile,
    images,
    state,
    toolchainWorkerCommand(toolchain),
    runtimeConfig,
  );
  const migration = migrationManifest(
    profile,
    release,
    images,
    toolchainMigrationCommand(toolchain),
    runtimeConfig,
  );
  chart(dependencyChart, "podokit-dependencies", dependencies.manifest);
  chart(applicationChart, "podokit-application", application);
  writeFileSync(join(root, "migration.yaml"), migration);
  return {
    root,
    dependencyChart,
    applicationChart,
    migrationManifest: join(root, "migration.yaml"),
    dependencyManifest: dependencies.manifest,
    applicationManifest: application,
    dependencies: dependencies.dependencies,
  };
}
