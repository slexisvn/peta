import {
  describeChange,
  diffSurfaces,
  verifyBump,
  type BumpVerdict,
  type Impact,
  type PackageSurface,
  type SurfaceChange,
  type TypeAcceptance,
} from "./interface-diff.js";
import { packageSurface, type SurfaceTools } from "./surface.js";
import { compareVersion, formatVersion, type Version } from "./version.js";
import type { Manifest } from "./manifest.js";
import type { PackageName } from "./name.js";
import type { Project } from "./project.js";
import { RegistryStore } from "../registry/store.js";
import { entryFor, type IndexEntry } from "../registry/index-file.js";
import type { Registry } from "../registry/registry.js";
import { InterfaceError } from "./interface-diff.js";

export type SurfaceReader = (
  root: string,
  manifest: Manifest,
  name: PackageName,
) => PackageSurface;

export type BreakingOptions = {
  readonly registry: Registry;
  readonly tooling: () => Promise<SurfaceTooling>;
  readonly baseline?: Version | null;
};

export type SurfaceTooling = {
  readonly surfaceOf: SurfaceReader;
  readonly accepts: TypeAcceptance;
};

export function surfaceTooling(tools: SurfaceTools): SurfaceTooling {
  return {
    surfaceOf: (root, manifest, name) => packageSurface(root, manifest, name, tools),
    accepts: tools.accepts,
  };
}

export type BreakingReport = BumpVerdict & {
  readonly name: PackageName;
  readonly baseline: Version;
  readonly declared: Version;
};

export type PublishedPackage = {
  readonly name: PackageName;
  readonly version: Version;
};

function publishedBefore(
  entries: readonly IndexEntry[],
  declared: Version,
): IndexEntry | null {
  let best: IndexEntry | null = null;
  for (const entry of entries) {
    if (compareVersion(entry.version, declared) >= 0) continue;
    if (best === null || compareVersion(entry.version, best.version) > 0) best = entry;
  }
  return best;
}

export function releasedPackage(project: Project): PublishedPackage {
  const { name, version } = project.manifest;
  if (name === null || version === null) {
    throw new InterfaceError("only a named, versioned package has a public surface to compare");
  }
  return { name, version };
}

export async function compareWithPublished(
  project: Project,
  options: BreakingOptions,
): Promise<BreakingReport | null> {
  const released = releasedPackage(project);
  const index = await options.registry.index(released.name);
  if (index === null) return null;
  const baselineEntry =
    options.baseline === undefined || options.baseline === null
      ? publishedBefore(index.entries, released.version)
      : entryFor(index, options.baseline) ?? null;
  if (baselineEntry === null) {
    if (options.baseline === undefined || options.baseline === null) return null;
    throw new InterfaceError(
      `${released.name.text} ${formatVersion(options.baseline)} is not on ${options.registry.name}`,
    );
  }

  const tooling = await options.tooling();
  const store = new RegistryStore(options.registry);
  const stored = await store.materialize(released.name, baselineEntry.version, baselineEntry);
  const previous = tooling.surfaceOf(stored.directory, stored.manifest, released.name);
  const next = tooling.surfaceOf(project.root, project.manifest, released.name);
  const changes = diffSurfaces(previous, next, { accepts: tooling.accepts });
  return {
    ...verifyBump(baselineEntry.version, released.version, changes),
    name: released.name,
    baseline: baselineEntry.version,
    declared: released.version,
  };
}

export function breakingChanges(report: BreakingReport): readonly SurfaceChange[] {
  return report.changes.filter((change) => change.impact === "breaking");
}

const IMPACT_MARKS: Record<Impact, string> = {
  breaking: "breaking",
  additive: "added",
  compatible: "unchanged",
};

const IMPACT_SUMMARIES: Record<Impact, string> = {
  breaking: "a breaking change",
  additive: "an added surface",
  compatible: "an unchanged surface",
};

export function verdictLines(report: BreakingReport): readonly string[] {
  const from = formatVersion(report.baseline);
  const to = formatVersion(report.declared);
  const lines = [`${report.name.text} ${from} -> ${to}`];
  for (const change of report.changes) {
    lines.push(`  ${IMPACT_MARKS[change.impact]}: ${describeChange(change)}`);
  }
  if (report.changes.length === 0) lines.push("  the public surface is unchanged");
  lines.push(
    report.sufficient
      ? `${to} is enough for ${IMPACT_SUMMARIES[report.impact]}`
      : `${IMPACT_SUMMARIES[report.impact]} needs ${formatVersion(report.required)} or higher, not ${to}`,
  );
  return lines;
}
