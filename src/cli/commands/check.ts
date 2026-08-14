import { compareWithPublished, surfaceTooling, verdictLines } from "../../core/breaking.js";
import { projectImports, resolvesLocally } from "../../core/imports.js";
import { allDependencies } from "../../core/manifest.js";
import { loadProject, type Project } from "../../core/project.js";
import { loadSurfaceTools } from "../../core/surface.js";
import { readState } from "../../core/tree.js";
import { parseVersion } from "../../core/version.js";
import { registryFor } from "./search.js";
import { UsageError, type CommandSpec } from "../args.js";

export type CheckConfig = {
  readonly command: "check";
  directory: string;
  breaking: boolean;
  baseline: string | null;
  registry: string | null;
};

const MINIMUM_SCOPED_SEGMENTS = 2;

function longestDeclaredPrefix(
  segments: readonly string[],
  declared: ReadonlySet<string>,
): string | null {
  for (let length = Math.min(segments.length, 4); length >= MINIMUM_SCOPED_SEGMENTS; length--) {
    const candidate = segments.slice(0, length).join(".");
    if (declared.has(candidate)) return candidate;
  }
  return null;
}

export async function surfaceVerdict(
  project: Project,
  config: { baseline: string | null; registry: string | null },
): Promise<number> {
  const report = await compareWithPublished(project, {
    registry: registryFor(config.registry),
    tooling: async () => surfaceTooling(await loadSurfaceTools()),
    baseline: config.baseline === null ? null : parseVersion(config.baseline),
  });
  if (report === null) {
    console.log("no earlier version is published, so there is nothing to compare");
    return 0;
  }
  for (const line of verdictLines(report)) {
    if (report.sufficient) console.log(line);
    else console.error(line);
  }
  return report.sufficient ? 0 : 1;
}

function importProblems(project: Project): number {
  const declared = new Set(
    allDependencies(project.manifest, true).map((dependency) => dependency.name.text),
  );
  const installed = readState(project.root).packages;
  const problems: string[] = [];
  const used = new Set<string>();

  for (const site of projectImports(project.root)) {
    if (site.path.length < MINIMUM_SCOPED_SEGMENTS) continue;
    if (resolvesLocally(project.root, site.path[0]!)) continue;
    const match = longestDeclaredPrefix(site.path, declared);
    if (match !== null) {
      used.add(match);
      if (!installed.has(match)) {
        problems.push(
          `${site.file}:${site.line}: '${match}' is declared but not installed (run 'peta install')`,
        );
      }
      continue;
    }
    const installedMatch = longestDeclaredPrefix(site.path, new Set(installed.keys()));
    const detail =
      installedMatch === null
        ? `no dependency provides '${site.path.join(".")}'`
        : `'${installedMatch}' is installed but not declared in tera.json`;
    problems.push(`${site.file}:${site.line}: ${detail}`);
  }

  for (const name of [...declared].sort()) {
    if (!used.has(name)) console.log(`unused: ${name} is declared but never imported`);
  }

  for (const problem of problems) console.error(problem);
  if (problems.length > 0) {
    console.error(`${problems.length} problem${problems.length === 1 ? "" : "s"}`);
    return 1;
  }
  console.log("every scoped import is declared and installed");
  return 0;
}

export async function runCheck(config: CheckConfig): Promise<number> {
  const project = loadProject(config.directory);
  const imports = importProblems(project);
  if (!config.breaking) return imports;
  return Math.max(imports, await surfaceVerdict(project, config));
}

export const CHECK_COMMAND: CommandSpec<CheckConfig> = {
  name: "check",
  summary: "audit imports against the declared and installed dependencies",
  arguments: "",
  flags: [
    {
      name: "directory",
      short: "C",
      value: "dir",
      summary: "run in this directory instead of the current one",
      apply: (config, value) => (config.directory = value),
    },
    {
      name: "breaking",
      summary: "diff this package's public surface against the published version below it",
      apply: (config) => (config.breaking = true),
    },
    {
      name: "baseline",
      value: "version",
      summary: "compare against this published version instead of the latest one below it",
      apply: (config, value) => {
        config.breaking = true;
        config.baseline = value;
      },
    },
    {
      name: "registry",
      value: "url",
      summary: "the hub to read published versions from (defaults to $PETA_REGISTRY)",
      apply: (config, value) => (config.registry = value),
    },
  ],
  defaults: () => ({
    command: "check",
    directory: ".",
    breaking: false,
    baseline: null,
    registry: null,
  }),
  accept: (_config, token) => {
    throw new UsageError(`'check' takes no arguments, got '${token}'`);
  },
};
