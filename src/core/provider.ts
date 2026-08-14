import { PetaError } from "./errors.js";
import { MANIFEST_FILE, allDependencies, type Manifest } from "./manifest.js";
import { parsePackageName, type NameOptions } from "./name.js";
import { isPinned } from "./source.js";
import {
  entryFor,
  selectableEntries,
  type IndexEntry,
  type PackageIndex,
} from "../registry/index-file.js";
import type { Registry } from "../registry/registry.js";
import { fromRange, fullSet, singleton, type VersionSet } from "./version-set.js";
import { compareVersion, parseVersion, type Version } from "./version.js";
import type { Checkout, SourceFetcher } from "./checkout.js";
import type { PackageProvider, ProviderDependency } from "../solver/solve.js";
import type { DependencySource } from "./source.js";

export const ROOT_PACKAGE = "(root)";

export class ProviderError extends PetaError {}

export type ProjectProviderOptions = {
  readonly root: string;
  readonly manifest: Manifest;
  readonly fetcher: SourceFetcher;
  readonly includeDev: boolean;
  readonly registry?: Registry | null;
  readonly names?: NameOptions;
  readonly preferred?: ReadonlyMap<string, Version>;
};

export class ProjectProvider implements PackageProvider {
  private readonly pins = new Map<string, Checkout>();
  private readonly indexes = new Map<string, PackageIndex | null>();

  constructor(private readonly options: ProjectProviderOptions) {}

  async indexFor(name: string): Promise<PackageIndex | null> {
    const registry = this.options.registry;
    if (registry === undefined || registry === null) return null;
    const cached = this.indexes.get(name);
    if (cached !== undefined) return cached;
    const index = await registry.index(parsePackageName(name, this.options.names));
    this.indexes.set(name, index);
    return index;
  }

  async entryFor(name: string, version: Version): Promise<IndexEntry | undefined> {
    const index = await this.indexFor(name);
    return index === null ? undefined : entryFor(index, version);
  }

  get rootName(): string {
    return this.options.manifest.name?.text ?? ROOT_PACKAGE;
  }

  get rootVersion(): Version {
    return this.options.manifest.version ?? parseVersion("0.0.0");
  }

  get registryName(): string | null {
    return this.options.registry?.name ?? null;
  }

  pinFor(name: string): Checkout | undefined {
    return this.pins.get(name);
  }

  preferred(name: string): Version | undefined {
    return this.options.preferred?.get(name);
  }

  async exists(name: string): Promise<boolean> {
    if (name === this.rootName || this.pins.has(name)) return true;
    return (await this.indexFor(name)) !== null;
  }

  async prepare(): Promise<void> {
    await this.registerPins(this.options.manifest, this.options.root, this.rootName, true);
  }

  async versions(name: string): Promise<readonly Version[]> {
    if (name === this.rootName) return [this.rootVersion];
    const checkout = this.pins.get(name);
    if (checkout !== undefined) return [this.versionOf(name, checkout)];
    const index = await this.indexFor(name);
    if (index === null) return [];
    const locked = this.preferred(name);
    return index.entries
      .filter(
        (entry) =>
          !entry.yanked ||
          (locked !== undefined && compareVersion(entry.version, locked) === 0),
      )
      .map((entry) => entry.version);
  }

  async dependencies(name: string, version: Version): Promise<readonly ProviderDependency[]> {
    const context = this.contextFor(name, version);
    if (context === null) return this.registryDependencies(name, version);
    await this.registerPins(context.manifest, context.directory, name, false);
    return allDependencies(context.manifest, this.includeDevFor(name)).map((dependency) => ({
      name: dependency.name.text,
      set: this.setFor(dependency.name.text, dependency.source),
    }));
  }

  private async registryDependencies(
    name: string,
    version: Version,
  ): Promise<readonly ProviderDependency[]> {
    const entry = await this.entryFor(name, version);
    if (entry === undefined) return [];
    return entry.dependencies.map((requirement) => ({
      name: requirement.name.text,
      set: this.pins.has(requirement.name.text)
        ? singleton(this.versionOf(requirement.name.text, this.pins.get(requirement.name.text)!))
        : fromRange(requirement.range),
    }));
  }

  private versionOf(name: string, checkout: Checkout): Version {
    const version = checkout.manifest.version;
    if (version === null) {
      throw new ProviderError(
        `'${name}' at ${checkout.directory} declares no version in its ${MANIFEST_FILE}`,
      );
    }
    return version;
  }

  private includeDevFor(name: string): boolean {
    return name === this.rootName && this.options.includeDev;
  }

  private contextFor(
    name: string,
    version: Version,
  ): { manifest: Manifest; directory: string } | null {
    if (name === this.rootName) {
      return { manifest: this.options.manifest, directory: this.options.root };
    }
    const checkout = this.pins.get(name);
    if (checkout === undefined) return null;
    const pinned = checkout.manifest.version;
    if (pinned === null || compareVersion(pinned, version) !== 0) return null;
    return { manifest: checkout.manifest, directory: checkout.directory };
  }

  private setFor(name: string, source: DependencySource): VersionSet {
    if (source.kind === "registry") return fromRange(source.range);
    const checkout = this.pins.get(name);
    return checkout === undefined ? fullSet() : singleton(this.versionOf(name, checkout));
  }

  private async registerPins(
    manifest: Manifest,
    directory: string,
    requestedBy: string,
    replace: boolean,
  ): Promise<void> {
    for (const dependency of allDependencies(manifest, this.includeDevFor(requestedBy))) {
      const name = dependency.name.text;
      if (!isPinned(dependency.source)) continue;
      if (!replace && this.pins.has(name)) continue;
      const checkout = await this.options.fetcher.fetch(
        dependency.source,
        directory,
        this.options.root,
      );
      this.assertIdentity(name, checkout, requestedBy);
      this.pins.set(name, checkout);
    }
  }

  private assertIdentity(name: string, checkout: Checkout, requestedBy: string): void {
    const declared = checkout.manifest.name;
    if (declared === null) {
      throw new ProviderError(
        `${requestedBy} depends on '${name}' at ${checkout.directory}, which declares no name`,
      );
    }
    if (declared.text !== name) {
      throw new ProviderError(
        `${requestedBy} depends on '${name}', but ${checkout.directory} declares '${declared.text}'`,
      );
    }
  }
}
