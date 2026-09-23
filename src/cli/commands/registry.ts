import { configPath } from "../../core/home.js";
import {
  configuredRegistry as savedRegistry,
  forgetRegistry,
  rememberRegistry,
} from "../../registry/config.js";
import {
  REGISTRY_VARIABLE,
  configuredRegistryLocation,
  normalizeRegistryLocation,
} from "../../registry/registry.js";
import { UsageError, type CommandSpec } from "../args.js";

export type RegistryConfig = {
  readonly command: "registry";
  registry: string | null;
  unset: boolean;
};

function envRegistry(): string | null {
  const value = process.env[REGISTRY_VARIABLE];
  return value === undefined || value.length === 0 ? null : value;
}

export function runRegistry(config: RegistryConfig): number {
  if (config.unset) {
    if (config.registry !== null) throw new UsageError("'registry --unset' takes no registry URL");
    if (forgetRegistry()) console.log(`registry removed from ${configPath()}`);
    else console.log("no saved registry");
    return 0;
  }

  if (config.registry !== null) {
    const registry = normalizeRegistryLocation(config.registry);
    rememberRegistry(registry);
    console.log(`registry set to ${registry}`);
    console.log(`stored in ${configPath()}`);
    if (envRegistry() !== null) {
      console.log(`${REGISTRY_VARIABLE} is set and overrides the saved registry`);
    }
    return 0;
  }

  const active = configuredRegistryLocation();
  if (active === null) {
    console.log(`no registry configured (run 'peta registry <url>' or set ${REGISTRY_VARIABLE})`);
    return 0;
  }
  const env = envRegistry();
  const source =
    env !== null ? `$${REGISTRY_VARIABLE}` : savedRegistry() !== null ? configPath() : "default";
  console.log(`${active} (${source})`);
  return 0;
}

export const REGISTRY_COMMAND: CommandSpec<RegistryConfig> = {
  name: "registry",
  summary: "show or set the default registry",
  arguments: "[url]",
  flags: [
    {
      name: "unset",
      summary: "forget the saved default registry",
      apply: (config) => (config.unset = true),
    },
  ],
  defaults: () => ({ command: "registry", registry: null, unset: false }),
  accept: (config, token) => {
    if (config.registry !== null) throw new UsageError(`registry takes one URL, got '${token}'`);
    config.registry = token;
  },
};
