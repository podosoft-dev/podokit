import { type PackageManager } from "./create";
import { DEFAULT_TEMPLATE, TEMPLATE_NAMES, isKnownTemplate } from "./templates";

export const PACKAGE_MANAGERS: PackageManager[] = ["npm", "pnpm", "yarn"];

/** Asks a single question and resolves to the trimmed answer (empty if skipped). */
export type Ask = (question: string) => Promise<string>;

export interface RawCreateArgs {
  template?: string;
  pm?: PackageManager;
}

export interface ResolvedCreateOptions {
  template: string;
  packageManager: PackageManager;
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

  let pm: string | undefined = args.pm;
  if (!pm && interactive) {
    const answer = await ask(`Package manager (${PACKAGE_MANAGERS.join(" / ")}) [npm]: `);
    pm = answer || undefined;
  }
  pm = pm ?? "npm";
  if (!isPackageManager(pm)) {
    throw new Error(`Invalid package manager "${pm}". Choose one of: ${PACKAGE_MANAGERS.join(", ")}.`);
  }

  return { template, packageManager: pm };
}
