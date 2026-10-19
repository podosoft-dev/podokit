import {
  DEFINITION_CHECKSUM_ANNOTATION,
  ROLLOUT_STATE_ANNOTATION,
  SECRET_CHECKSUM_ANNOTATION,
  type RenderedDependency,
} from "./deploy-render";

/**
 * Which in-cluster dependencies an apply restarts, and why.
 *
 * A StatefulSet replaces its pod whenever its pod template changes, and a
 * single-replica database, Redis, or object store is unavailable meanwhile. Each
 * dependency's pod template therefore changes only for its own image, definition,
 * or Secret, and the plan compares the rendered StatefulSet with the live one to
 * say in advance which restart.
 */

/** What the plan needs from a live dependency StatefulSet. */
export interface LiveDependency {
  name: string;
  image: string | null;
  args: string[] | null;
  imagePullSecrets: string[];
  secretNames: string[];
  rolloutChecksum: string | null;
  /** Absent on a StatefulSet that PodoKit 1.6.5 or earlier applied. */
  secretChecksum: string | null;
  definitionChecksum: string | null;
}

export interface DependencyRollout {
  name: string;
  /** `create`: not running yet; `restart`: its pod is replaced; `keep`: its pod keeps running. */
  action: "create" | "restart" | "keep";
  reasons: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringList(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string") ? value : null;
}

function invalid(name: string): Error {
  return new Error(`Kubernetes StatefulSet ${name} has an invalid schema.`);
}

function liveDependency(resource: unknown, names: string[]): LiveDependency {
  if (!isRecord(resource) || !isRecord(resource.metadata) || typeof resource.metadata.name !== "string") {
    throw new Error("Kubernetes StatefulSets of the dependencies have an invalid schema.");
  }
  const name = resource.metadata.name;
  if (!names.includes(name)) throw new Error(`kubectl returned an unexpected StatefulSet ${name}.`);
  const annotations = resource.metadata.annotations;
  const spec = resource.spec;
  if (
    (annotations !== undefined && !isRecord(annotations)) ||
    !isRecord(spec) ||
    !isRecord(spec.template) ||
    !isRecord(spec.template.spec) ||
    (spec.template.metadata !== undefined && !isRecord(spec.template.metadata))
  ) {
    throw invalid(name);
  }
  const podAnnotations = spec.template.metadata?.annotations;
  if (podAnnotations !== undefined && !isRecord(podAnnotations)) throw invalid(name);
  const containers = spec.template.spec.containers;
  const container = Array.isArray(containers) ? containers[0] : undefined;
  if (!isRecord(container)) throw invalid(name);
  const args = container.args === undefined ? null : stringList(container.args);
  if (container.args !== undefined && args === null) throw invalid(name);
  const env = container.env ?? [];
  if (!Array.isArray(env)) throw invalid(name);
  const secretNames = new Set<string>();
  for (const variable of env) {
    const reference = isRecord(variable) && isRecord(variable.valueFrom) ? variable.valueFrom.secretKeyRef : undefined;
    if (isRecord(reference) && typeof reference.name === "string") secretNames.add(reference.name);
  }
  const pullSecrets = spec.template.spec.imagePullSecrets ?? [];
  if (!Array.isArray(pullSecrets)) throw invalid(name);
  const text = (record: Record<string, unknown> | undefined, key: string): string | null =>
    typeof record?.[key] === "string" ? record[key] : null;
  return {
    name,
    image: typeof container.image === "string" ? container.image : null,
    args,
    imagePullSecrets: pullSecrets
      .map((entry) => (isRecord(entry) && typeof entry.name === "string" ? entry.name : ""))
      .filter(Boolean),
    secretNames: [...secretNames].sort(),
    rolloutChecksum: text(podAnnotations, ROLLOUT_STATE_ANNOTATION),
    secretChecksum: text(annotations, SECRET_CHECKSUM_ANNOTATION),
    definitionChecksum: text(annotations, DEFINITION_CHECKSUM_ANNOTATION),
  };
}

/**
 * Parses `kubectl get statefulsets <names...> --ignore-not-found -o json`, which
 * prints nothing, one object, or a List depending on how many exist.
 */
export function parseLiveDependencies(output: string, names: string[]): Map<string, LiveDependency> {
  const result = new Map<string, LiveDependency>();
  if (!output.trim()) return result;
  let parsed: unknown;
  try {
    parsed = JSON.parse(output) as unknown;
  } catch {
    throw new Error("Kubernetes StatefulSets of the dependencies returned invalid JSON.");
  }
  const items = isRecord(parsed) && parsed.kind === "List" ? parsed.items : [parsed];
  if (!Array.isArray(items)) throw new Error("Kubernetes StatefulSets of the dependencies returned an invalid list.");
  for (const item of items) {
    const dependency = liveDependency(item, names);
    result.set(dependency.name, dependency);
  }
  return result;
}

/**
 * The rollout checksums dependencies keep at their live value.
 *
 * A StatefulSet this version applied records the checksum of its own Secret: it
 * keeps its value while that matches. One PodoKit 1.6.5 or earlier applied carries a
 * checksum over every Secret of the release instead (`legacyChecksum` recomputes
 * it from the current Secrets), so it keeps its value while that still matches,
 * and the first apply after upgrading restarts nothing that did not change.
 */
export function keptRolloutChecksums(
  live: Map<string, LiveDependency>,
  expected: Array<{ name: string; secretChecksum: string }>,
  legacyChecksum: string | null,
): Record<string, string> {
  const keep: Record<string, string> = {};
  for (const { name, secretChecksum } of expected) {
    const current = live.get(name);
    if (!current?.rolloutChecksum) continue;
    const unchanged = current.secretChecksum !== null
      ? current.secretChecksum === secretChecksum
      : legacyChecksum !== null && current.rolloutChecksum === legacyChecksum;
    if (unchanged) keep[name] = current.rolloutChecksum;
  }
  return keep;
}

function sameList(left: string[] | null, right: string[] | null): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Compares each rendered dependency StatefulSet with the live one.
 *
 * `sameImage` lets the doctor, which does not resolve digests, compare a tag with
 * a live digest-pinned reference.
 */
export function dependencyRollouts(
  live: Map<string, LiveDependency>,
  rendered: RenderedDependency[],
  sameImage: (live: string | null, rendered: string) => boolean = (left, right) => left === right,
): DependencyRollout[] {
  return rendered.map((dependency) => {
    const current = live.get(dependency.name);
    if (!current) return { name: dependency.name, action: "create", reasons: ["it is not running yet"] };
    const reasons: string[] = [];
    if (!sameImage(current.image, dependency.image)) {
      reasons.push(`its image changes from ${current.image ?? "none"} to ${dependency.image}`);
    }
    if (current.rolloutChecksum !== dependency.rolloutChecksum) {
      reasons.push(
        current.rolloutChecksum === null
          ? "its pod template carries no PodoKit rollout checksum yet"
          : current.secretChecksum !== null
            ? `Secret ${dependency.secretName} changed since the last apply`
            : "a Secret of the release changed since the last apply, and the running StatefulSet carries the " +
              "checksum over every Secret that PodoKit 1.6.5 and earlier gave all workloads",
      );
    }
    const definition: string[] = [];
    if (!sameList(current.args, dependency.args)) {
      definition.push(
        `its arguments change from ${JSON.stringify(current.args ?? [])} to ${JSON.stringify(dependency.args ?? [])}`,
      );
    }
    if (!sameList(current.secretNames, [dependency.secretName])) {
      definition.push(`it reads Secret ${dependency.secretName} instead of ${current.secretNames.join(", ") || "none"}`);
    }
    if (!sameList(current.imagePullSecrets, [dependency.imagePullSecret])) {
      definition.push(`its image pull Secret changes to ${dependency.imagePullSecret}`);
    }
    if (
      definition.length === 0 &&
      current.definitionChecksum !== null &&
      current.definitionChecksum !== dependency.definitionChecksum
    ) {
      definition.push("this PodoKit version renders its pod template differently");
    }
    reasons.push(...definition);
    return { name: dependency.name, action: reasons.length ? "restart" : "keep", reasons };
  });
}

export function describeDependencyRollout(rollout: DependencyRollout): string {
  if (rollout.action === "keep") return `${rollout.name} keeps running: its image, pod template, and Secret are unchanged.`;
  if (rollout.action === "create") return `${rollout.name} is created: ${rollout.reasons.join("; ")}.`;
  return `${rollout.name} restarts: ${rollout.reasons.join("; ")}. With one replica it refuses connections until its new pod is ready.`;
}
