import { DEFAULT_TEMPLATE, TEMPLATE_NAMES, isKnownTemplate } from "./templates";
import { resolveToolchain, type Toolchain } from "./toolchain";

export type Ask = (question: string) => Promise<string>;

export interface RawCreateArgs {
  template?: string;
  pm?: string;
  runtime?: string;
}

export interface ResolvedCreateOptions {
  template: string;
  toolchain: Toolchain;
}

/** Resolve a Bun-only v1 project create request without runtime/package prompts. */
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
  if (args.pm) throw new Error("PodoKit v1 uses Bun as its package manager; remove --pm.");
  return { template, toolchain: resolveToolchain(args.runtime ?? "bun") };
}
