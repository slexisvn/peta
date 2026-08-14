import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PetaError } from "../core/errors.js";
import { UsageError, commandNamed, parseCommand } from "./args.js";
import { helpFor } from "./help.js";
import { ALIASES, COMMANDS, type PetaConfig } from "./spec.js";
import { runInit } from "./commands/init.js";
import { runInstall } from "./commands/install.js";
import { runRemove } from "./commands/remove.js";
import { runList, runWhy } from "./commands/list.js";
import { runCheck } from "./commands/check.js";
import { runPack } from "./commands/pack.js";
import { runSearch } from "./commands/search.js";
import { runLogin, runLogout, runWhoami } from "./commands/auth.js";
import { runPublish, runYank } from "./commands/publish.js";
import { runScope } from "./commands/scope.js";
import { runTask } from "./commands/task.js";
import { runUpdate } from "./commands/update.js";

export const USAGE_EXIT = 2;
export const FAILURE_EXIT = 1;

const HELP_FLAGS: ReadonlySet<string> = new Set(["--help", "-h"]);
const VERSION_FLAGS: ReadonlySet<string> = new Set(["--version", "-v"]);

function readVersion(): string {
  let directory = path.dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const candidate = path.join(directory, "package.json");
    if (fs.existsSync(candidate)) {
      const pkg = JSON.parse(fs.readFileSync(candidate, "utf8")) as { version?: string };
      return pkg.version ?? "0.0.0";
    }
    const parent = path.dirname(directory);
    if (parent === directory) return "0.0.0";
    directory = parent;
  }
}

function canonicalName(token: string): string {
  return ALIASES.get(token) ?? token;
}

function askedFor(argv: readonly string[], flags: ReadonlySet<string>): boolean {
  return argv.some((token) => flags.has(token));
}

export function parseArgs(argv: readonly string[]): PetaConfig {
  if (askedFor(argv, HELP_FLAGS)) {
    const first = argv[0];
    const topic =
      first !== undefined && commandNamed(COMMANDS, canonicalName(first)) !== undefined
        ? canonicalName(first)
        : null;
    return { command: "help", topic };
  }
  if (askedFor(argv, VERSION_FLAGS)) return { command: "version" };
  const first = argv[0];
  if (first === undefined) return { command: "help", topic: null };
  const command = commandNamed(COMMANDS, canonicalName(first));
  if (command === undefined) {
    throw new UsageError(`unknown command '${first}' (see 'peta help')`);
  }
  return parseCommand(command, argv.slice(1)) as PetaConfig;
}

async function dispatch(config: PetaConfig): Promise<number> {
  switch (config.command) {
    case "help":
      console.log(helpFor(config.topic));
      return 0;
    case "version":
      console.log(readVersion());
      return 0;
    case "init":
      return runInit(config);
    case "install":
      return runInstall(config);
    case "remove":
      return runRemove(config);
    case "update":
      return runUpdate(config);
    case "list":
      return runList(config);
    case "why":
      return runWhy(config);
    case "check":
      return runCheck(config);
    case "pack":
      return runPack(config);
    case "search":
      return runSearch(config);
    case "publish":
      return runPublish(config);
    case "yank":
      return runYank(config);
    case "login":
      return runLogin(config);
    case "logout":
      return runLogout(config);
    case "whoami":
      return runWhoami(config);
    case "scope":
      return runScope(config);
    case "task":
      return runTask(config);
  }
}

export async function run(argv: readonly string[]): Promise<number> {
  try {
    return await dispatch(parseArgs(argv));
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`peta: ${error.message}`);
      return USAGE_EXIT;
    }
    if (error instanceof PetaError) {
      console.error(`peta: ${error.message}`);
      return FAILURE_EXIT;
    }
    throw error;
  }
}
