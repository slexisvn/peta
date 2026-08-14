import { PetaError } from "../core/errors.js";
import { normalizeRegistry } from "./credentials.js";

export class HubError extends PetaError {}

export type Identity = {
  readonly login: string;
  readonly name: string | null;
  readonly scopes: readonly string[];
};

export type PublishOutcome = {
  readonly name: string;
  readonly version: string;
  readonly integrity: string;
  readonly bytes: number;
  readonly files: number;
};

function messageFrom(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body) as { message?: unknown };
    if (typeof parsed.message === "string") return parsed.message;
    if (Array.isArray(parsed.message)) return parsed.message.join("; ");
  } catch {
    if (body.length > 0 && body.length < 200) return body;
  }
  return `the registry answered ${status}`;
}

export class HubClient {
  private readonly base: string;

  constructor(
    base: string,
    private readonly token: string | null,
  ) {
    this.base = normalizeRegistry(base);
    if (!/^https?:\/\//.test(this.base)) {
      throw new HubError(`'${base}' is not an http registry; publishing needs a hub URL`);
    }
  }

  get registry(): string {
    return this.base;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const headers: Record<string, string> = { accept: "application/json", ...extra };
    if (this.token !== null) headers["authorization"] = `Bearer ${this.token}`;
    return headers;
  }

  private async call<T>(
    path: string,
    init: { method: string; body?: string | Uint8Array; headers?: Record<string, string> },
  ): Promise<T> {
    const target = `${this.base}${path}`;
    let response: Response;
    try {
      response = await fetch(target, {
        method: init.method,
        headers: this.headers(init.headers),
        ...(init.body === undefined ? {} : { body: init.body }),
      });
    } catch (error) {
      throw new HubError(`${target}: ${error instanceof Error ? error.message : String(error)}`);
    }
    const text = await response.text();
    if (!response.ok) throw new HubError(messageFrom(response.status, text));
    return (text.length === 0 ? {} : JSON.parse(text)) as T;
  }

  async whoami(): Promise<Identity> {
    return this.call<Identity>("/api/v1/auth/whoami", { method: "GET" });
  }

  async publish(archive: Buffer): Promise<PublishOutcome> {
    return this.call<PublishOutcome>("/api/v1/publish", {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: new Uint8Array(archive),
    });
  }

  async yank(name: string, version: string, undo: boolean): Promise<void> {
    await this.call(`/api/v1/packages/${name}/versions/${version}/yank`, {
      method: undo ? "DELETE" : "POST",
    });
  }

  async claimScope(name: string): Promise<void> {
    await this.call("/api/v1/scopes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
  }
}
