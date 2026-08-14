import { install } from "../../core/install.js";
import { loadProject, writeManifest, type Project } from "../../core/project.js";
import {
  MANIFEST_FILE,
  findDependency,
  withDependency,
  type Dependency,
  type DependencyKind,
} from "../../core/manifest.js";
import { parsePackageName } from "../../core/name.js";
import { parseRange } from "../../core/range.js";
import { DEFAULT_REGISTRY, describeSource, type DependencySource } from "../../core/source.js";
import { formatVersion } from "../../core/version.js";
import { UsageError, type CommandSpec } from "../args.js";

export type InstallConfig = {
  readonly command: "install";
  requests: string[];
  dev: boolean;
  frozen: boolean;
  path: string | null;
  git: string | null;
  rev: string | null;
  directory: string;
};

const NAME_SEPARATOR = "@";

function splitRequest(request: string): { name: string; range: string | null } {
  const at = request.lastIndexOf(NAME_SEPARATOR);
  if (at <= 0) return { name: request, range: null };
  return { name: request.slice(0, at), range: request.slice(at + 1) };
}

function sourceFor(config: InstallConfig, range: string | null): DependencySource {
  if (config.path !== null && config.git !== null) {
    throw new UsageError("--path and --git cannot be combined");
  }
  if (config.path !== null) return { kind: "path", path: config.path };
  if (config.git !== null) return { kind: "git", url: config.git, reference: config.rev };
  return {
    kind: "registry",
    registry: DEFAULT_REGISTRY,
    range: parseRange(range ?? "*"),
  };
}

function addRequests(project: Project, config: InstallConfig): Project {
  if (config.requests.length === 0) return project;
  if ((config.path !== null || config.git !== null) && config.requests.length > 1) {
    throw new UsageError("--path and --git apply to a single package");
  }
  const kind: DependencyKind = config.dev ? "devDependencies" : "dependencies";
  let manifest = project.manifest;
  for (const request of config.requests) {
    const { name, range } = splitRequest(request);
    const dependency: Dependency = {
      name: parsePackageName(name),
      source: sourceFor(config, range),
    };
    manifest = withDependency(manifest, kind, dependency);
  }
  return writeManifest(project, manifest);
}

function reportChanges(names: readonly string[], verb: string): void {
  for (const name of names) console.log(`${verb} ${name}`);
}

export async function runInstall(config: InstallConfig): Promise<number> {
  const project = addRequests(loadProject(config.directory), config);
  const report = await install(project, { frozen: config.frozen });

  reportChanges(report.outcome.added, "added");
  reportChanges(report.outcome.updated, "updated");
  reportChanges(report.outcome.removed, "removed");

  for (const request of config.requests) {
    const { name } = splitRequest(request);
    const dependency = findDependency(project.manifest, parsePackageName(name));
    const locked = report.lock.packages.get(name);
    if (dependency === undefined || locked === undefined) continue;
    console.log(
      `${MANIFEST_FILE}: ${name} ${describeSource(dependency.source)} -> ${formatVersion(locked.version)}`,
    );
  }

  const total = report.lock.packages.size;
  const changed =
    report.outcome.added.length + report.outcome.updated.length + report.outcome.removed.length;
  console.log(
    `${total} package${total === 1 ? "" : "s"} installed${changed === 0 ? " (up to date)" : ""}`,
  );
  return 0;
}

export const INSTALL_COMMAND: CommandSpec<InstallConfig> = {
  name: "install",
  summary: "install dependencies, or add the named ones first",
  arguments: "[name[@range]...]",
  flags: [
    {
      name: "dev",
      short: "D",
      summary: "record added packages as development dependencies",
      apply: (config) => (config.dev = true),
    },
    {
      name: "frozen",
      summary: "fail instead of changing tera.lock",
      apply: (config) => (config.frozen = true),
    },
    {
      name: "path",
      value: "dir",
      summary: "take the added package from a local directory",
      apply: (config, value) => (config.path = value),
    },
    {
      name: "git",
      value: "url",
      summary: "take the added package from a git repository",
      apply: (config, value) => (config.git = value),
    },
    {
      name: "rev",
      value: "ref",
      summary: "git revision, tag or branch to check out",
      apply: (config, value) => (config.rev = value),
    },
    {
      name: "directory",
      short: "C",
      value: "dir",
      summary: "run in this directory instead of the current one",
      apply: (config, value) => (config.directory = value),
    },
  ],
  defaults: () => ({
    command: "install",
    requests: [],
    dev: false,
    frozen: false,
    path: null,
    git: null,
    rev: null,
    directory: ".",
  }),
  accept: (config, token) => config.requests.push(token),
};
