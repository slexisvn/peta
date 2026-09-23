import { DEFAULT_REGISTRY } from "../../core/source.js";
import {
  REGISTRY_VARIABLE,
  configuredRegistry,
  registryFrom,
  type Registry,
} from "../../registry/registry.js";
import { UsageError, type CommandSpec } from "../args.js";

export type SearchConfig = {
  readonly command: "search";
  query: string | null;
  registry: string | null;
};

export function registryFor(location: string | null): Registry {
  const registry =
    location === null ? configuredRegistry(DEFAULT_REGISTRY) : registryFrom(location, DEFAULT_REGISTRY);
  if (registry === null) {
    throw new UsageError(
      `no registry configured (run 'peta registry <path or url>', set ${REGISTRY_VARIABLE}, or pass --registry <path or url>)`,
    );
  }
  return registry;
}

export async function runSearch(config: SearchConfig): Promise<number> {
  const registry = registryFor(config.registry);
  const query = config.query ?? "";
  const hits = await registry.search(query);
  if (hits.length === 0) {
    console.log(query.length === 0 ? "the registry is empty" : `nothing matches '${query}'`);
    return 0;
  }
  for (const hit of hits) {
    const version = hit.version === null ? "" : ` ${hit.version}`;
    const description = hit.description === null ? "" : ` - ${hit.description}`;
    console.log(`${hit.name}${version}${description}`);
  }
  return 0;
}

export const SEARCH_COMMAND: CommandSpec<SearchConfig> = {
  name: "search",
  summary: "list packages the registry offers",
  arguments: "[query]",
  flags: [
    {
      name: "registry",
      value: "location",
      summary: "registry directory or base url to query",
      apply: (config, value) => (config.registry = value),
    },
  ],
  defaults: () => ({ command: "search", query: null, registry: null }),
  accept: (config, token) => {
    if (config.query !== null) throw new UsageError(`search takes one query, got '${token}'`);
    config.query = token;
  },
};
