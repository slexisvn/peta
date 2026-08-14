import { PetaError } from "./errors.js";
import { caretBound } from "./range.js";
import { compareVersion, nextMinor, nextPatch, type Version } from "./version.js";

export class InterfaceError extends PetaError {}

export type SurfaceParam = {
  readonly name: string;
  readonly type: string;
  readonly optional?: boolean;
  readonly rest?: boolean;
};

export type SurfaceSignature = {
  readonly name: string;
  readonly typeParams?: readonly string[];
  readonly params: readonly SurfaceParam[];
  readonly returns: string;
};

export type SurfaceValue = {
  readonly name: string;
  readonly type: string;
};

export type SurfaceAlias = {
  readonly name: string;
  readonly typeParams?: readonly string[];
  readonly type: string;
};

export type SurfaceField = {
  readonly type: string;
  readonly optional?: boolean;
};

export type SurfaceInterface = {
  readonly name: string;
  readonly typeParams?: readonly string[];
  readonly fields: Readonly<Record<string, SurfaceField>>;
};

export type ModuleSurface = {
  readonly builtins?: readonly SurfaceSignature[];
  readonly values?: readonly SurfaceValue[];
  readonly aliases?: readonly SurfaceAlias[];
  readonly interfaces?: readonly SurfaceInterface[];
};

export type PackageSurface = ReadonlyMap<string, ModuleSurface>;

export type Impact = "compatible" | "additive" | "breaking";

export type SurfaceChange = {
  readonly impact: Impact;
  readonly module: string;
  readonly symbol: string;
  readonly reason: string;
};

export type TypeAcceptance = (actual: string, expected: string) => boolean;

export type DiffOptions = {
  readonly accepts?: TypeAcceptance;
};

const IMPACT_ORDER: readonly Impact[] = ["compatible", "additive", "breaking"];

const KIND_LABELS = {
  builtins: "function",
  values: "value",
  aliases: "type alias",
  interfaces: "interface",
} as const;

type SurfaceKind = keyof typeof KIND_LABELS;

const KINDS = Object.keys(KIND_LABELS) as readonly SurfaceKind[];

type Named = { readonly name: string };

export function compareImpact(left: Impact, right: Impact): number {
  return IMPACT_ORDER.indexOf(left) - IMPACT_ORDER.indexOf(right);
}

export function highestImpact(changes: readonly SurfaceChange[]): Impact {
  let highest: Impact = "compatible";
  for (const change of changes) {
    if (compareImpact(change.impact, highest) > 0) highest = change.impact;
  }
  return highest;
}

function entriesOf(surface: ModuleSurface, kind: SurfaceKind): ReadonlyMap<string, Named> {
  const entries = new Map<string, Named>();
  for (const entry of (surface[kind] ?? []) as readonly Named[]) entries.set(entry.name, entry);
  return entries;
}

function sameTypeParams(left: Named, right: Named): boolean {
  const previous = (left as { typeParams?: readonly string[] }).typeParams ?? [];
  const next = (right as { typeParams?: readonly string[] }).typeParams ?? [];
  return previous.length === next.length && previous.every((name, at) => name === next[at]);
}

function paramLabel(param: SurfaceParam): string {
  return param.rest === true ? `...${param.name}` : param.name;
}

function requiredParams(signature: SurfaceSignature): readonly SurfaceParam[] {
  return signature.params.filter((param) => param.optional !== true && param.rest !== true);
}

class Differ {
  private readonly changes: SurfaceChange[] = [];
  private readonly accepts: TypeAcceptance;

  constructor(options: DiffOptions) {
    this.accepts = options.accepts ?? ((actual, expected) => actual === expected);
  }

  private add(impact: Impact, module: string, symbol: string, reason: string): void {
    this.changes.push({ impact, module, symbol, reason });
  }

  private widens(previous: string, next: string): boolean {
    return this.accepts(previous, next);
  }

  private narrows(previous: string, next: string): boolean {
    return this.accepts(next, previous);
  }

  private diffSignature(module: string, previous: SurfaceSignature, next: SurfaceSignature): void {
    if (!sameTypeParams(previous, next)) {
      this.add("breaking", module, previous.name, "its type parameters changed");
    }
    for (const [at, param] of previous.params.entries()) {
      const replacement = next.params[at];
      if (replacement === undefined) {
        this.add("breaking", module, previous.name, `parameter '${paramLabel(param)}' was removed`);
        continue;
      }
      if (param.name !== replacement.name) {
        this.add(
          "breaking",
          module,
          previous.name,
          `parameter '${paramLabel(param)}' was renamed to '${paramLabel(replacement)}'`,
        );
      }
      if (param.optional !== true && replacement.optional === true) {
        this.add("additive", module, previous.name, `parameter '${paramLabel(param)}' became optional`);
      }
      if (param.optional === true && replacement.optional !== true) {
        this.add("breaking", module, previous.name, `parameter '${paramLabel(param)}' became required`);
      }
      if (param.type === replacement.type) continue;
      if (this.widens(param.type, replacement.type)) {
        this.add(
          "additive",
          module,
          previous.name,
          `parameter '${paramLabel(param)}' widened from '${param.type}' to '${replacement.type}'`,
        );
        continue;
      }
      this.add(
        "breaking",
        module,
        previous.name,
        `parameter '${paramLabel(param)}' changed from '${param.type}' to '${replacement.type}'`,
      );
    }
    for (const param of next.params.slice(previous.params.length)) {
      const impact = param.optional === true || param.rest === true ? "additive" : "breaking";
      this.add(impact, module, next.name, `parameter '${paramLabel(param)}' was added`);
    }
    if (previous.returns === next.returns) return;
    if (this.narrows(previous.returns, next.returns)) {
      this.add(
        "additive",
        module,
        previous.name,
        `it now returns '${next.returns}' instead of '${previous.returns}'`,
      );
      return;
    }
    this.add(
      "breaking",
      module,
      previous.name,
      `it returns '${next.returns}' where it returned '${previous.returns}'`,
    );
  }

