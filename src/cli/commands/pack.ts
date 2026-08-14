import fs from "node:fs";
import path from "node:path";
import { archiveNameFor, integrityOf, packArchive, packageEntries } from "../../core/archive.js";
import { allDependencies } from "../../core/manifest.js";
import { loadProject } from "../../core/project.js";
import { isPinned } from "../../core/source.js";
import { formatVersion } from "../../core/version.js";
import { UsageError, type CommandSpec } from "../args.js";

export type PackConfig = {
  readonly command: "pack";
  output: string | null;
  list: boolean;
  directory: string;
};

export function runPack(config: PackConfig): number {
  const project = loadProject(config.directory);
  const manifest = project.manifest;
  if (manifest.name === null || manifest.version === null) {
    throw new UsageError("only a named, versioned package can be packed");
  }
  const pinned = allDependencies(manifest, false).filter((dependency) =>
    isPinned(dependency.source),
  );
  if (pinned.length > 0) {
    const names = pinned.map((dependency) => dependency.name.text).join(", ");
    throw new UsageError(
      `a published package cannot depend on a path or git source (${names}); consumers cannot resolve those`,
    );
  }
  const entries = packageEntries(project.root, manifest);
  if (config.list) {
    for (const entry of entries) console.log(`${entry.path} (${entry.contents.length} bytes)`);
    return 0;
  }
  const archive = packArchive(project.root, manifest);
  const target = path.resolve(
    project.root,
    config.output ?? archiveNameFor(manifest),
  );
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, archive);
  console.log(`${manifest.name.text} ${formatVersion(manifest.version)}`);
  for (const entry of entries) console.log(`  ${entry.path}`);
  console.log(`${entries.length} files, ${archive.length} bytes`);
  console.log(`integrity ${integrityOf(archive)}`);
  console.log(`wrote ${path.relative(process.cwd(), target) || target}`);
  return 0;
}

export const PACK_COMMAND: CommandSpec<PackConfig> = {
  name: "pack",
  summary: "build a .tpkg archive of this package",
  arguments: "",
  flags: [
    {
      name: "output",
      short: "o",
      value: "file",
      summary: "write the archive here instead of the default name",
      apply: (config, value) => (config.output = value),
    },
    {
      name: "list",
      summary: "print the files that would be packed and stop",
      apply: (config) => (config.list = true),
    },
    {
      name: "directory",
      short: "C",
      value: "dir",
      summary: "run in this directory instead of the current one",
      apply: (config, value) => (config.directory = value),
    },
  ],
  defaults: () => ({ command: "pack", output: null, list: false, directory: "." }),
  accept: (_config, token) => {
    throw new UsageError(`'pack' takes no arguments, got '${token}'`);
  },
};
