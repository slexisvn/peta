import { install } from "../../core/install.js";
import { findDependency } from "../../core/manifest.js";
import { parsePackageName } from "../../core/name.js";
import { loadProject, readLock } from "../../core/project.js";
import { formatVersion } from "../../core/version.js";
import { UsageError, type CommandSpec } from "../args.js";

export type UpdateConfig = {
  readonly command: "update";
  names: string[];
  directory: string;
};

export async function runUpdate(config: UpdateConfig): Promise<number> {
  const project = loadProject(config.directory);
  for (const text of config.names) {
    const name = parsePackageName(text);
    if (findDependency(project.manifest, name) === undefined) {
      throw new UsageError(`'${text}' is not a dependency of this project`);
    }
  }
  const before = readLock(project);
  const report = await install(project, { refresh: config.names });

  let moved = 0;
  for (const locked of report.lock.packages.values()) {
    const previous = before?.packages.get(locked.name.text);
    const now = formatVersion(locked.version);
    if (previous === undefined) {
      console.log(`added ${locked.name.text} ${now}`);
      moved += 1;
      continue;
    }
    const then = formatVersion(previous.version);
    if (then === now) continue;
    console.log(`${locked.name.text} ${then} -> ${now}`);
    moved += 1;
  }
  for (const [name] of before?.packages ?? []) {
    if (!report.lock.packages.has(name)) {
      console.log(`removed ${name}`);
      moved += 1;
    }
  }
  if (moved === 0) console.log("everything is already at the newest allowed version");
  return 0;
}

export const UPDATE_COMMAND: CommandSpec<UpdateConfig> = {
  name: "update",
  summary: "re-resolve within the manifest's ranges, ignoring the locked versions",
  arguments: "[name...]",
  flags: [
    {
      name: "directory",
      short: "C",
      value: "dir",
      summary: "run in this directory instead of the current one",
      apply: (config, value) => (config.directory = value),
    },
  ],
  defaults: () => ({ command: "update", names: [], directory: "." }),
  accept: (config, token) => config.names.push(token),
};
