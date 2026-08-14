import fs from "node:fs";
import path from "node:path";
import { PetaError } from "../core/errors.js";
import { credentialsPath } from "../core/home.js";

export class CredentialsError extends PetaError {}

export type Credentials = ReadonlyMap<string, string>;

const FILE_MODE = 0o600;

export function normalizeRegistry(location: string): string {
  return location.endsWith("/") ? location.slice(0, -1) : location;
}

export function readCredentials(): Credentials {
  const target = credentialsPath();
  if (!fs.existsSync(target)) return new Map();
  let source: unknown;
  try {
    source = JSON.parse(fs.readFileSync(target, "utf8"));
  } catch {
    throw new CredentialsError(`${target} is not valid JSON; fix or delete it`);
  }
  if (typeof source !== "object" || source === null || Array.isArray(source)) {
    throw new CredentialsError(`${target} should hold an object of registry to token`);
  }
  const entries = new Map<string, string>();
  for (const [registry, token] of Object.entries(source as Record<string, unknown>)) {
    if (typeof token !== "string") continue;
    entries.set(normalizeRegistry(registry), token);
  }
  return entries;
}

function writeCredentials(entries: Credentials): void {
  const target = credentialsPath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const document: Record<string, string> = {};
  for (const key of [...entries.keys()].sort()) document[key] = entries.get(key)!;
  fs.writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`, {
    encoding: "utf8",
    mode: FILE_MODE,
  });
  try {
    fs.chmodSync(target, FILE_MODE);
  } catch {
    return;
  }
}

export function tokenFor(registry: string): string | null {
  return readCredentials().get(normalizeRegistry(registry)) ?? null;
}

export function rememberToken(registry: string, token: string): void {
  const entries = new Map(readCredentials());
  entries.set(normalizeRegistry(registry), token);
  writeCredentials(entries);
}

export function forgetToken(registry: string): boolean {
  const entries = new Map(readCredentials());
  const removed = entries.delete(normalizeRegistry(registry));
  if (removed) writeCredentials(entries);
  return removed;
}
