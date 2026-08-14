import fs from "node:fs";
import { credentialsPath } from "../../core/home.js";
import { DEFAULT_REGISTRY } from "../../core/source.js";
import { HubClient } from "../../registry/client.js";
import { forgetToken, rememberToken, tokenFor } from "../../registry/credentials.js";
import { REGISTRY_VARIABLE } from "../../registry/registry.js";
import { UsageError, type CommandSpec } from "../args.js";

export type LoginConfig = {
  readonly command: "login";
  registry: string | null;
  token: string | null;
};

export type LogoutConfig = {
  readonly command: "logout";
  registry: string | null;
};

export type WhoamiConfig = {
  readonly command: "whoami";
  registry: string | null;
};

export function registryUrl(override: string | null): string {
  const location = override ?? process.env[REGISTRY_VARIABLE] ?? null;
  if (location === null) {
    throw new UsageError(
      `no registry configured (set ${REGISTRY_VARIABLE} or pass --registry <url>)`,
    );
  }
  return location;
}

export function clientFor(override: string | null, needsToken: boolean): HubClient {
  const registry = registryUrl(override);
  const token = tokenFor(registry);
  if (needsToken && token === null) {
    throw new UsageError(`not signed in to ${registry} (run 'peta login')`);
  }
  return new HubClient(registry, token);
}

function readStdin(): string {
  try {
    return fs.readFileSync(0, "utf8").trim();
  } catch {
    return "";
  }
}

const REGISTRY_FLAG = {
  name: "registry",
  value: "url",
  summary: "the hub to talk to (defaults to $PETA_REGISTRY)",
} as const;

export async function runLogin(config: LoginConfig): Promise<number> {
  const registry = registryUrl(config.registry);
  const token = config.token ?? readStdin();
  if (token.length === 0) {
    throw new UsageError(
      "no token given; pipe it in ('peta login < token.txt') or pass --token",
    );
  }
  const identity = await new HubClient(registry, token).whoami();
  rememberToken(registry, token);
  console.log(`signed in to ${registry} as ${identity.login}`);
  if (identity.scopes.length > 0) console.log(`scopes: ${identity.scopes.join(", ")}`);
  console.log(`token stored in ${credentialsPath()}`);
  return 0;
}

export function runLogout(config: LogoutConfig): number {
  const registry = registryUrl(config.registry);
  if (!forgetToken(registry)) {
    console.log(`no stored token for ${registry}`);
    return 0;
  }
  console.log(`signed out of ${registry}`);
  return 0;
}

export async function runWhoami(config: WhoamiConfig): Promise<number> {
  const client = clientFor(config.registry, true);
  const identity = await client.whoami();
  console.log(identity.name === null ? identity.login : `${identity.login} (${identity.name})`);
  console.log(
    identity.scopes.length === 0
      ? "no scopes owned yet"
      : `scopes: ${identity.scopes.join(", ")}`,
  );
  return 0;
}

export const LOGIN_COMMAND: CommandSpec<LoginConfig> = {
  name: "login",
  summary: `store a ${DEFAULT_REGISTRY} token for publishing`,
  arguments: "",
  flags: [
    { ...REGISTRY_FLAG, apply: (config, value) => (config.registry = value) },
    {
      name: "token",
      value: "value",
      summary: "the token itself; prefer piping it in so it stays out of shell history",
      apply: (config, value) => (config.token = value),
    },
  ],
  defaults: () => ({ command: "login", registry: null, token: null }),
  accept: (_config, token) => {
    throw new UsageError(`'login' takes no arguments, got '${token}'`);
  },
};

export const LOGOUT_COMMAND: CommandSpec<LogoutConfig> = {
  name: "logout",
  summary: "forget the stored token for a registry",
  arguments: "",
  flags: [{ ...REGISTRY_FLAG, apply: (config, value) => (config.registry = value) }],
  defaults: () => ({ command: "logout", registry: null }),
  accept: (_config, token) => {
    throw new UsageError(`'logout' takes no arguments, got '${token}'`);
  },
};

export const WHOAMI_COMMAND: CommandSpec<WhoamiConfig> = {
  name: "whoami",
  summary: "show who the stored token belongs to",
  arguments: "",
  flags: [{ ...REGISTRY_FLAG, apply: (config, value) => (config.registry = value) }],
  defaults: () => ({ command: "whoami", registry: null }),
  accept: (_config, token) => {
    throw new UsageError(`'whoami' takes no arguments, got '${token}'`);
  },
};
