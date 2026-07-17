#!/usr/bin/env node
import { join, relative } from "node:path";
import { createInterface } from "node:readline/promises";
import { create, assertValidName, type PackageManager } from "./create";
import { resolveCreateOptions, type Ask } from "./prompt";
import { templateListText } from "./templates";
import { addModule, listModules } from "./add";
import { removeModule } from "./remove";
import { status, diff, doctor } from "./inspect";
import { planUpdate, applyUpdate, summarize } from "./update";
import { eject } from "./eject";
import { runDevCommand } from "./dev";
import {
  addLocale,
  listLocales,
  setLocaleEnabled,
  validateLocale,
  type LocaleDirection,
} from "./locale";

const HELP = `podo — PodoKit project generator

Usage:
  podo create <name> [options]
  podo add <module> [--adopt]
  podo remove <module>     Un-apply a module (inverse of add)
  podo status              Show version, modules, file tiers, and local edits
  podo diff                List PodoKit-managed files you have edited
  podo doctor              Check framework versions against supported ranges
  podo dev <action> [...]  Run the shared, portless container development gateway
  podo locale <command>    Add, validate, activate, or list JSON locales
  podo update [--apply]    Preview (or apply) what a version update would change
  podo eject <path...>     Take ownership of managed files (update skips them)

Options:
  --template <t> Template to scaffold (see below)
  --dir <path>   Target directory (default: ./<name>)
  --pm <name>    Package manager: npm | pnpm | yarn (default: npm)
  --name <label> Display name for a locale
  --direction <direction>  Text direction: ltr | rtl (default: ltr)
  --adopt        Adopt colliding paths explicitly declared managed by a module
  --no-ai        Skip AI agent guidance (AGENTS.md, CLAUDE.md, editor rules)
  -y, --yes      Skip prompts and accept defaults
  -h, --help     Show this help

Templates:
${templateListText()}

Example:
  npx @podosoft/podokit create my-app
  npx @podosoft/podokit create my-app --template todo
  cd my-app && npx @podosoft/podokit add auth
`;

interface ParsedArgs {
  command?: string;
  name?: string;
  template?: string;
  dir?: string;
  pm?: PackageManager;
  from?: string;
  apply: boolean;
  adopt: boolean;
  yes: boolean;
  help: boolean;
  ai: boolean;
  positionals: string[];
  localeName?: string;
  localeDirection?: LocaleDirection;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    help: false,
    yes: false,
    apply: false,
    adopt: false,
    ai: true,
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
      parsed.pm = argv[++i] as PackageManager;
    } else if (arg === "--name") {
      parsed.localeName = argv[++i];
    } else if (arg === "--direction") {
      const direction = argv[++i];
      if (direction !== "ltr" && direction !== "rtl") {
        throw new Error('--direction must be either "ltr" or "rtl".');
      }
      parsed.localeDirection = direction;
    } else if (arg !== undefined && !arg.startsWith("-")) {
      positionals.push(arg);
    }
  }
  parsed.command = positionals[0];
  parsed.name = positionals[1];
  parsed.positionals = positionals;
  return parsed;
}

function fail(message: string): never {
  process.stderr.write(`error: ${message}\n`);
  process.exit(1);
}

async function main(argv: string[]): Promise<void> {
  const args = parseArgs(argv);

  if (args.help || !args.command) {
    process.stdout.write(HELP);
    return;
  }
  const modulesDir = join(__dirname, "templates", "modules");

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
        `PodoKit ${s.podokitVersion}  (template: ${s.template}, ${s.packageManager})\n` +
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
    try {
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
      runDevCommand(process.cwd(), args.name, argv.slice(2));
    } catch (err) {
      fail((err as Error).message);
    }
    return;
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
        process.stdout.write(
          `Applied: ${result.written.length} written, ${result.removed.length} removed, ` +
            `${result.merged.length} merged, ${result.conflicts.length} conflict.\n`,
        );
        if (result.conflicts.length) {
          process.stdout.write(
            "\nResolve the following, then commit:\n" +
              result.conflicts.map((f) => `  ${f}`).join("\n") +
              "\n",
          );
        }
        return;
      }
      const plan = planUpdate(process.cwd(), templatesDir);
      const counts = summarize(plan);
      const shown = plan.changes.filter((c) => c.action !== "up-to-date" && c.action !== "skip");
      process.stdout.write(
        `podo update ${plan.fromVersion} -> ${plan.toVersion}  (template: ${plan.template}; modules: ${plan.modules.join(", ") || "none"})\n\n`,
      );
      if (!shown.length) {
        process.stdout.write("Everything is up to date.\n");
      } else {
        for (const c of shown) {
          process.stdout.write(`  ${c.action.padEnd(9)} ${c.path}  (${c.note})\n`);
        }
        process.stdout.write(
          `\n${counts.update} update, ${counts.add} add, ${counts.remove} remove, ${counts.conflict} conflict. ` +
            `Dry-run — nothing was written. Re-run with --apply to write (use --from <dir> for a 3-way merge).\n`,
        );
      }
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
      { template: args.template, pm: args.pm },
      ask,
      interactive,
    );
    const result = create({
      name: args.name,
      templatesDir,
      template: resolved.template,
      targetDir: args.dir,
      packageManager: resolved.packageManager,
      ai: args.ai,
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
