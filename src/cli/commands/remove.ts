import { install } from "../../core/install.js";
import { findDependency, withoutDependency } from "../../core/manifest.js";
import { parsePackageName } from "../../core/name.js";
import { loadProject, writeManifest } from "../../core/project.js";
import { UsageError, type CommandSpec } from "../args.js";

export type RemoveConfig = {
  readonly command: "remove";
  names: string[];
  directory: string;
};

export async function runRemove(config: RemoveConfig): Promise<number> {
  if (config.names.length === 0) throw new UsageError("remove needs at least one package name");
  let project = loadProject(config.directory);
  let manifest = project.manifest;
  for (const text of config.names) {
    const name = parsePackageName(text);
    if (findDependency(manifest, name) === undefined) {
      throw new UsageError(`'${text}' is not a dependency of this project`);
    }
    manifest = withoutDependency(manifest, name);
  }
  project = writeManifest(project, manifest);
  const report = await install(project);
  for (const name of report.outcome.removed) console.log(`removed ${name}`);
  const total = report.lock.packages.size;
  console.log(`${total} package${total === 1 ? "" : "s"} installed`);
  return 0;
}

export const REMOVE_COMMAND: CommandSpec<RemoveConfig> = {
  name: "remove",
  summary: "drop dependencies from tera.json and reinstall",
  arguments: "<name>...",
  flags: [
    {
      name: "directory",
      short: "C",
      value: "dir",
      summary: "run in this directory instead of the current one",
      apply: (config, value) => (config.directory = value),
    },
  ],
  defaults: () => ({ command: "remove", names: [], directory: "." }),
  accept: (config, token) => config.names.push(token),
};
