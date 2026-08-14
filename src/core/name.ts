import { PackageNameError } from "./errors.js";

export type PackageName = {
  readonly segments: readonly string[];
  readonly text: string;
};

export const SEGMENT_SEPARATOR = ".";
export const MAX_SEGMENTS = 4;

const SEGMENT_PATTERN = /^[a-z][a-z0-9_]*$/;

export type NameOptions = {
  readonly reserved?: ReadonlySet<string>;
};

type NameResult = { readonly name: PackageName } | { readonly problem: string };

function validate(text: string, options: NameOptions): NameResult {
  const segments = text.split(SEGMENT_SEPARATOR);
  if (segments.length > MAX_SEGMENTS) {
    return { problem: `has ${segments.length} segments (at most ${MAX_SEGMENTS} allowed)` };
  }
  for (const segment of segments) {
    if (segment.length === 0) return { problem: "must not contain an empty segment" };
    if (!SEGMENT_PATTERN.test(segment)) {
      return { problem: `segment '${segment}' must match [a-z][a-z0-9_]*` };
    }
  }
  const scope = segments[0]!;
  if (options.reserved?.has(scope) === true) {
    return { problem: `uses the reserved word '${scope}'` };
  }
  return { name: { segments, text } };
}

export function tryParsePackageName(text: string, options: NameOptions = {}): PackageName | null {
  const result = validate(text, options);
  return "name" in result ? result.name : null;
}

export function parsePackageName(text: string, options: NameOptions = {}): PackageName {
  const result = validate(text, options);
  if ("name" in result) return result.name;
  throw new PackageNameError(`package name '${text}' ${result.problem}`);
}

export function isReservedName(name: PackageName): boolean {
  return name.segments.length === 1;
}

export function scopeOf(name: PackageName): string {
  return name.segments[0]!;
}

export function modulePathOf(name: PackageName, separator: string): string {
  return name.segments.join(separator);
}

export function compareNames(left: PackageName, right: PackageName): number {
  return left.text < right.text ? -1 : left.text > right.text ? 1 : 0;
}
