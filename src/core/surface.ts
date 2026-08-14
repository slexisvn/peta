import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  InterfaceError,
  type ModuleSurface,
  type PackageSurface,
  type TypeAcceptance,
} from "./interface-diff.js";
import { PACKAGE_INDEX } from "./layout.js";
import { modulePathOf, type PackageName } from "./name.js";
import type { Manifest } from "./manifest.js";

export const TERA_PACKAGE = "@slexisvn/tera";
export const TERA_FRONTEND = `${TERA_PACKAGE}/frontend`;
export const TERA_FRONTEND_NODE = `${TERA_FRONTEND}/node`;

type ModuleGraphLike = { readonly modules: ReadonlyMap<string, unknown> };

export type TeraFrontend = {
  buildModuleGraph(
    entryPath: string,
    options: { fileSystem: unknown; root?: string; searchPaths?: readonly string[] },
  ): ModuleGraphLike;
  checkModuleGraph(
    graph: ModuleGraphLike,
    options: { mode: string },
  ): { interfaces: ReadonlyMap<string, ModuleSurface> };
  searchPathsUnder(fileSystem: unknown, root: string): string[];
  typeAccepts: TypeAcceptance;
  ENTRY_SPEC: string;
};

export type SurfaceTools = {
  readonly frontend: TeraFrontend;
  readonly fileSystem: unknown;
  readonly accepts: TypeAcceptance;
};

async function importCompiler<T>(specifier: string): Promise<T> {
  try {
    return (await import(specifier)) as T;
  } catch (error) {
    const detail = error instanceof Error ? error.message.split("\n")[0] : String(error);
    throw new InterfaceError(
      `reading a public surface needs the compiler; install ${TERA_PACKAGE} (${detail})`,
    );
  }
}

export async function loadSurfaceTools(): Promise<SurfaceTools> {
  const loaded = await importCompiler<Partial<TeraFrontend>>(TERA_FRONTEND);
  const node = await importCompiler<{ nodeModuleFileSystem?: unknown }>(TERA_FRONTEND_NODE);
  if (
    typeof loaded.buildModuleGraph !== "function" ||
    typeof loaded.checkModuleGraph !== "function" ||
    typeof loaded.searchPathsUnder !== "function" ||
    typeof loaded.typeAccepts !== "function" ||
    typeof loaded.ENTRY_SPEC !== "string" ||
    node.nodeModuleFileSystem === undefined
  ) {
    throw new InterfaceError(
      `the installed ${TERA_PACKAGE} does not expose the surface API; upgrade it`,
    );
  }
  const frontend = loaded as TeraFrontend;
  return { frontend, fileSystem: node.nodeModuleFileSystem, accepts: frontend.typeAccepts };
}

function moduleEntryIn(root: string, manifest: Manifest): string {
  const entry = path.join(root, manifest.modules, PACKAGE_INDEX);
  if (!fs.existsSync(entry)) {
    throw new InterfaceError(
      `${manifest.modules}/${PACKAGE_INDEX} is missing, so the package has no public surface`,
    );
  }
  return entry;
}

function stageAsInstalled(root: string, manifest: Manifest, name: PackageName): string {
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), "peta-surface-"));
  const staged = path.join(staging, modulePathOf(name, path.sep));
  fs.mkdirSync(path.dirname(staged), { recursive: true });
  fs.cpSync(path.join(root, manifest.modules), staged, { recursive: true });
  return staging;
}

function ownedSurfaces(
  name: PackageName,
  entrySpec: string,
  interfaces: ReadonlyMap<string, ModuleSurface>,
): PackageSurface {
  const prefix = `${name.text}.`;
  const surface = new Map<string, ModuleSurface>();
  for (const [spec, module] of interfaces) {
    if (spec === entrySpec || spec === name.text) surface.set("", module);
    else if (spec.startsWith(prefix)) surface.set(spec.slice(prefix.length), module);
  }
  return surface;
}

export function packageSurface(
  root: string,
  manifest: Manifest,
  name: PackageName,
  tools: SurfaceTools,
): PackageSurface {
  moduleEntryIn(root, manifest);
  const staging = stageAsInstalled(root, manifest, name);
  try {
    const graph = tools.frontend.buildModuleGraph(
      path.join(staging, modulePathOf(name, path.sep), PACKAGE_INDEX),
      {
        fileSystem: tools.fileSystem,
        root: staging,
        searchPaths: tools.frontend.searchPathsUnder(tools.fileSystem, root),
      },
    );
    return ownedSurfaces(
      name,
      tools.frontend.ENTRY_SPEC,
      tools.frontend.checkModuleGraph(graph, { mode: "warn" }).interfaces,
    );
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}
