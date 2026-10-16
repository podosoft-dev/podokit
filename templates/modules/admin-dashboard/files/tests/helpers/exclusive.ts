import { mkdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Longer than any spec holds a lock, so a lock left by a killed run expires.
const STALE_MS = 120_000;

/**
 * Runs `body` while no other Playwright worker on this machine holds the lock
 * `name`. The api and ui projects run in parallel, so two specs that flip the
 * same instance-wide admin setting would otherwise undo each other mid-test.
 */
export async function exclusive<T>(name: string, body: () => Promise<T>): Promise<T> {
  const lock = join(tmpdir(), `podokit-e2e-${name}.lock`);
  for (;;) {
    try {
      await mkdir(lock);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const age = await stat(lock).then((info) => Date.now() - info.mtimeMs, () => 0);
      if (age > STALE_MS) await rm(lock, { recursive: true, force: true });
      else await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  try {
    return await body();
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}
