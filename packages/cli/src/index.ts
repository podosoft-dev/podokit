#!/usr/bin/env node
import { join, relative } from "node:path";
import { createInterface } from "node:readline/promises";
import { create, assertValidName } from "./create";
import { resolveCreateOptions, type Ask } from "./prompt";
import { templateListText } from "./templates";
import { addModule, listModules } from "./add";
import { removeModule } from "./remove";
import { status, diff, doctor } from "./inspect";
import {
  addedModuleReason,
  describeDowngrades,
  applyUpdate,
  previewUpdate,
  summarize,
  upstreamChanges,
  type UpdatePlan,
} from "./update";
import { eject } from "./eject";
import { restore, templateDiff } from "./template-files";
import { runDevCommand } from "./dev";
import {
  addLocale,
  listLocales,
  setLocaleEnabled,
  validateLocale,
  type LocaleDirection,
} from "./locale";
import {
  applyDeployment,
  doctorDeployment,
  getDeploymentStatus,
  inspectClusterFingerprint,
  planDeployment,
  planRollback,
  rollbackDeployment,
  verifyDeployment,
} from "./deploy";
import {
  initializeDeploymentProfile,
  loadDeploymentProfile,
} from "./deploy-profile";
import { renderDeployment } from "./deploy-render";
import {
  DEPLOY_DRIVERS,
  loadComposeProfile,
  readDeploymentDriver,
  type DeployDriver,
} from "./deploy-driver";
import { formatFinding } from "./deploy-checks";
import { initializeComposeProfile } from "./deploy-compose-profile";
import { renderComposeDeployment } from "./deploy-compose-render";
import {
  applyComposeDeployment,
  doctorComposeDeployment,
  getComposeStatus,
  inspectComposeEndpointFingerprint,
  planComposeDeployment,
  planComposeRollback,
  rollbackComposeDeployment,
  verifyComposeDeployment,
} from "./deploy-compose";
import { revertComposeSync, syncComposeDeployment } from "./deploy-compose-sync";
import { applyProviderChange, listProviders, planProviderChange } from "./provider";
import { describeApiPaths, type ApiPathResult } from "./module-api-paths";

const HELP = `podo — PodoKit project generator

Usage:
  podo create <name> [options]
  podo add <module> [--adopt]
  podo provider list        Show active runtime providers
  podo provider set <capability> <provider> [--apply]
  podo remove <module>     Un-apply a module (inverse of add)
  podo status              Show version, modules, file tiers, and local edits
  podo diff [path...]      List edited managed files, or diff files against the template
  podo doctor              Check framework versions against supported ranges
  podo dev <action> [...]  Run the shared, portless container development gateway
  podo deploy <action>     Plan, apply, verify, or roll back a deployment
                           (Kubernetes/Helm or Docker Compose)
  podo locale <command>    Add, validate, activate, or list JSON locales
  podo update [--apply]    Preview (or apply) what a version update would change
  podo eject <path...>     Take ownership of managed files (update skips them)
  podo restore <path...>   Rewrite managed or ejected files from the template

Options:
  --template <t> Template to scaffold (see below)
  --dir <path>   Target directory (default: ./<name>)
  --runtime bun  Optional explicit Bun runtime selection
  --database <provider>     Database provider: postgres | sqlite
  --name <label> Display name for a locale
  --direction <direction>  Text direction: ltr | rtl (default: ltr)
  --profile <name>         Deployment profile name
  --release <tag>          Immutable shared API/web release tag
  --confirm <plan-hash>    Exact deployment or rollback plan hash
  --revision <number>      Helm revision for rollback
  --context <name>         Explicit Kubernetes context for profile initialization
  --cluster-fingerprint <sha256:...>  Expected cluster fingerprint (auto-detected if omitted)
  --host <hostname>        Public hostname for profile initialization
  --json                   Emit machine-readable JSON when supported
  --adopt        Adopt colliding paths explicitly declared managed by a module
  --no-ai        Skip AI agent guidance (AGENTS.md, CLAUDE.md, editor rules)
  -y, --yes      Skip prompts and accept defaults
  -h, --help     Show this help

Templates:
${templateListText()}

Example:
  npx @podosoft/podokit create my-app
  npx @podosoft/podokit create my-app --template todo
  bunx --bun @podosoft/podokit create my-app
  cd my-app && bunx --bun @podosoft/podokit add auth
`;

