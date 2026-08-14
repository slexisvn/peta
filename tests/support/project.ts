import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type PackageSpec = {
  readonly name?: string;
  readonly version?: string;
  readonly modules?: string;
  readonly dependencies?: Record<string, unknown>;
  readonly devDependencies?: Record<string, unknown>;
  readonly tasks?: Record<string, string>;
  readonly files?: Record<string, string>;
};

export class Sandbox {
  constructor(readonly root: string) {}

  static create(label: string): Sandbox {
    return new Sandbox(fs.mkdtempSync(path.join(os.tmpdir(), `peta-${label}-`)));
  }

  at(...segments: string[]): string {
    return path.join(this.root, ...segments);
  }

  write(relative: string, contents: string): string {
    const target = this.at(...relative.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents, "utf8");
    return target;
  }

  writeBytes(relative: string, contents: Buffer): string {
    const target = this.at(...relative.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
    return target;
  }

  read(relative: string): string {
    return fs.readFileSync(this.at(...relative.split("/")), "utf8");
  }

  exists(relative: string): boolean {
    return fs.existsSync(this.at(...relative.split("/")));
  }

  list(relative: string): readonly string[] {
    const target = this.at(...relative.split("/"));
    return fs.existsSync(target) ? fs.readdirSync(target).sort() : [];
  }

  package(directory: string, spec: PackageSpec): string {
    const manifest: Record<string, unknown> = {};
    if (spec.name !== undefined) {
      manifest["name"] = spec.name;
      manifest["version"] = spec.version ?? "1.0.0";
    }
    manifest["modules"] = spec.modules ?? "src";
    if (spec.dependencies !== undefined) manifest["dependencies"] = spec.dependencies;
    if (spec.devDependencies !== undefined) manifest["devDependencies"] = spec.devDependencies;
    if (spec.tasks !== undefined) manifest["tasks"] = spec.tasks;
    this.write(`${directory}/tera.json`, `${JSON.stringify(manifest, null, 2)}\n`);
    const files = spec.files ?? { [`${spec.modules ?? "src"}/__init__.tera`]: "" };
    for (const [file, contents] of Object.entries(files)) {
      this.write(`${directory}/${file}`, contents);
    }
    return this.at(...directory.split("/"));
  }

  remove(): void {
    fs.rmSync(this.root, { recursive: true, force: true });
  }
}
