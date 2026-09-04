export interface ProgressPayload {
  steps?: number;
}

function payload(value: unknown): ProgressPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const steps = (value as Record<string, unknown>).steps;
  return typeof steps === "number" ? { steps } : {};
}

export async function processProgress(
  value: unknown,
  publish: (progress: number) => Promise<void>,
  delay: (milliseconds: number) => Promise<unknown> = Bun.sleep,
): Promise<{ done: true }> {
  const steps = payload(value).steps ?? 5;
  for (let index = 1; index <= steps; index += 1) {
    await delay(400);
    const progress = Math.round((index / steps) * 100);
    await publish(progress);
  }
  return { done: true };
}