const DEPLOY_HELP = `podo deploy — release an application to Kubernetes or Docker Compose

Usage:
  podo deploy init --profile <name> [--driver <driver>] --context <context>
                   [--host <hostname>] [--secrets-dir <path>]
  podo deploy doctor --profile <name> [--json]
  podo deploy render --profile <name> --release <tag> [--json]
  podo deploy plan --profile <name> --release <tag> [--json]
  podo deploy apply --profile <name> --release <tag> --confirm <plan-hash>
  podo deploy status --profile <name> [--json]
  podo deploy verify --profile <name> [--json]
  podo deploy rollback --profile <name> --revision <number> [--confirm <plan-hash>]
  podo deploy sync --profile <name> [--build] [--clean] [--revert] [--json]

Drivers:
  kubernetes-helm  (default) Helm releases on an existing cluster. --context is a
                   kubeconfig context; the namespace, Secrets, IngressClass, and
                   storage classes must already exist.
  docker-compose   A Compose project on one Docker host. --context is a Docker
                   context, local or ssh://; the env files named by the profile
                   must already exist on that host.

A profile records which driver it uses, so every action after init reads it from
the profile. Both drivers pin the target by fingerprint, resolve image tags to
digests, and require apply and rollback to confirm the exact plan hash.

sync is a development shortcut for the docker-compose driver only. It copies local
build output into the running containers and restarts them, so the deployment runs
code its image tag does not describe until the next apply recreates the containers.
It never runs migrations and refuses when runtime dependencies have changed.
`;

interface ParsedArgs {
  command?: string;
  name?: string;
  template?: string;
  dir?: string;
  pm?: string;
  runtime?: string;
  database?: string;
  from?: string;
  apply: boolean;
  adopt: boolean;
  yes: boolean;
  help: boolean;
  ai: boolean;
  positionals: string[];
  localeName?: string;
  localeDirection?: LocaleDirection;
  profile?: string;
  release?: string;
  confirm?: string;
  revision?: number;
  context?: string;
  clusterFingerprint?: string;
  endpointFingerprint?: string;
  driver?: DeployDriver;
  secretsDir?: string;
  host?: string;
  json: boolean;
  build: boolean;
  clean: boolean;
  revert: boolean;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    help: false,
    yes: false,
    apply: false,
    adopt: false,
    ai: true,
    json: false,
    build: false,
    clean: false,
    revert: false,
    positionals: [],
  };
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      parsed.help = true;
    } else if (arg === "-y" || arg === "--yes") {
      parsed.yes = true;
    } else if (arg === "--no-ai") {
      parsed.ai = false;
    } else if (arg === "--apply") {
      parsed.apply = true;
    } else if (arg === "--adopt") {
      parsed.adopt = true;
    } else if (arg === "--template") {
      parsed.template = argv[++i];
    } else if (arg === "--dir") {
      parsed.dir = argv[++i];
    } else if (arg === "--from") {
      parsed.from = argv[++i];
    } else if (arg === "--pm") {
      parsed.pm = argv[++i];
    } else if (arg === "--runtime") {
      parsed.runtime = argv[++i];
    } else if (arg === "--database") {
      parsed.database = argv[++i];
    } else if (arg === "--name") {
      parsed.localeName = argv[++i];
    } else if (arg === "--direction") {
      const direction = argv[++i];
      if (direction !== "ltr" && direction !== "rtl") {
        throw new Error('--direction must be either "ltr" or "rtl".');
      }
      parsed.localeDirection = direction;
    } else if (arg === "--profile") {
      parsed.profile = argv[++i];
    } else if (arg === "--release") {
      parsed.release = argv[++i];
    } else if (arg === "--confirm") {
      parsed.confirm = argv[++i];
    } else if (arg === "--revision") {
      const revision = Number(argv[++i]);
      if (!Number.isInteger(revision) || revision < 1) {
        throw new Error("--revision must be a positive integer.");
      }
      parsed.revision = revision;
    } else if (arg === "--context") {
      parsed.context = argv[++i];
    } else if (arg === "--cluster-fingerprint") {
      parsed.clusterFingerprint = argv[++i];
    } else if (arg === "--endpoint-fingerprint") {
      parsed.endpointFingerprint = argv[++i];
    } else if (arg === "--driver") {
      const driver = argv[++i];
      if (driver !== "kubernetes-helm" && driver !== "docker-compose") {
        throw new Error(`--driver must be one of: ${DEPLOY_DRIVERS.join(", ")}.`);
      }
      parsed.driver = driver;
    } else if (arg === "--secrets-dir") {
      parsed.secretsDir = argv[++i];
    } else if (arg === "--host") {
      parsed.host = argv[++i];
    } else if (arg === "--json") {
      parsed.json = true;
    } else if (arg === "--build") {
      parsed.build = true;
    } else if (arg === "--clean") {
      parsed.clean = true;
    } else if (arg === "--revert") {
      parsed.revert = true;
    } else if (arg !== undefined && !arg.startsWith("-")) {
      positionals.push(arg);
    }
  }
  parsed.command = positionals[0];
  parsed.name = positionals[1];
  parsed.positionals = positionals;
  return parsed;
}

