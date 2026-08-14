import { intersectTerms, type Term } from "./term.js";

export type IncompatibilityCause =
  | { readonly kind: "root" }
  | { readonly kind: "dependency" }
  | { readonly kind: "noVersions" }
  | { readonly kind: "unknownPackage"; readonly reason: string }
  | { readonly kind: "conflict"; readonly left: Incompatibility; readonly right: Incompatibility };

export type Incompatibility = {
  readonly id: number;
  readonly terms: readonly Term[];
  readonly cause: IncompatibilityCause;
};

let nextId = 0;

function normalize(
  terms: readonly Term[],
  cause: IncompatibilityCause,
  root: string,
): readonly Term[] {
  const withoutRoot =
    terms.length !== 1 &&
    cause.kind === "conflict" &&
    terms.some((term) => term.positive && term.package === root)
      ? terms.filter((term) => !term.positive || term.package !== root)
      : terms;
  if (withoutRoot.length <= 1) return withoutRoot;
  const byPackage = new Map<string, Term>();
  const order: string[] = [];
  for (const term of withoutRoot) {
    const existing = byPackage.get(term.package);
    if (existing === undefined) {
      byPackage.set(term.package, term);
      order.push(term.package);
      continue;
    }
    byPackage.set(term.package, intersectTerms(existing, term));
  }
  return order.map((name) => byPackage.get(name)!);
}

export function incompatibility(
  terms: readonly Term[],
  cause: IncompatibilityCause,
  root: string,
): Incompatibility {
  return { id: nextId++, terms: normalize(terms, cause, root), cause };
}

export function isFailure(target: Incompatibility, root: string): boolean {
  if (target.terms.length === 0) return true;
  const only = target.terms[0];
  return target.terms.length === 1 && only!.package === root && only!.positive;
}

export function termFor(target: Incompatibility, name: string): Term | undefined {
  return target.terms.find((term) => term.package === name);
}
