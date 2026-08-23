import { type PackageManager } from "./create";
import { DEFAULT_TEMPLATE, TEMPLATE_NAMES, isKnownTemplate } from "./templates";
import { isRuntime, resolveToolchain, type Runtime, type Toolchain } from "./toolchain";

export const PACKAGE_MANAGERS: PackageManager[] = ["npm", "pnpm", "yarn"];

/** Asks a single question and resolves to the trimmed answer (empty if skipped). */
export type Ask = (question: string) => Promise<string>;

export interface RawCreateArgs {
  template?: string;
  pm?: PackageManager;
  runtime?: Runtime;
}

export interface ResolvedCreateOptions {
  template: string;
  toolchain: Toolchain;
}

function isPackageManager(value: string): value is PackageManager {
  return (PACKAGE_MANAGERS as string[]).includes(value);
}

/**
 * Resolve the template and package manager for `create`.
 *
 * Precedence: an explicit flag wins; otherwise, when `interactive` is true the
 * user is prompted (blank answer = default); otherwise the default is used.
 * Kept free of I/O — the caller injects `ask` — so it is unit-testable.
 */
export async function resolveCreateOptions(
  args: RawCreateArgs,
  ask: Ask,
  interactive: boolean,
): Promise<ResolvedCreateOptions> {
  let template = args.template;
  if (!template && interactive) {
    const answer = await ask(`Template [${DEFAULT_TEMPLATE}]: `);
    template = answer || undefined;
  }
  template = template ?? DEFAULT_TEMPLATE;
  if (!isKnownTemplate(template)) {
    throw new Error(`Unknown template "${template}". Choose one of: ${TEMPLATE_NAMES.join(", ")}.`);
  }

  let runtime: string | undefined = args.runtime;
  if (!runtime && interactive) {
    const answer = await ask("Runtime (node / bun) [node]: ");
    runtime = answer || undefined;
  }
  runtime = runtime ?? "node";
  if (!isRuntime(runtime)) {
    throw new Error('Invalid runtime. Choose one of: node, bun.');
  }

  let pm: string | undefined = args.pm;
  if (runtime === "bun") {
    if (pm) throw new Error('Bun runtime requires the "bun" package manager. Remove --pm.');
    const toolchain = resolveToolchain(runtime);
    return { template, toolchain };
  }
  if (!pm && interactive) {
    const answer = await ask(`Package manager (${PACKAGE_MANAGERS.join(" / ")}) [npm]: `);
    pm = answer || undefined;
  }
  pm = pm ?? "npm";
  if (!isPackageManager(pm)) {
    throw new Error(`Invalid package manager "${pm}". Choose one of: ${PACKAGE_MANAGERS.join(", ")}.`);
  }

  const toolchain = resolveToolchain(runtime, pm);
  return { template, toolchain };
}
