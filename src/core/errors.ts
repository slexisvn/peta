export class PetaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class VersionError extends PetaError {}

export class VersionRangeError extends PetaError {}

export class PackageNameError extends PetaError {}

export class ManifestError extends PetaError {
  constructor(readonly path: readonly string[], message: string) {
    super(path.length === 0 ? message : `${path.join(".")}: ${message}`);
  }
}
