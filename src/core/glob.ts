const SPECIAL = /[.+^${}()|[\]\\]/g;

function segmentPattern(segment: string): string {
  let source = "";
  for (let at = 0; at < segment.length; at++) {
    const character = segment[at]!;
    if (character === "*") source += "[^/]*";
    else if (character === "?") source += "[^/]";
    else source += character.replace(SPECIAL, "\\$&");
  }
  return source;
}

function toRegExp(pattern: string): RegExp {
  const segments = pattern.split("/").filter((segment) => segment.length > 0);
  let source = "^";
  segments.forEach((segment, at) => {
    const last = at === segments.length - 1;
    if (segment === "**") {
      source += last ? "(?:.*)?" : "(?:[^/]+/)*";
      return;
    }
    source += segmentPattern(segment);
    if (!last) source += "/";
  });
  return new RegExp(`${source}$`);
}

export class Glob {
  private readonly patterns: readonly RegExp[];

  constructor(patterns: readonly string[]) {
    this.patterns = patterns.map(toRegExp);
  }

  get empty(): boolean {
    return this.patterns.length === 0;
  }

  matches(relativePath: string): boolean {
    if (this.empty) return true;
    const normalized = relativePath.split("\\").join("/");
    return this.patterns.some((pattern) => pattern.test(normalized));
  }
}
