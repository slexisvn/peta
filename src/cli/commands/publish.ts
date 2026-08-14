import { integrityOf, packArchive, packageEntries } from "../../core/archive.js";
import { compareWithPublished, surfaceTooling, verdictLines } from "../../core/breaking.js";
import { allDependencies } from "../../core/manifest.js";
import { loadProject, type Project } from "../../core/project.js";
import { isPinned } from "../../core/source.js";
import { loadSurfaceTools } from "../../core/surface.js";
import { formatVersion, parseVersion } from "../../core/version.js";
import { clientFor } from "./auth.js";
import { registryFor } from "./search.js";
import { UsageError, type CommandSpec } from "../args.js";

export type PublishConfig = {
  readonly command: "publish";
  registry: string | null;
  dryRun: boolean;
  directory: string;
};

export type YankConfig = {
  readonly command: "yank";
  target: string | null;
  registry: string | null;
  undo: boolean;
};

const REGISTRY_FLAG = {
  name: "registry",
  value: "url",
  summary: "the hub to talk to (defaults to $PETA_REGISTRY)",
} as const;

async function surfaceGate(project: Project, registry: string | null): Promise<boolean> {
  let report;
  try {
    report = await compareWithPublished(project, {
      registry: registryFor(registry),
      tooling: async () => surfaceTooling(await loadSurfaceTools()),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`the semver check was skipped: ${detail}`);
    return true;
  }
  if (report === null) return true;
  for (const line of verdictLines(report)) {
    if (report.sufficient) console.log(line);
    else console.error(line);
  }
  return report.sufficient;
}

export async function runPublish(config: PublishConfig): Promise<number> {
  const project = loadProject(config.directory);
  const manifest = project.manifest;
  if (manifest.name === null || manifest.version === null) {
    throw new UsageError("only a named, versioned package can be published");
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
  const archive = packArchive(project.root, manifest);
  const version = formatVersion(manifest.version);
  console.log(`${manifest.name.text} ${version}`);
  for (const entry of entries) console.log(`  ${entry.path}`);
  console.log(`${entries.length} files, ${archive.length} bytes`);
  console.log(`integrity ${integrityOf(archive)}`);

  if (!(await surfaceGate(project, config.registry))) return 1;

  if (config.dryRun) {
    console.log("dry run: nothing was uploaded");
    return 0;
  }

  const client = clientFor(config.registry, true);
  const outcome = await client.publish(archive);
  console.log(`published ${outcome.name} ${outcome.version} to ${client.registry}`);
  return 0;
}

export async function runYank(config: YankConfig): Promise<number> {
  if (config.target === null) throw new UsageError("yank needs <name>@<version>");
  const at = config.target.lastIndexOf("@");
  if (at <= 0) throw new UsageError(`expected <name>@<version>, got '${config.target}'`);
  const name = config.target.slice(0, at);
  const version = formatVersion(parseVersion(config.target.slice(at + 1)));
  const client = clientFor(config.registry, true);
  await client.yank(name, version, config.undo);
  console.log(
    config.undo
      ? `${name} ${version} can be selected again`
      : `${name} ${version} is yanked; existing lockfiles keep working`,
  );
  return 0;
}

export const PUBLISH_COMMAND: CommandSpec<PublishConfig> = {
  name: "publish",
  summary: "pack this package and upload it to the registry",
  arguments: "",
  flags: [
    { ...REGISTRY_FLAG, apply: (config, value) => (config.registry = value) },
    {
      name: "dry-run",
      summary: "pack and report, but do not upload",
      apply: (config) => (config.dryRun = true),
    },
    {
      name: "directory",
      short: "C",
      value: "dir",
      summary: "run in this directory instead of the current one",
      apply: (config, value) => (config.directory = value),
    },
  ],
  defaults: () => ({ command: "publish", registry: null, dryRun: false, directory: "." }),
  accept: (_config, token) => {
    throw new UsageError(`'publish' takes no arguments, got '${token}'`);
  },
};

export const YANK_COMMAND: CommandSpec<YankConfig> = {
  name: "yank",
  summary: "stop a published version from being selected, without deleting it",
  arguments: "<name>@<version>",
  flags: [
    { ...REGISTRY_FLAG, apply: (config, value) => (config.registry = value) },
    {
      name: "undo",
      summary: "make the version selectable again",
      apply: (config) => (config.undo = true),
    },
  ],
  defaults: () => ({ command: "yank", target: null, registry: null, undo: false }),
  accept: (config, token) => {
    if (config.target !== null) throw new UsageError(`yank takes one target, got '${token}'`);
    config.target = token;
  },
};
