#!/usr/bin/env node
import { join, relative } from "node:path";
import { createInterface } from "node:readline/promises";
import { create, assertValidName, type PackageManager } from "./create";
import { resolveCreateOptions, type Ask } from "./prompt";
import { templateListText } from "./templates";
import { addModule, listModules } from "./add";

const HELP = `podo — PodoKit project generator

Usage:
  podo create <name> [options]
  podo add <module>

Options:
  --template <t> Template to scaffold (see below)
  --dir <path>   Target directory (default: ./<name>)
  --pm <name>    Package manager: npm | pnpm | yarn (default: npm)
  -y, --yes      Skip prompts and accept defaults
  -h, --help     Show this help

Templates:
${templateListText()}

Example:
  npx @podosoft/podokit create my-app
  npx @podosoft/podokit create my-app --template todo
  cd my-app && npx @podosoft/podokit add auth-jwt
`;

interface ParsedArgs {
  command?: string;
  name?: string;
  template?: string;
  dir?: string;
  pm?: PackageManager;
  yes: boolean;
  help: boolean;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = { help: false, yes: false };
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      parsed.help = true;
    } else if (arg === "-y" || arg === "--yes") {
      parsed.yes = true;
    } else if (arg === "--template") {
      parsed.template = argv[++i];
    } else if (arg === "--dir") {
      parsed.dir = argv[++i];
    } else if (arg === "--pm") {
      parsed.pm = argv[++i] as PackageManager;
    } else if (arg !== undefined && !arg.startsWith("-")) {
      positionals.push(arg);
    }
  }
  parsed.command = positionals[0];
  parsed.name = positionals[1];
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
      const available = listModules(modulesDir);
      const list = available.length
        ? available.map((m) => `  ${m.name}  ${m.description}`).join("\n")
        : "  (none available)";
      process.stdout.write(`Usage: podo add <module>\n\nModules:\n${list}\n`);
      return;
    }
    try {
      const result = addModule({ projectRoot: process.cwd(), module: moduleName, modulesDir });
      process.stdout.write(`\nAdded ${result.module}.\n`);
      if (result.instructions.length) {
        process.stdout.write(`\nNext steps:\n${result.instructions.map((i) => `  ${i}`).join("\n")}\n`);
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
