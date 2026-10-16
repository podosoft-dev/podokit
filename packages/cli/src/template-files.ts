import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, normalize, sep } from "node:path";
import { hashContent, type VfsFile } from "@podosoft/podokit-template-engine";
import {
  classifyTier,
  podokitVersion,
  writeFilesLock,
  writeManifest,
  type Tier,
} from "./lockfile";
import { declaredOwnedGlobs, targetProject } from "./update";
import { unifiedDiff } from "./text-diff";

/**
 * `podo diff <path>` and `podo restore <path>`: compare a working file with
 * what the installed CLI's templates generate for it, and put a managed or
 * ejected file back to that content.
 */

export type TemplateFileStatus = "same" | "differs" | "missing" | "not-generated";

export interface TemplateFileDiff {
  path: string;
  /** Ownership tier the lock records, or null for a file the lock does not track. */
  tier: Tier | null;
  status: TemplateFileStatus;
  /** Unified diff from the template to the working file; empty unless it differs. */
  diff: string;
  /** Whether either side is binary, so no line diff is shown. */
  binary: boolean;
}

export interface TemplateDiffResult {
  /** PodoKit version the project was generated or last updated with. */
  projectVersion: string;
  /** Version of the CLI whose templates were rendered. */
  templateVersion: string;
  files: TemplateFileDiff[];
}

/** Normalize a user-supplied path to the lock's POSIX project-relative form. */
export function projectPath(path: string): string {
  const normalized = normalize(path).split(sep).join("/").replace(/^\.\//, "");
  if (normalized.startsWith("../") || normalized === ".." || normalized.startsWith("/")) {
    throw new Error(`${path} is outside the project.`);
  }
  return normalized;
}

function isUtf8Text(content: Buffer): boolean {
  return !content.includes(0) && Buffer.from(content.toString("utf8"), "utf8").equals(content);
}

function fileBuffer(file: VfsFile): Buffer {
  return typeof file.content === "string" ? Buffer.from(file.content, "utf8") : file.content;
}

export function templateDiff(
  projectRoot: string,
  templatesDir: string,
  paths: string[],
): TemplateDiffResult {
  const target = targetProject(projectRoot, templatesDir);
  const templateVersion = podokitVersion();
  const files = paths.map((input): TemplateFileDiff => {
    const path = projectPath(input);
    const tier = target.lock.files[path]?.tier ?? null;
    const generated = target.tree.get(path);
    const abs = join(projectRoot, path);
    if (!generated) {
      return { path, tier, status: "not-generated", diff: "", binary: false };
    }
    if (!existsSync(abs)) return { path, tier, status: "missing", diff: "", binary: false };
    const templateBytes = fileBuffer(generated);
    const diskBytes = readFileSync(abs);
    if (templateBytes.equals(diskBytes)) {
      return { path, tier, status: "same", diff: "", binary: false };
    }
    const binary = !isUtf8Text(templateBytes) || !isUtf8Text(diskBytes);
    return {
      path,
      tier,
      status: "differs",
      binary,
      diff: binary
        ? ""
        : unifiedDiff(templateBytes.toString("utf8"), diskBytes.toString("utf8"), {
            fromLabel: `podokit-${templateVersion}/${path}`,
            toLabel: path,
          }),
    };
  });
  return { projectVersion: target.manifest.podokitVersion, templateVersion, files };
}

export interface RestoreResult {
  /** Files rewritten from the template. */
  restored: string[];
  /** Files that were ejected and are managed again. */
  remanaged: string[];
}

/**
 * Rewrite managed or assembled files with the template's content and record
 * that content as the lock baseline. A file that `podo eject` made owned is
 * handed back to PodoKit: its exact path leaves the manifest's owned paths, so
 * future updates manage it again. Files owned because a template or module
 * declares them owned, such as routes, are refused. Nothing is written unless
 * every path can be restored.
 */
export function restore(projectRoot: string, templatesDir: string, paths: string[]): RestoreResult {
  const target = targetProject(projectRoot, templatesDir);
  const cliVersion = podokitVersion();
  if (target.manifest.podokitVersion !== cliVersion) {
    throw new Error(
      `This project is on PodoKit ${target.manifest.podokitVersion} and this CLI renders ${cliVersion}. ` +
        "Run podo update --apply first, or restore with the CLI version the project is on.",
    );
  }
  const declared = new Set(declaredOwnedGlobs(projectRoot, templatesDir, target.modules));
  const requested = [...new Set(paths.map(projectPath))];
  const ejected = requested.filter(
    (path) => target.manifest.ownedGlobs.includes(path) && !declared.has(path),
  );
  const ownedGlobs = target.manifest.ownedGlobs.filter((glob) => !ejected.includes(glob));
  const classifyGlobs = [...new Set([...declared, ...ownedGlobs])];

  const writes: { path: string; file: VfsFile; tier: Tier }[] = [];
  for (const path of requested) {
    const file = target.tree.get(path);
    if (!file) throw new Error(`PodoKit does not generate ${path}, so there is nothing to restore.`);
    const tier = classifyTier(path, fileBuffer(file), classifyGlobs, target.managedOverrides);
    if (tier === "owned") {
      throw new Error(
        `${path} is owned by the application through the template or a module, so PodoKit never manages it. ` +
          `Run podo diff ${path} to see the template's version.`,
      );
    }
    writes.push({ path, file, tier });
  }

  for (const { path, file, tier } of writes) {
    const abs = join(projectRoot, path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, file.content);
    target.lock.files[path] = { tier, outHash: hashContent(fileBuffer(file)) };
  }
  writeFilesLock(projectRoot, target.lock);
  if (ejected.length) writeManifest(projectRoot, { ...target.manifest, ownedGlobs });
  return { restored: writes.map((write) => write.path), remanaged: ejected };
}
