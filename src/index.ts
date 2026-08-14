export {
  ARCHIVE_EXTENSION,
  ArchiveError,
  MAX_ARCHIVE_BYTES,
  MAX_ENTRIES,
  MAX_ENTRY_BYTES,
  archiveNameFor,
  extractArchive,
  integrityOf,
  packArchive,
  packageEntries,
  readArchive,
} from "./core/archive.js";
export type { ArchiveContents } from "./core/archive.js";
export { LocalSourceFetcher, CheckoutError } from "./core/checkout.js";
export type { Checkout, SourceFetcher } from "./core/checkout.js";
export {
  ContentError,
  DATA_EXTENSIONS,
  classify,
  isUnsafePath,
  requireAllowed,
} from "./core/content.js";
export type { ContentKind } from "./core/content.js";
export {
  ManifestError,
  PackageNameError,
  PetaError,
  VersionError,
  VersionRangeError,
} from "./core/errors.js";
export { Glob } from "./core/glob.js";
export {
  InterfaceError,
  compareImpact,
  describeChange,
  diffSurfaces,
  highestImpact,
  requiredVersion,
  verifyBump,
} from "./core/interface-diff.js";
export type {
  BumpVerdict,
  DiffOptions,
  Impact,
  ModuleSurface,
  PackageSurface,
  SurfaceAlias,
  SurfaceChange,
  SurfaceField,
  SurfaceInterface,
  SurfaceParam,
  SurfaceSignature,
  SurfaceValue,
  TypeAcceptance,
} from "./core/interface-diff.js";
export {
  breakingChanges,
  compareWithPublished,
  releasedPackage,
  surfaceTooling,
  verdictLines,
} from "./core/breaking.js";
export type { BreakingOptions, BreakingReport, SurfaceReader, SurfaceTooling } from "./core/breaking.js";
export { TERA_FRONTEND, TERA_PACKAGE, loadSurfaceTools, packageSurface } from "./core/surface.js";
export type { SurfaceTools, TeraFrontend } from "./core/surface.js";
export { cacheDirectory, teraHome } from "./core/home.js";
export { importsIn, projectImports, sourceFilesIn } from "./core/imports.js";
export type { ImportSite } from "./core/imports.js";
export { InstallError, install, resolveProject } from "./core/install.js";
export type { InstallOptions, InstallReport, Resolution } from "./core/install.js";
export {
  LOCK_FILE,
  MODULE_EXTENSION,
  PACKAGES_DIRECTORY,
  STATE_DIRECTORY,
} from "./core/layout.js";
export {
  LOCK_VERSION,
  LockError,
  dependentsOf,
  emptyLock,
  formatLock,
  parseLock,
  sortedPackages,
} from "./core/lock.js";
export type { LockFile, LockedPackage } from "./core/lock.js";
export {
  DEFAULT_MODULES,
  MANIFEST_FILE,
  allDependencies,
  emptyManifest,
  findDependency,
  formatManifest,
  parseManifest,
  withDependency,
  withoutDependency,
} from "./core/manifest.js";
export type { Dependency, DependencyKind, Manifest, ManifestOptions } from "./core/manifest.js";
export {
  MAX_SEGMENTS,
  SEGMENT_SEPARATOR,
  compareNames,
  isReservedName,
  modulePathOf,
  parsePackageName,
  scopeOf,
  tryParsePackageName,
} from "./core/name.js";
export type { NameOptions, PackageName } from "./core/name.js";
export {
  ProjectError,
  findProjectRoot,
  loadProject,
  packagesPathIn,
  readLock,
  readManifestAt,
  writeLock,
  writeManifest,
} from "./core/project.js";
export type { Project } from "./core/project.js";
export { ROOT_PACKAGE, ProjectProvider, ProviderError } from "./core/provider.js";
export {
  formatRange,
  maxSatisfying,
  parseRange,
  satisfies,
  tryParseRange,
} from "./core/range.js";
export type { Comparator, ComparatorOperator, Range } from "./core/range.js";
export {
  DEFAULT_REGISTRY,
  SourceError,
  describeSource,
  formatDependencySource,
  formatResolvedSource,
  isPinned,
  parseDependencySource,
  parseResolvedSource,
} from "./core/source.js";
export type { DependencySource, ResolvedSource } from "./core/source.js";
export { TarError, packTar, unpackTar } from "./core/tar.js";
export type { TarEntry } from "./core/tar.js";
export {
  installedPathFor,
  packageFiles,
  readState,
  syncTree,
  writeState,
} from "./core/tree.js";
export type { InstalledPackage, PackageContents, SyncOutcome, TreeState } from "./core/tree.js";
export {
  compareVersion,
  formatVersion,
  isPrerelease,
  nextMajor,
  nextMinor,
  nextPatch,
  parseVersion,
  sharesRelease,
  tryParseVersion,
} from "./core/version.js";
export type { Version } from "./core/version.js";
export {
  admitsPrerelease,
  complement,
  contains,
  difference,
  emptySet,
  formatSet,
  fromRange,
  fullSet,
  intersect,
  isEmpty,
  isFull,
  isSubset,
  setsEqual,
  singleton,
  union,
} from "./core/version-set.js";
export type { Bound, Interval, VersionSet } from "./core/version-set.js";
export {
  ARCHIVE_DIRECTORY,
  INDEX_DIRECTORY,
  IndexError,
  archivePathFor,
  entryFor,
  formatPackageIndex,
  indexPathFor,
  parsePackageIndex,
  selectableEntries,
} from "./registry/index-file.js";
export type { IndexEntry, IndexRequirement, PackageIndex } from "./registry/index-file.js";
export {
  FileRegistry,
  HttpRegistry,
  REGISTRY_VARIABLE,
  RegistryError,
  configuredRegistry,
  registryFrom,
  verifyIntegrity,
} from "./registry/registry.js";
export type { Registry, SearchHit } from "./registry/registry.js";
export { RegistryStore } from "./registry/store.js";
export type { StoredPackage } from "./registry/store.js";
export { SolveFailure, solve } from "./solver/solve.js";
export type { PackageProvider, ProviderDependency, SolveRequest } from "./solver/solve.js";
export { explain } from "./solver/report.js";
export type { Incompatibility, IncompatibilityCause } from "./solver/incompatibility.js";
