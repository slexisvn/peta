import { PetaError } from "./errors.js";
import { formatRange, parseRange, type Range } from "./range.js";

export const DEFAULT_REGISTRY = "petahub";

export class SourceError extends PetaError {}

export type DependencySource =
  | { readonly kind: "registry"; readonly registry: string; readonly range: Range }
  | { readonly kind: "path"; readonly path: string }
  | { readonly kind: "git"; readonly url: string; readonly reference: string | null };

export type ResolvedSource =
  | { readonly kind: "registry"; readonly registry: string }
  | { readonly kind: "path"; readonly path: string }
  | { readonly kind: "git"; readonly url: string; readonly revision: string };

const GIT_PREFIX = "git+";
const PATH_PREFIX = "path:";
const REVISION_SEPARATOR = "#";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textField(source: Record<string, unknown>, field: string): string | null {
  const value = source[field];
  if (value === undefined) return null;
  if (typeof value !== "string" || value.length === 0) {
    throw new SourceError(`'${field}' expects a non-empty string`);
  }
  return value;
}

export function parseDependencySource(value: unknown): DependencySource {
  if (typeof value === "string") {
    return { kind: "registry", registry: DEFAULT_REGISTRY, range: parseRange(value) };
  }
  if (!isRecord(value)) throw new SourceError("expected a version range or a source object");
  const path = textField(value, "path");
  const git = textField(value, "git");
  const version = textField(value, "version");
  if (path !== null && git !== null) {
    throw new SourceError("a dependency cannot be both a path and a git source");
  }
  if (path !== null) {
    if (version !== null) throw new SourceError("a path dependency cannot pin a version");
    return { kind: "path", path };
  }
  if (git !== null) {
    if (version !== null) throw new SourceError("a git dependency cannot pin a version");
    return { kind: "git", url: git, reference: textField(value, "rev") };
  }
  if (version !== null) {
    const registry = textField(value, "registry");
    return {
      kind: "registry",
      registry: registry ?? DEFAULT_REGISTRY,
      range: parseRange(version),
    };
  }
  throw new SourceError("expected one of 'version', 'path' or 'git'");
}

export function formatDependencySource(source: DependencySource): string | Record<string, string> {
  switch (source.kind) {
    case "registry":
      return source.registry === DEFAULT_REGISTRY
        ? formatRange(source.range)
        : { version: formatRange(source.range), registry: source.registry };
    case "path":
      return { path: source.path };
    case "git":
      return source.reference === null
        ? { git: source.url }
        : { git: source.url, rev: source.reference };
  }
}

export function describeSource(source: DependencySource): string {
  switch (source.kind) {
    case "registry":
      return formatRange(source.range);
    case "path":
      return `path ${source.path}`;
    case "git":
      return source.reference === null ? `git ${source.url}` : `git ${source.url}#${source.reference}`;
  }
}

export function isPinned(source: DependencySource): boolean {
  return source.kind !== "registry";
}

export function parseResolvedSource(text: string): ResolvedSource {
  if (text.startsWith(PATH_PREFIX)) {
    const path = text.slice(PATH_PREFIX.length);
    if (path.length === 0) throw new SourceError(`missing path in source '${text}'`);
    return { kind: "path", path };
  }
  if (text.startsWith(GIT_PREFIX)) {
    const body = text.slice(GIT_PREFIX.length);
    const separator = body.lastIndexOf(REVISION_SEPARATOR);
    if (separator <= 0 || separator === body.length - 1) {
      throw new SourceError(`git source '${text}' must name a resolved revision`);
    }
    return { kind: "git", url: body.slice(0, separator), revision: body.slice(separator + 1) };
  }
  if (text.length === 0) throw new SourceError("empty source");
  return { kind: "registry", registry: text };
}

export function formatResolvedSource(source: ResolvedSource): string {
  switch (source.kind) {
    case "registry":
      return source.registry;
    case "path":
      return `${PATH_PREFIX}${source.path}`;
    case "git":
      return `${GIT_PREFIX}${source.url}${REVISION_SEPARATOR}${source.revision}`;
  }
}
