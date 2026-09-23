import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { credentialsPath } from "../../core/home.js";
import { DEFAULT_REGISTRY } from "../../core/source.js";
import { HubClient, normalizeHubRegistry } from "../../registry/client.js";
import { forgetToken, rememberToken, tokenFor } from "../../registry/credentials.js";
import { REGISTRY_VARIABLE, configuredRegistryLocation } from "../../registry/registry.js";
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

const LOGIN_TIMEOUT_MS = 5 * 60_000;
const CALLBACK_PATH = "/peta-login";
const BROWSER_VARIABLE = "PETA_BROWSER";
const FORCE_BROWSER_LOGIN_VARIABLE = "PETA_LOGIN_BROWSER";

export function registryUrl(override: string | null): string {
  const location = configuredRegistryLocation(override);
  if (location === null) {
    throw new UsageError(
      `no registry configured (run 'peta registry <url>', set ${REGISTRY_VARIABLE}, or pass --registry <url>)`,
    );
  }
  return location;
}

export function clientFor(override: string | null, needsToken: boolean): HubClient {
  const registry = normalizeHubRegistry(registryUrl(override));
  const token = tokenFor(registry);
  if (needsToken && token === null) {
    throw new UsageError(`not signed in to ${registry} (run 'peta login')`);
  }
  return new HubClient(registry, token);
}

function readStdin(): string {
  if (process.stdin.isTTY) return "";
  try {
    const stat = fs.fstatSync(0);
    if (!stat.isFIFO() && !stat.isFile()) return "";
  } catch {
    return "";
  }
  try {
    return fs.readFileSync(0, "utf8").trim();
  } catch {
    return "";
  }
}

function canUseBrowserLogin(): boolean {
  return process.stdin.isTTY === true || process.env[FORCE_BROWSER_LOGIN_VARIABLE] === "1";
}

function openBrowser(url: string): boolean {
  const override = process.env[BROWSER_VARIABLE];
  if (override === "0" || override === "none") return false;
  const command =
    override ??
    (process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open");
  const args =
    override !== undefined
      ? [url]
      : process.platform === "win32"
        ? ["/c", "start", "", url]
        : [url];
  try {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve((server.address() as AddressInfo).port);
    });
  });
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

function successPage(): string {
  return "<!doctype html><title>peta login</title><p>Signed in. You can close this window.</p>";
}

async function browserToken(registry: string): Promise<string> {
  const state = crypto.randomBytes(16).toString("base64url");
  const server = http.createServer();
  const received = new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new UsageError("login timed out")), LOGIN_TIMEOUT_MS);
    server.on("request", (request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== CALLBACK_PATH) {
        response.statusCode = 404;
        response.end("not found");
        return;
      }
      const actualState = url.searchParams.get("state");
      const token = url.searchParams.get("token");
      const error = url.searchParams.get("error");
      if (actualState !== state) {
        response.statusCode = 400;
        response.end("sign-in state mismatch");
        clearTimeout(timeout);
        reject(new UsageError("login state mismatch"));
        return;
      }
      if (token === null || token.length === 0) {
        response.statusCode = 400;
        response.end("no token returned");
        clearTimeout(timeout);
        reject(new UsageError(error ?? "the registry returned no token"));
        return;
      }
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(successPage());
      clearTimeout(timeout);
      resolve(token);
    });
  });

  const port = await listen(server);
  const callback = `http://127.0.0.1:${port}${CALLBACK_PATH}`;
  const authorize = new URL("/api/v1/auth/github", registry);
  authorize.searchParams.set("cli_redirect", callback);
  authorize.searchParams.set("cli_state", state);

  console.log("Complete sign-in in your browser.");
  console.log(authorize.toString());
  if (!openBrowser(authorize.toString())) console.log("Open the URL above to continue.");

  try {
    return await received;
  } finally {
    await closeServer(server);
  }
}

async function loginToken(config: LoginConfig, registry: string): Promise<string> {
  const token = config.token ?? readStdin();
  if (token.length > 0) return token;
  if (canUseBrowserLogin()) return browserToken(registry);
  return "";
}

const REGISTRY_FLAG = {
  name: "registry",
  value: "url",
  summary: "the hub to talk to (defaults to $PETA_REGISTRY)",
} as const;

export async function runLogin(config: LoginConfig): Promise<number> {
  const registry = normalizeHubRegistry(registryUrl(config.registry));
  const token = await loginToken(config, registry);
  if (token.length === 0) {
    throw new UsageError(
      "no token given; run 'peta login' in a terminal, pipe a token in, or pass --token",
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
  const registry = normalizeHubRegistry(registryUrl(config.registry));
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
  summary: `sign in to ${DEFAULT_REGISTRY} for publishing`,
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