/** Explain owned files whose template changed, with the upstream diff when the previous templates are given. */
function writeOwnedTemplateNotes(plan: UpdatePlan, templatesDir: string, from?: string): void {
  if (plan.changes.some((change) => change.action === "review")) {
    if (from) {
      process.stdout.write("\nTemplate changes to files you own (not applied):\n");
      for (const change of upstreamChanges(process.cwd(), templatesDir, plan, from)) {
        process.stdout.write(change.diff || `${change.path}: new in this version's template.\n`);
      }
    } else {
      process.stdout.write(
        "\nreview: the template changed for a file you own. podo update never writes it; " +
          "podo diff <path> compares it with the new template, and --from <previous templates> shows what changed upstream.\n",
      );
    }
  }
  if (plan.ownedWithoutTemplate.length) {
    process.stdout.write(
      `\n${plan.ownedWithoutTemplate.length} owned file(s) differ from this version's templates, and the lock does not record ` +
        "the template they came from. podo diff <path> shows the difference; applying this update records the template " +
        "so the next update reports only real template changes.\n",
    );
  }
}

function writeApiPaths(heading: string, result: ApiPathResult, verb: "add" | "remove"): void {
  const lines = describeApiPaths(result, verb);
  if (lines.length) process.stdout.write(`\n${heading}\n${lines.join("\n")}\n`);
}

function fail(message: string): never {
  process.stderr.write(`error: ${message}\n`);
  process.exit(1);
}

/**
 * The docker-compose driver's half of `podo deploy`. It answers the same actions as
 * the Kubernetes half and enforces the same rule: every mutation echoes back the
 * exact hash of a plan that was printed first.
 */
async function runComposeDeploy(
  action: string,
  args: ReturnType<typeof parseArgs>,
  profileName: string,
): Promise<void> {
  const cwd = process.cwd();
  if (action === "init") {
    if (!args.context) {
      fail(
        "Usage: podo deploy init --profile <name> --driver docker-compose --context <docker-context> [--host <hostname>] [--secrets-dir <path>].",
      );
    }
    const endpointFingerprint =
      args.endpointFingerprint ?? inspectComposeEndpointFingerprint(args.context);
    const initialized = initializeComposeProfile(cwd, profileName, {
      context: args.context,
      endpointFingerprint,
      host: args.host,
      secretsDirectory: args.secretsDir,
    });
    process.stdout.write(
      args.json
        ? `${JSON.stringify(initialized, null, 2)}\n`
        : `Created deployment profile ${initialized.name} at ${initialized.path}.\n`,
    );
    return;
  }
  if (action === "doctor") {
    // A release makes the doctor probe with the image about to run, and lets it
    // check registry access at all.
    const findings = doctorComposeDeployment(cwd, profileName, undefined, args.release);
    process.stdout.write(
      args.json
        ? `${JSON.stringify(findings, null, 2)}\n`
        : `${findings.map(formatFinding).join("\n")}\n`,
    );
    if (findings.some((finding) => !finding.ok)) process.exitCode = 1;
    return;
  }
  if (action === "render") {
    if (!args.release) fail("podo deploy render requires --release <tag>.");
    const profile = loadComposeProfile(cwd, profileName);
    const runtime = renderComposeDeployment(cwd, profileName, profile, args.release);
    process.stdout.write(
      args.json
        ? `${JSON.stringify(runtime, null, 2)}\n`
        : `Rendered Compose project into ${runtime.root}.\n`,
    );
    return;
  }
  if (action === "plan") {
    if (!args.release) fail("podo deploy plan requires --release <tag>.");
    const plan = planComposeDeployment(cwd, profileName, args.release);
    process.stdout.write(
      args.json
        ? `${JSON.stringify(plan, null, 2)}\n`
        : `${plan.actions.map((entry) => `${entry.order}. ${entry.description}`).join("\n")}\n` +
            `${plan.warnings.map((warning) => `warning: ${warning}`).join("\n")}\n` +
            `Plan hash: ${plan.planHash}\n`,
    );
    return;
  }
  if (action === "apply") {
    if (!args.release || !args.confirm) {
      fail("podo deploy apply requires --release <tag> --confirm <plan-hash>.");
    }
    const result = await applyComposeDeployment(cwd, profileName, args.release, args.confirm);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.verification.ok) process.exitCode = 1;
    return;
  }
  if (action === "status") {
    process.stdout.write(`${JSON.stringify(getComposeStatus(cwd, profileName), null, 2)}\n`);
    return;
  }
  if (action === "verify") {
    const result = await verifyComposeDeployment(cwd, profileName);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.ok) process.exitCode = 1;
    return;
  }
  if (action === "rollback") {
    if (!args.revision) fail("podo deploy rollback requires --revision <number>.");
    if (!args.confirm) {
      const plan = planComposeRollback(cwd, profileName, args.revision);
      process.stdout.write(
        `${JSON.stringify(plan, null, 2)}\nRe-run with --confirm ${plan.planHash}.\n`,
      );
      return;
    }
    const result = await rollbackComposeDeployment(
      cwd,
      profileName,
      args.revision,
      args.confirm,
    );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.verification.ok) process.exitCode = 1;
    return;
  }
  if (action === "sync") {
    if (args.revert) {
      const reverted = await revertComposeSync(cwd, profileName);
      process.stdout.write(
        args.json
          ? `${JSON.stringify(reverted, null, 2)}\n`
          : `Recreated ${reverted.services.join(", ")} from the applied Compose project.\n`,
      );
      return;
    }
    const result = await syncComposeDeployment(cwd, profileName, {
      build: args.build,
      clean: args.clean,
    });
    process.stdout.write(
      args.json
        ? `${JSON.stringify(result, null, 2)}\n`
        : `${result.plan.warnings.map((warning) => `warning: ${warning}`).join("\n")}\n` +
            `Copied ${result.plan.artifacts.length} artifact(s) into ${result.restarted.join(", ")}.\n` +
            "This deployment now runs code its image tag does not describe; " +
            "podo deploy sync --revert restores the image.\n",
    );
    return;
  }
  fail(
    `Unknown deploy command "${action}". Use init, doctor, render, plan, apply, status, verify, rollback, or sync.`,
  );
}

