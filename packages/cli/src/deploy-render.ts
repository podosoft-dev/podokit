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
import { readManifest } from "./lockfile";
import { resolveToolchain, toolchainMigrationCommand } from "./toolchain";

export interface DeploymentRuntime {
  root: string;
  dependencyChart: string;
  applicationChart: string;
  migrationManifest: string;
  dependencyManifest: string;
  applicationManifest: string;
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

function offlineRolloutStateDigest(profile: DeployProfileV1): string {
  const secretNames = [
    profile.secrets.api.name,
    ...(profile.secrets.web ? [profile.secrets.web.name] : []),
    profile.secrets.imagePull,
    ...(profile.exposure.tlsSecretName ? [profile.exposure.tlsSecretName] : []),
    profile.dependencies.postgres.secretName,
    profile.dependencies.redis.secretName,
    profile.dependencies.objectStorage.secretName,
  ].sort();
  return digest(["offline-rollout-state", JSON.stringify(secretNames)]);
}

function podTemplateAnnotations(
  rolloutStateDigest: string,
  runtimeConfigDigest?: string,
): string {
  const annotations = [
    `podokit.example.com/rollout-state-checksum: ${quote(
      digest(["rollout-state", rolloutStateDigest]),
    )}`,
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

function postgresResources(
  profile: DeployProfileV1,
  image: string | null,
  rolloutStateDigest: string,
): string {
  const dependency = profile.dependencies.postgres;
  if (dependency.mode !== "inCluster") return "";
  const name = `${profile.target.release}-postgres`;
  return `apiVersion: v1
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
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: ${name}
spec:
  serviceName: ${name}
  replicas: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: ${name}
  template:
    metadata:
${podTemplateAnnotations(rolloutStateDigest)}
      labels:
${labels(name, 8)}    spec:
      imagePullSecrets:
        - name: ${profile.secrets.imagePull}
      securityContext:
        fsGroup: 70
        seccompProfile: { type: RuntimeDefault }
      containers:
        - name: postgres
          image: ${quote(image ?? dependency.image)}
          imagePullPolicy: IfNotPresent
          env:
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
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
${storageClassLine(dependency)}        accessModes: [ReadWriteOnce]
        resources:
          requests:
            storage: ${quote(dependency.storageSize)}
`;
}

function redisResources(
  profile: DeployProfileV1,
  image: string | null,
  rolloutStateDigest: string,
): string {
  const dependency = profile.dependencies.redis;
  if (dependency.mode !== "inCluster") return "";
  const name = `${profile.target.release}-redis`;
  return `apiVersion: v1
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
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: ${name}
spec:
  serviceName: ${name}
  replicas: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: ${name}
  template:
    metadata:
${podTemplateAnnotations(rolloutStateDigest)}
      labels:
${labels(name, 8)}    spec:
      imagePullSecrets:
        - name: ${profile.secrets.imagePull}
      securityContext:
        fsGroup: 1000
        seccompProfile: { type: RuntimeDefault }
      containers:
        - name: redis
          image: ${quote(image ?? dependency.image)}
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
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
${storageClassLine(dependency)}        accessModes: [ReadWriteOnce]
        resources:
          requests:
            storage: ${quote(dependency.storageSize)}
`;
}

function objectStorageResources(
  profile: DeployProfileV1,
  image: string | null,
  clientImage: string | null,
  rolloutStateDigest: string,
): string {
  const dependency = profile.dependencies.objectStorage;
  if (dependency.mode !== "inCluster") return "";
  const name = `${profile.target.release}-minio`;
  const initializationHash = createHash("sha256")
    .update(`${clientImage ?? dependency.clientImage}\0${dependency.bucket}`)
    .digest("hex")
    .slice(0, 8);
  return `apiVersion: v1
kind: Service
metadata:
  name: ${name}
spec:
  selector:
    app.kubernetes.io/name: ${name}
  ports:
    - { name: api, port: 9000, targetPort: 9000 }
---
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: ${name}
spec:
  serviceName: ${name}
  replicas: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: ${name}
  template:
    metadata:
${podTemplateAnnotations(rolloutStateDigest)}
      labels:
${labels(name, 8)}    spec:
      imagePullSecrets:
        - name: ${profile.secrets.imagePull}
      securityContext:
        fsGroup: 1000
        seccompProfile: { type: RuntimeDefault }
      containers:
        - name: minio
          image: ${quote(image ?? dependency.image)}
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
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
${storageClassLine(dependency)}        accessModes: [ReadWriteOnce]
        resources:
          requests:
            storage: ${quote(dependency.storageSize)}
---
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
`;
}

function dependencyManifest(
  profile: DeployProfileV1,
  images: DeploymentImages,
  rolloutStateDigest: string,
): string {
  return [
    postgresResources(profile, images.postgres, rolloutStateDigest),
    redisResources(profile, images.redis, rolloutStateDigest),
    objectStorageResources(
      profile,
      images.objectStorage,
      images.objectStorageClient,
      rolloutStateDigest,
    ),
  ]
    .filter(Boolean)
    .join("\n---\n");
}

function derivedRuntimeConfig(profile: DeployProfileV1): Record<string, string> {
  const result: Record<string, string> = {
    PORT: "3000",
    BACKEND_INTERNAL_URL: `http://${profile.target.release}-api:3000`,
    PROTOCOL_HEADER: "x-forwarded-proto",
    HOST_HEADER: "x-forwarded-host",
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

function derivedRuntimeConfigDigest(profile: DeployProfileV1): string {
  const entries = Object.entries(derivedRuntimeConfig(profile)).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  return digest(["runtime-config", JSON.stringify(entries)]);
}

function configMap(profile: DeployProfileV1): string {
  const entries = Object.entries(derivedRuntimeConfig(profile)).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  return `apiVersion: v1
kind: ConfigMap
metadata:
  name: ${profile.target.release}-runtime
${entries.length ? `data:\n${entries.map(([key, value]) => `  ${key}: ${quote(value)}`).join("\n")}` : "data: {}"}
`;
}

function deployment(
  profile: DeployProfileV1,
  kind: "api" | "web",
  workload: WorkloadProfile,
  image: string,
  rolloutStateDigest: string,
  runtimeConfigDigest: string,
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
          livenessProbe:
            httpGet: { path: /health, port: 3000 }
            initialDelaySeconds: 20
            periodSeconds: 10
          startupProbe:
            httpGet: { path: /health, port: 3000 }
            failureThreshold: 30
            periodSeconds: 2
`
      : `          readinessProbe:
            httpGet: { path: /, port: 3000 }
            periodSeconds: 5
          livenessProbe:
            httpGet: { path: /, port: 3000 }
            initialDelaySeconds: 20
            periodSeconds: 10
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
${podTemplateAnnotations(rolloutStateDigest, runtimeConfigDigest)}
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
  rolloutStateDigest: string,
  runtimeConfigDigest: string,
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
${podTemplateAnnotations(rolloutStateDigest, runtimeConfigDigest)}
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
          command: [node, dist/main-worker]
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
    .map(
      (path) => `          - path: ${quote(path)}
            pathType: Exact
            backend:
              service:
                name: ${apiService}
                port: { number: 3000 }
`,
    )
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
`;
}

function applicationManifest(
  profile: DeployProfileV1,
  images: DeploymentImages,
  rolloutStateDigest: string,
): string {
  const runtimeConfigDigest = derivedRuntimeConfigDigest(profile);
  return [
    configMap(profile),
    deployment(
      profile,
      "api",
      profile.workloads.api,
      images.api,
      rolloutStateDigest,
      runtimeConfigDigest,
    ),
    deployment(
      profile,
      "web",
      profile.workloads.web,
      images.web,
      rolloutStateDigest,
      runtimeConfigDigest,
    ),
    workerDeployment(profile, images.api, rolloutStateDigest, runtimeConfigDigest),
    disruptionBudget(profile, "api"),
    disruptionBudget(profile, "web"),
    profile.workloads.worker ? disruptionBudget(profile, "worker") : "",
    exposure(profile),
  ]
    .filter(Boolean)
    .join("\n---\n");
}

function migrationRuntimeEnv(profile: DeployProfileV1): string {
  return Object.entries(derivedRuntimeConfig(profile))
    .sort(([left], [right]) => left.localeCompare(right))
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
  backoffLimit: 1
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
${migrationRuntimeEnv(profile)}
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
  rolloutStateDigest?: string,
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
  const effectiveRolloutStateDigest =
    rolloutStateDigest ?? offlineRolloutStateDigest(profile);
  const dependencies = dependencyManifest(profile, images, effectiveRolloutStateDigest);
  const application = applicationManifest(profile, images, effectiveRolloutStateDigest);
  const toolchain = readManifest(projectRoot)?.toolchain ?? resolveToolchain();
  const migration = migrationManifest(
    profile,
    release,
    images,
    toolchainMigrationCommand(toolchain),
  );
  chart(dependencyChart, "podokit-dependencies", dependencies);
  chart(applicationChart, "podokit-application", application);
  writeFileSync(join(root, "migration.yaml"), migration);
  return {
    root,
    dependencyChart,
    applicationChart,
    migrationManifest: join(root, "migration.yaml"),
    dependencyManifest: dependencies,
    applicationManifest: application,
  };
}