  private diffValue(module: string, previous: SurfaceValue, next: SurfaceValue): void {
    if (previous.type === next.type) return;
    if (this.narrows(previous.type, next.type)) {
      this.add("additive", module, previous.name, `its type narrowed to '${next.type}'`);
      return;
    }
    this.add(
      "breaking",
      module,
      previous.name,
      `its type changed from '${previous.type}' to '${next.type}'`,
    );
  }

  private diffAlias(module: string, previous: SurfaceAlias, next: SurfaceAlias): void {
    if (!sameTypeParams(previous, next)) {
      this.add("breaking", module, previous.name, "its type parameters changed");
      return;
    }
    if (previous.type === next.type) return;
    this.add(
      "breaking",
      module,
      previous.name,
      `it now stands for '${next.type}' instead of '${previous.type}'`,
    );
  }

  private diffInterface(module: string, previous: SurfaceInterface, next: SurfaceInterface): void {
    if (!sameTypeParams(previous, next)) {
      this.add("breaking", module, previous.name, "its type parameters changed");
    }
    for (const [field, binding] of Object.entries(previous.fields)) {
      const replacement = next.fields[field];
      if (replacement === undefined) {
        this.add("breaking", module, `${previous.name}.${field}`, "it was removed");
        continue;
      }
      if (binding.optional !== true && replacement.optional === true) {
        this.add("breaking", module, `${previous.name}.${field}`, "it became optional");
      }
      if (binding.type === replacement.type) continue;
      this.add(
        "breaking",
        module,
        `${previous.name}.${field}`,
        `its type changed from '${binding.type}' to '${replacement.type}'`,
      );
    }
    for (const [field, binding] of Object.entries(next.fields)) {
      if (previous.fields[field] !== undefined) continue;
      const impact = binding.optional === true ? "additive" : "breaking";
      this.add(impact, module, `${next.name}.${field}`, "it was added");
    }
  }

  private diffMember(module: string, kind: SurfaceKind, previous: Named, next: Named): void {
    if (kind === "builtins") {
      this.diffSignature(module, previous as SurfaceSignature, next as SurfaceSignature);
      return;
    }
    if (kind === "values") {
      this.diffValue(module, previous as SurfaceValue, next as SurfaceValue);
      return;
    }
    if (kind === "aliases") {
      this.diffAlias(module, previous as SurfaceAlias, next as SurfaceAlias);
      return;
    }
    this.diffInterface(module, previous as SurfaceInterface, next as SurfaceInterface);
  }

  private kindOf(surface: ModuleSurface, name: string): SurfaceKind | null {
    for (const kind of KINDS) {
      if (entriesOf(surface, kind).has(name)) return kind;
    }
    return null;
  }

  private diffModule(module: string, previous: ModuleSurface, next: ModuleSurface): void {
    for (const kind of KINDS) {
      const before = entriesOf(previous, kind);
      const after = entriesOf(next, kind);
      for (const [name, entry] of before) {
        const replacement = after.get(name);
        if (replacement !== undefined) {
          this.diffMember(module, kind, entry, replacement);
          continue;
        }
        const moved = this.kindOf(next, name);
        this.add(
          "breaking",
          module,
          name,
          moved === null
            ? `the ${KIND_LABELS[kind]} was removed`
            : `it is a ${KIND_LABELS[moved]} now, not a ${KIND_LABELS[kind]}`,
        );
      }
      for (const [name] of after) {
        if (before.has(name) || this.kindOf(previous, name) !== null) continue;
        this.add("additive", module, name, `a ${KIND_LABELS[kind]} was added`);
      }
    }
  }

  run(previous: PackageSurface, next: PackageSurface): readonly SurfaceChange[] {
    for (const [module, surface] of previous) {
      const replacement = next.get(module);
      if (replacement === undefined) {
        this.add("breaking", module, module, "the module was removed");
        continue;
      }
      this.diffModule(module, surface, replacement);
    }
    for (const [module] of next) {
      if (previous.has(module)) continue;
      this.add("additive", module, module, "the module was added");
    }
    return this.changes;
  }
}

export function diffSurfaces(
  previous: PackageSurface,
  next: PackageSurface,
  options: DiffOptions = {},
): readonly SurfaceChange[] {
  return new Differ(options).run(previous, next);
}

export function describeChange(change: SurfaceChange): string {
  const where = change.module.length === 0 ? change.symbol : `${change.module}.${change.symbol}`;
  return `${where}: ${change.reason}`;
}

function additiveBound(version: Version): Version {
  const minor = nextMinor(version);
  return compareVersion(minor, caretBound(version)) < 0 ? minor : nextPatch(version);
}

export function requiredVersion(previous: Version, impact: Impact): Version {
  if (impact === "breaking") return caretBound(previous);
  if (impact === "additive") return additiveBound(previous);
  return nextPatch(previous);
}

export type BumpVerdict = {
  readonly impact: Impact;
  readonly required: Version;
  readonly sufficient: boolean;
  readonly changes: readonly SurfaceChange[];
};

export function verifyBump(
  previous: Version,
  declared: Version,
  changes: readonly SurfaceChange[],
): BumpVerdict {
  const impact = highestImpact(changes);
  const required = requiredVersion(previous, impact);
  return {
    impact,
    required,
    sufficient: compareVersion(declared, required) >= 0,
    changes,
  };
}