async function main(argv: string[]): Promise<void> {
  const args = parseArgs(argv);

  if (args.help || !args.command) {
    process.stdout.write(args.help && args.command === "deploy" ? DEPLOY_HELP : HELP);
    return;
  }
  const modulesDir = join(__dirname, "templates", "modules");

  if (args.command === "provider") {
    const action = args.positionals[1] ?? "list";
    try {
      if (action === "list") {
        const providers = listProviders(process.cwd());
        process.stdout.write(
          providers.map((item) =>
            `${item.capability.padEnd(14)} ${item.selected.padEnd(10)} (${item.available.join(", ")})`
          ).join("\n") + "\n",
        );
        return;
      }
      if (action === "set") {
        const capability = args.positionals[2];
        const provider = args.positionals[3];
        if (!capability || !provider) {
          fail("Usage: podo provider set <capability> <provider> [--apply]");
        }
        const plan = args.apply
          ? applyProviderChange(process.cwd(), capability, provider, { modulesDir })
          : planProviderChange(process.cwd(), capability, provider, modulesDir);
        process.stdout.write(
            `${plan.capability}: ${plan.from} -> ${plan.to}${plan.changed ? "" : " (unchanged)"}\n` +
            plan.modulesToAdd.map((module) => `  ${args.apply ? "add" : "would add"} module ${module}`).join("\n") +
            (plan.modulesToAdd.length ? "\n" : "") +
            plan.files.map((file) => `  ${args.apply ? "write" : "would write"} ${file}`).join("\n") +
            (plan.files.length ? "\n" : "") +
            plan.warnings.map((warning) => `warning: ${warning}`).join("\n") +
            (plan.warnings.length ? "\n" : "") +
            (args.apply ? "Applied provider configuration.\n" : "Dry-run — nothing was written. Re-run with --apply to write.\n"),
        );
        return;
      }
      fail(`Unknown provider command "${action}". Use list or set.`);
    } catch (err) {
      fail((err as Error).message);
    }
  }

  if (args.command === "add") {
    const moduleName = args.name;
    if (!moduleName) {
      const available = listModules(modulesDir, process.cwd());
      const list = available.length
        ? available.map((m) => `  ${m.name}  ${m.description}`).join("\n")
        : "  (none available)";
      process.stdout.write(`Usage: podo add <module>\n\nModules:\n${list}\n`);
      return;
    }
    try {
      const result = addModule({
        projectRoot: process.cwd(),
        module: moduleName,
        modulesDir,
        adopt: args.adopt,
      });
      if (result.added.length) {
        process.stdout.write(`\nAlso added required module(s): ${result.added.join(", ")}\n`);
      }
      process.stdout.write(`\nAdded ${result.module}.\n`);
      if (result.preserved.length) {
        process.stdout.write(
          `\nPreserved app-owned presentation file(s):\n${result.preserved.map((file) => `  ${file}`).join("\n")}\n`,
        );
      }
      if (result.adopted.length) {
        process.stdout.write(
          `\nAdopted as module-managed file(s):\n${result.adopted.map((file) => `  ${file}`).join("\n")}\n`,
        );
      }
      writeApiPaths(
        "Direct API paths (the gateway sends them to the API without the web proxy):",
        result.apiPaths,
        "add",
      );
      if (result.instructions.length) {
        process.stdout.write(`\nNext steps:\n${result.instructions.map((i) => `  ${i}`).join("\n")}\n`);
      }
    } catch (err) {
      fail((err as Error).message);
    }
    return;
  }

  if (args.command === "remove") {
    const moduleName = args.name;
    if (!moduleName) {
      fail("Usage: podo remove <module>");
    }
    try {
      const result = removeModule({ projectRoot: process.cwd(), module: moduleName!, modulesDir });
      process.stdout.write(
        `\nRemoved ${result.module}: ${result.removed.length} file(s) deleted` +
          `${result.unwired.length ? `, un-wired ${result.unwired.length} target(s)` : ""}.\n`,
      );
      if (result.keptShared.length) {
        process.stdout.write(
          `\nKept (shared with another module): ${result.keptShared.join(", ")}\n`,
        );
      }
      if (result.keptEdited.length) {
        process.stdout.write(
          `\nKept (you edited these — delete manually if you want them gone):\n` +
            result.keptEdited.map((f) => `  ${f}`).join("\n") +
            "\n",
        );
      }
      writeApiPaths("Direct API paths:", result.apiPaths, "remove");
    } catch (err) {
      fail((err as Error).message);
    }
    return;
  }

  if (args.command === "status") {
    try {
      const s = status(process.cwd());
      const tiers = `managed ${s.tiers.managed}, assembled ${s.tiers.assembled}, owned ${s.tiers.owned}`;
      const modules = s.moduleDetails.map((module) =>
        module.version ? `${module.name}@${module.version}` : module.name,
      );
      process.stdout.write(
        args.json
          ? `${JSON.stringify(s, null, 2)}\n`
          : `PodoKit ${s.podokitVersion}  (template: ${s.template}, ${s.runtime} ${s.runtimeVersion}, ${s.packageManager})\n` +
              `Modules: ${modules.length ? modules.join(", ") : "(none)"}\n` +
              `Files:   ${tiers}\n` +
              `Edited:  ${s.drifted.length} managed file(s)${s.missing.length ? `, ${s.missing.length} missing` : ""}\n` +
              (s.drifted.length ? s.drifted.map((f) => `  ~ ${f}`).join("\n") + "\n" : ""),
      );
    } catch (err) {
      fail((err as Error).message);
    }
    return;
  }

  if (args.command === "diff") {
    const targets = args.positionals.slice(1);
    try {
      if (targets.length) {
        const result = templateDiff(process.cwd(), join(__dirname, "templates"), targets);
        if (result.projectVersion !== result.templateVersion) {
          process.stdout.write(
            `Comparing with PodoKit ${result.templateVersion} templates; this project is on ${result.projectVersion}.\n`,
          );
        }
        for (const file of result.files) {
          const tier = file.tier ? ` (${file.tier})` : "";
          if (file.status === "not-generated") {
            process.stdout.write(`${file.path}: PodoKit does not generate this file.\n`);
          } else if (file.status === "missing") {
            process.stdout.write(`${file.path}${tier}: missing; podo restore ${file.path} writes the template's version.\n`);
          } else if (file.status === "same") {
            process.stdout.write(`${file.path}${tier}: same as the template.\n`);
          } else if (file.binary) {
            process.stdout.write(`${file.path}${tier}: binary file differs from the template.\n`);
          } else {
            process.stdout.write(file.diff);
          }
        }
        return;
      }
      const { drifted, missing } = diff(process.cwd());
      if (!drifted.length && !missing.length) {
        process.stdout.write("No local edits to PodoKit-managed files.\n");
      } else {
        process.stdout.write(
          [...drifted.map((f) => `edited   ${f}`), ...missing.map((f) => `missing  ${f}`)].join("\n") + "\n",
        );
      }
    } catch (err) {
      fail((err as Error).message);
    }
    return;
  }

  if (args.command === "doctor") {
    try {
      const findings = doctor(process.cwd());
      if (!findings.length) {
        process.stdout.write("No known frameworks found to check.\n");
      } else {
        for (const f of findings) {
          const mark = f.ok ? "ok  " : "WARN";
          process.stdout.write(`${mark} ${f.package} ${f.installed} (supported: ${f.supported})\n`);
        }
      }
      if (findings.some((f) => !f.ok)) {
        process.stdout.write(
          "\nSome frameworks are outside the supported range; @podosoft/* extensions may not match.\n",
        );
      }
    } catch (err) {
      fail((err as Error).message);
    }
    return;
  }

  if (args.command === "dev") {
    try {
      await runDevCommand(process.cwd(), args.name, argv.slice(2));
    } catch (err) {
      fail((err as Error).message);
    }
    return;
  }

  if (args.command === "deploy") {
    const action = args.positionals[1] ?? "status";
    const profileName = args.profile;
    if (!profileName) {
      fail("Deployment commands require --profile <name>.");
    }
    try {
      // A profile names its own driver, so everything but `init` reads it from disk.
      const driver: DeployDriver =
        action === "init"
          ? (args.driver ?? "kubernetes-helm")
          : readDeploymentDriver(process.cwd(), profileName!);
      if (driver === "docker-compose") {
        await runComposeDeploy(action, args, profileName!);
        return;
      }
      if (action === "init") {
        if (!args.context) {
          fail("Usage: podo deploy init --profile <name> --context <context> [--host <hostname>].");
        }
        const clusterFingerprint =
          args.clusterFingerprint ?? inspectClusterFingerprint(args.context);
        const initialized = initializeDeploymentProfile(process.cwd(), profileName!, {
          context: args.context,
          clusterFingerprint,
          host: args.host,
        });
        process.stdout.write(
          args.json
            ? `${JSON.stringify(initialized, null, 2)}\n`
            : `Created deployment profile ${initialized.name} at ${initialized.path}.\n`,
        );
        return;
      }
      if (action === "doctor") {
        const findings = doctorDeployment(process.cwd(), profileName!);
        process.stdout.write(
          args.json
            ? `${JSON.stringify(findings, null, 2)}\n`
            : `${findings.map(formatFinding).join("\n")}\n`,
        );
        if (findings.some((finding) => !finding.ok)) process.exitCode = 1;
        return;
      }
      if (action === "render") {
        if (!args.release) fail("podo deploy render requires --release <tag>.");
        const profile = loadDeploymentProfile(process.cwd(), profileName!);
        const plan = planDeployment(process.cwd(), profileName!, args.release!);
        const runtime = renderDeployment(
          process.cwd(),
          profileName!,
          profile,
          args.release!,
          plan.images,
          plan.rolloutState,
        );
        process.stdout.write(
          args.json
            ? `${JSON.stringify({ plan, runtime }, null, 2)}\n`
            : `Rendered deployment into ${runtime.root}.\nPlan hash: ${plan.planHash}\n`,
        );
        return;
      }
      if (action === "plan") {
        if (!args.release) fail("podo deploy plan requires --release <tag>.");
        const plan = planDeployment(process.cwd(), profileName!, args.release!);
        process.stdout.write(
          args.json
            ? `${JSON.stringify(plan, null, 2)}\n`
            : `${plan.actions.map((entry) => `${entry.order}. ${entry.description}`).join("\n")}\n` +
                `${plan.warnings.map((warning) => `warning: ${warning}`).join("\n")}\n` +
                `Plan hash: ${plan.planHash}\n`,
        );
        return;
      }
      if (action === "apply") {
        if (!args.release || !args.confirm) {
          fail("podo deploy apply requires --release <tag> --confirm <plan-hash>.");
        }
        const result = await applyDeployment(
          process.cwd(),
          profileName!,
          args.release!,
          args.confirm!,
        );
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return;
      }
      if (action === "status") {
        const result = getDeploymentStatus(process.cwd(), profileName!);
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return;
      }
      if (action === "verify") {
        const result = await verifyDeployment(process.cwd(), profileName!);
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        if (!result.ok) process.exitCode = 1;
        return;
      }
      if (action === "rollback") {
        if (!args.revision) fail("podo deploy rollback requires --revision <number>.");
        if (!args.confirm) {
          const plan = planRollback(process.cwd(), profileName!, args.revision!);
          process.stdout.write(
            `${JSON.stringify(plan, null, 2)}\nRe-run with --confirm ${plan.planHash}.\n`,
          );
          return;
        }
        const result = await rollbackDeployment(
          process.cwd(),
          profileName!,
          args.revision!,
          args.confirm,
        );
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return;
      }
      if (action === "sync") {
        // Not a gap to fill later. There is no image to swap artifacts into: a
        // cluster schedules pods across nodes from a registry, so the equivalent
        // shortcut would have to reach every node and would stop being a shortcut.
        fail(
          "podo deploy sync is only available for the docker-compose driver. On a cluster, build and roll out a release.",
        );
      }
      fail(
        `Unknown deploy command "${action}". Use init, doctor, render, plan, apply, status, verify, or rollback.`,
      );
    } catch (err) {
      fail((err as Error).message);
    }
  }

  if (args.command === "locale") {
    const action = args.positionals[1] ?? "list";
    const code = args.positionals[2];
    try {
      if (action === "add") {
        if (!code) fail("Usage: podo locale add <code> [--name <label>] [--direction ltr|rtl]");
        const definition = addLocale(process.cwd(), code, {
          name: args.localeName,
          direction: args.localeDirection,
        });
        process.stdout.write(
          `Added ${definition.code} (${definition.name}) as inactive. Translate catalogs, run ` +
            `"podo locale validate ${definition.code}", then activate it.\n`,
        );
        return;
      }
      if (action === "validate") {
        const locales = code ? [code] : listLocales(process.cwd()).map((locale) => locale.code);
        for (const locale of locales) {
          const coverage = validateLocale(process.cwd(), locale);
          process.stdout.write(
            `${coverage.definition.code.padEnd(10)} ${String(coverage.percent).padStart(3)}% ` +
              `(${coverage.translated}/${coverage.total})` +
              `${coverage.missing.length ? `  missing ${coverage.missing.length}` : ""}\n`,
          );
        }
        return;
      }
      if (action === "activate" || action === "deactivate") {
        if (!code) fail(`Usage: podo locale ${action} <code>`);
        const coverage = setLocaleEnabled(process.cwd(), code, action === "activate");
        process.stdout.write(
          `${action === "activate" ? "Activated" : "Deactivated"} ${coverage.definition.code} ` +
            `(${coverage.percent}% translated; missing keys use the configured fallback).\n`,
        );
        return;
      }
      if (action === "list") {
        for (const locale of listLocales(process.cwd())) {
          const coverage = validateLocale(process.cwd(), locale.code);
          process.stdout.write(
            `${locale.enabled ? "active  " : "inactive"} ${locale.code.padEnd(10)} ` +
              `${locale.name}  ${coverage.percent}%\n`,
          );
        }
        return;
      }
      fail(`Unknown locale command "${action}". Use add, validate, activate, deactivate, or list.`);
    } catch (err) {
      fail((err as Error).message);
    }
  }

  if (args.command === "update") {
    const templatesDir = join(__dirname, "templates");
    try {
      if (args.apply) {
        const result = applyUpdate(process.cwd(), templatesDir, { oldTemplatesDir: args.from });
        if (result.addedModules.length) {
          process.stdout.write(`Added required module(s): ${result.addedModules.join(", ")}\n`);
        }
        process.stdout.write(
          `Applied: ${result.written.length} written, ${result.moved.length} moved, ` +
            `${result.removed.length} removed, ` +
            `${result.merged.length} merged, ${result.conflicts.length} conflict, ` +
            `${result.kept.length} kept.\n`,
        );
        writeApiPaths("Direct API paths:", result.apiPaths, "add");
        if (result.conflicts.length) {
          process.stdout.write(
            "\nResolve the following, then commit:\n" +
              result.conflicts.map((f) => `  ${f}`).join("\n") +
              "\n",
          );
        }
        if (result.review.length) {
          process.stdout.write(
            "\nThe template changed for these files you own; they were left as they are. " +
              "Compare each with podo diff <path>:\n" +
              result.review.map((f) => `  ${f}`).join("\n") +
              "\n",
          );
        }
        if (result.kept.length) {
          process.stdout.write(
            "\nKept edited files as they are:\n" +
              result.kept.map((file) => `  ${file.path}  (${file.reason})`).join("\n") +
              "\n",
          );
        }
        return;
      }
      const { plan, mergesUnchecked } = previewUpdate(process.cwd(), templatesDir, { oldTemplatesDir: args.from });
      const counts = summarize(plan);
      const shown = plan.changes.filter((c) => c.action !== "up-to-date" && c.action !== "skip");
      process.stdout.write(
        `podo update ${plan.fromVersion} -> ${plan.toVersion}  (template: ${plan.template}; modules: ${plan.modules.join(", ") || "none"})\n\n`,
      );
      if (plan.moduleDowngrades.length) {
        process.stdout.write(
          "WARN older external modules are installed than this project applied:\n" +
            `${describeDowngrades(plan.moduleDowngrades)}\n` +
            "--apply refuses until you install the recorded versions; the plan below would downgrade them.\n\n",
        );
      }
      if (plan.addedModules.length) {
        process.stdout.write(
          "Modules to add:\n" +
            plan.addedModules.map((module) => `  ${module.name}  (${addedModuleReason(module)})`).join("\n") +
            "\n\n",
        );
      }
      const apiPathLines = describeApiPaths(plan.apiPaths, "add");
      if (apiPathLines.length) {
        process.stdout.write(`Direct API paths to add:\n${apiPathLines.join("\n")}\n\n`);
      }
      if (!shown.length && !plan.apiPaths.changed.length) {
        process.stdout.write("Everything is up to date.\n");
      } else {
        for (const c of shown) {
          const path = c.fromPath ? `${c.fromPath} -> ${c.path}` : c.path;
          process.stdout.write(`  ${c.action.padEnd(9)} ${path}  (${c.note})\n`);
        }
        process.stdout.write(
          `${shown.length ? "\n" : ""}${counts.update} update, ${counts.add} add, ${counts.move} move, ` +
            `${counts.remove} remove, ${counts.merge} merge, ${counts.conflict} conflict, ` +
            `${counts.keep} keep, ${counts.review} review. ` +
            `Dry-run — nothing was written. Re-run with --apply to write.\n` +
            (mergesUnchecked
              ? `WARN the ${counts.merge} merge(s) were not checked, so --apply may still leave conflict markers in them: ` +
                `${mergesUnchecked}\nPass the ${plan.fromVersion} templates with --from <dir> to check them.\n`
              : ""),
        );
      }
      writeOwnedTemplateNotes(plan, templatesDir, args.from);
    } catch (err) {
      fail((err as Error).message);
    }
    return;
  }

  if (args.command === "eject") {
    const targets = args.positionals.slice(1);
    if (!targets.length) {
      fail("Usage: podo eject <path...>");
    }
    try {
      const result = eject(process.cwd(), targets);
      if (result.ejected.length) {
        process.stdout.write(`Ejected (now owned): ${result.ejected.join(", ")}\n`);
      }
      if (result.unknown.length) {
        process.stdout.write(`Not tracked, skipped: ${result.unknown.join(", ")}\n`);
      }
      if (!result.ejected.length && !result.unknown.length) {
        process.stdout.write("Nothing to eject (already owned).\n");
      }
    } catch (err) {
      fail((err as Error).message);
    }
    return;
  }

  if (args.command === "restore") {
    const targets = args.positionals.slice(1);
    if (!targets.length) {
      fail("Usage: podo restore <path...>");
    }
    try {
      const result = restore(process.cwd(), join(__dirname, "templates"), targets);
      process.stdout.write(`Restored from the template: ${result.restored.join(", ")}\n`);
      if (result.remanaged.length) {
        process.stdout.write(`Managed by PodoKit again: ${result.remanaged.join(", ")}\n`);
      }
    } catch (err) {
      fail((err as Error).message);
    }
    return;
  }

  if (args.command !== "create") {
    fail(`Unknown command "${args.command}". Run "podo --help".`);
  }
  if (!args.name) {
    fail('Missing project name. Usage: podo create <name>');
  }

  try {
    assertValidName(args.name);
  } catch (err) {
    fail((err as Error).message);
  }

  const interactive = Boolean(process.stdin.isTTY) && !args.yes;
  const rl = interactive ? createInterface({ input: process.stdin, output: process.stdout }) : undefined;
  const ask: Ask = async (question) => (rl ? (await rl.question(question)).trim() : "");

  // Show the template menu with descriptions before prompting for one.
  if (interactive && !args.template) {
    process.stdout.write(`\nTemplates:\n${templateListText()}\n\n`);
  }

  const templatesDir = join(__dirname, "templates");
  try {
    const resolved = await resolveCreateOptions(
      { template: args.template, pm: args.pm, runtime: args.runtime },
      ask,
      interactive,
    );
    const result = create({
      name: args.name,
      templatesDir,
      template: resolved.template,
      targetDir: args.dir,
      runtime: resolved.toolchain.runtime,
      ai: args.ai,
      database: args.database === undefined ? undefined : args.database as "postgres" | "sqlite",
    });
    const relPath = relative(process.cwd(), result.projectDir) || ".";
    const rel = relPath.startsWith("..") ? result.projectDir : relPath;
    const pm = result.packageManager;
    process.stdout.write(
      `\nCreated ${args.name} (${result.template}) in ${rel}\n\nNext steps:\n  cd ${rel}\n  ${pm} install\n  ${pm} run dev\n`,
    );
  } catch (err) {
    fail((err as Error).message);
  } finally {
    rl?.close();
  }
}

void main(process.argv.slice(2));
