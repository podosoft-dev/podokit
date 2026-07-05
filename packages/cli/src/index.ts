#!/usr/bin/env node
import { join, relative } from "node:path";
import { create, assertValidName, type PackageManager } from "./create";

const HELP = `podo — PodoKit project generator

Usage:
  podo create <name> [options]

Options:
  --template <t> Template: fullstack-nest-svelte | base (default: fullstack-nest-svelte)
  --dir <path>   Target directory (default: ./<name>)
  --pm <name>    Package manager: npm | pnpm | yarn (default: npm)
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
  help: boolean;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = { help: false };
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      parsed.help = true;
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

function main(argv: string[]): void {
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
  if (args.pm && !["npm", "pnpm", "yarn"].includes(args.pm)) {
    fail(`Invalid --pm "${args.pm}". Use npm, pnpm, or yarn.`);
  }

  try {
    assertValidName(args.name);
  } catch (err) {
    fail((err as Error).message);
  }

  const templatesDir = join(__dirname, "templates");
  try {
    const result = create({
      name: args.name,
      templatesDir,
      template: args.template,
      targetDir: args.dir,
      packageManager: args.pm,
    });
    const relPath = relative(process.cwd(), result.projectDir) || ".";
    const rel = relPath.startsWith("..") ? result.projectDir : relPath;
    const pm = result.packageManager;
    process.stdout.write(
      `\nCreated ${args.name} in ${rel}\n\nNext steps:\n  cd ${rel}\n  ${pm} install\n  ${pm} run dev\n`,
    );
  } catch (err) {
    fail((err as Error).message);
  }
}

main(process.argv.slice(2));
