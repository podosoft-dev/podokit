import { existsSync } from "node:fs";
import { join } from "node:path";
import { readFilesLock, writeFilesLock } from "./lockfile";
import { NotAProjectError } from "./inspect";

/**
 * Take ownership of PodoKit-managed files: flip their lock tier to `owned` so
 * `podo update` skips them from then on (they show up only in `podo diff`).
 * File-level and reversible by re-recording, unlike CRA's one-way eject.
 */
export interface EjectResult {
  ejected: string[];
  /** Paths not tracked in the lock (nothing to eject). */
  unknown: string[];
}

export function eject(projectRoot: string, paths: string[]): EjectResult {
  const lock = readFilesLock(projectRoot);
  if (!lock) throw new NotAProjectError();
  const result: EjectResult = { ejected: [], unknown: [] };
  for (const path of paths) {
    const entry = lock.files[path];
    if (!entry || !existsSync(join(projectRoot, path))) {
      result.unknown.push(path);
      continue;
    }
    if (entry.tier !== "owned") {
      entry.tier = "owned";
      result.ejected.push(path);
    }
  }
  if (result.ejected.length) writeFilesLock(projectRoot, lock);
  return result;
}
