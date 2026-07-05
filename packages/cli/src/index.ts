#!/usr/bin/env node
import { join, relative } from "node:path";
import { createInterface } from "node:readline/promises";
import { create, assertValidName, type PackageManager } from "./create";
import { resolveCreateOptions, type Ask } from "./prompt";

const HELP = `podo — PodoKit project generator

Usage:
  podo create <name> [options]

Options:
  --template <t> Template: fullstack-nest-svelte | base (default: fullstack-nest-svelte)
  --dir <path>   Target directory (default: ./<name>)
  --pm <name>    Package manager: npm | pnpm | yarn (default: npm)
  -y, --yes      Skip prompts and accept defaults
  -h, --help     Show this help

Example:
  npx @podosoft/podokit create my-app
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
