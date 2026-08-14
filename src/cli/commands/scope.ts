import { clientFor } from "./auth.js";
import { UsageError, type CommandSpec } from "../args.js";

export type ScopeConfig = {
  readonly command: "scope";
  name: string | null;
  registry: string | null;
};

export async function runScope(config: ScopeConfig): Promise<number> {
  const client = clientFor(config.registry, true);
  if (config.name === null) {
    const identity = await client.whoami();
    if (identity.scopes.length === 0) {
      console.log("you own no scopes yet (claim one with 'peta scope <name>')");
      return 0;
    }
    for (const scope of identity.scopes) console.log(scope);
    return 0;
  }
  await client.claimScope(config.name);
  console.log(`you now own '${config.name}'; publish under ${config.name}.<package>`);
  return 0;
}

export const SCOPE_COMMAND: CommandSpec<ScopeConfig> = {
  name: "scope",
  summary: "list the scopes you own, or claim one",
  arguments: "[name]",
  flags: [
    {
      name: "registry",
      value: "url",
      summary: "the hub to talk to (defaults to $PETA_REGISTRY)",
      apply: (config, value) => (config.registry = value),
    },
  ],
  defaults: () => ({ command: "scope", name: null, registry: null }),
  accept: (config, token) => {
    if (config.name !== null) throw new UsageError(`scope takes one name, got '${token}'`);
    config.name = token;
  },
};
