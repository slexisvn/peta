import { LOCK_FILE } from "../../core/layout.js";
import { dependentsOf, sortedPackages } from "../../core/lock.js";
import { allDependencies } from "../../core/manifest.js";
import { parsePackageName } from "../../core/name.js";
import { loadProject, readLock } from "../../core/project.js";
import { formatResolvedSource } from "../../core/source.js";
import { formatVersion } from "../../core/version.js";
import { UsageError, type CommandSpec } from "../args.js";

export type ListConfig = {
  readonly command: "list";
  directory: string;
};

export type WhyConfig = {
  readonly command: "why";
  name: string | null;
  directory: string;
};

const DIRECTORY_FLAG = {
  name: "directory",
  short: "C",
  value: "dir",
  summary: "run in this directory instead of the current one",
} as const;

export function runList(config: ListConfig): number {
  const project = loadProject(config.directory);
  const lock = readLock(project);
  if (lock === null) {
    throw new UsageError(`no ${LOCK_FILE} yet (run 'peta install')`);
  }
  const direct = new Set(
    allDependencies(project.manifest, true).map((dependency) => dependency.name.text),
  );
  const packages = sortedPackages(lock);
  if (packages.length === 0) {
    console.log("no dependencies");
    return 0;
  }
  const width = packages.reduce((widest, entry) => Math.max(widest, entry.name.text.length), 0);
  for (const entry of packages) {
    const marker = direct.has(entry.name.text) ? " " : "-";
    const padded = entry.name.text.padEnd(width);
    console.log(
      `${marker} ${padded}  ${formatVersion(entry.version)}  ${formatResolvedSource(entry.source)}`,
    );
  }
  return 0;
}

export function runWhy(config: WhyConfig): number {
  if (config.name === null) throw new UsageError("why needs a package name");
  const project = loadProject(config.directory);
  const lock = readLock(project);
  if (lock === null) throw new UsageError(`no ${LOCK_FILE} yet (run 'peta install')`);
  const name = parsePackageName(config.name);
  const locked = lock.packages.get(name.text);
  if (locked === undefined) throw new UsageError(`'${name.text}' is not installed`);

  console.log(`${name.text} ${formatVersion(locked.version)} (${formatResolvedSource(locked.source)})`);
  const direct = allDependencies(project.manifest, true).find(
    (dependency) => dependency.name.text === name.text,
  );
  if (direct !== undefined) console.log(`  required by this project`);
  for (const dependent of dependentsOf(lock, name)) {
    const version = lock.packages.get(dependent.text)?.version;
    const suffix = version === undefined ? "" : ` ${formatVersion(version)}`;
    console.log(`  required by ${dependent.text}${suffix}`);
  }
  return 0;
}

export const LIST_COMMAND: CommandSpec<ListConfig> = {
  name: "list",
  summary: "show the installed packages",
  arguments: "",
  flags: [{ ...DIRECTORY_FLAG, apply: (config, value) => (config.directory = value) }],
  defaults: () => ({ command: "list", directory: "." }),
  accept: (_config, token) => {
    throw new UsageError(`'list' takes no arguments, got '${token}'`);
  },
};

export const WHY_COMMAND: CommandSpec<WhyConfig> = {
  name: "why",
  summary: "explain why a package is installed",
  arguments: "<name>",
  flags: [{ ...DIRECTORY_FLAG, apply: (config, value) => (config.directory = value) }],
  defaults: () => ({ command: "why", name: null, directory: "." }),
  accept: (config, token) => {
    if (config.name !== null) throw new UsageError(`why takes one name, got '${token}'`);
    config.name = token;
  },
};
