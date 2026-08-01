import { parseScopeId, type ScopeId } from "../types.ts";
import type { MemoryService } from "./memory-service.ts";

export interface GbrainOptions {
  mcpUrl: string;
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  timeoutMs?: number;
  onError?: (e: unknown) => void;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export interface GbrainClient {
  search(scopeId: ScopeId, q: string, limit: number): Promise<string[]>;
  mirror(scopeId: ScopeId, content: string): Promise<void>;
}

const DEFAULT_TIMEOUT_MS = 5000;
const TOKEN_SKEW_MS = 30_000;
const MAX_SNIPPET_CHARS = 400;

function slugSegment(value: string): string {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "unknown";
}

export function scopeMemorySlug(scopeId: ScopeId): string {
  const { kind, ref } = parseScopeId(scopeId);
  return `qm/${slugSegment(kind ?? "unknown")}/${slugSegment(ref)}/memory`;
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

function textFromMcpBody(body: string): string {
  const trimmed = body.trim();
  if (!trimmed.startsWith("event:") && !trimmed.startsWith("data:")) return trimmed;
  const payloads = trimmed
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter(Boolean);
  return payloads.at(-1) ?? "";
}

function toolResultText(body: string): string {
  const envelope = JSON.parse(textFromMcpBody(body)) as {
    error?: { message?: string };
    result?: { isError?: boolean; content?: Array<{ type?: string; text?: string }> };
  };
  if (envelope.error) throw new Error(envelope.error.message ?? "gbrain rpc error");
  const text = envelope.result?.content?.find((c) => c.type === "text")?.text ?? "";
  if (envelope.result?.isError) throw new Error(text || "gbrain tool error");
  return text;
}

function snippetsFrom(text: string, limit: number): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return text.trim() ? [text.trim().slice(0, MAX_SNIPPET_CHARS)] : [];
  }
  const rows = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { results?: unknown[] })?.results)
      ? (parsed as { results: unknown[] }).results
      : [];
  const out: string[] = [];
  for (const row of rows) {
    if (typeof row === "string") {
      if (row.trim()) out.push(row.trim().slice(0, MAX_SNIPPET_CHARS));
      continue;
    }
    const r = row as { slug?: string; title?: string; excerpt?: string; content?: string; text?: string };
    const body = (r.excerpt ?? r.content ?? r.text ?? "").replace(/\s+/g, " ").trim();
    const label = r.title ?? r.slug;
    const line = label && body ? `${label}: ${body}` : body || label || "";
    if (line) out.push(line.slice(0, MAX_SNIPPET_CHARS));
    if (out.length >= limit) break;
  }
  return out;
}

export function createGbrainClient(options: GbrainOptions): GbrainClient {
  const doFetch = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const report = options.onError ?? (() => {});
  let token: { value: string; expiresAt: number } | undefined;

  async function mintToken(): Promise<string> {
    const res = await doFetch(`${stripTrailingSlash(options.issuerUrl)}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: options.clientId,
        client_secret: options.clientSecret,
        scope: "read write",
      }).toString(),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`gbrain token ${res.status}`);
    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new Error("gbrain token response missing access_token");
    token = {
      value: body.access_token,
      expiresAt: now() + (body.expires_in ?? 0) * 1000,
    };
    return token.value;
  }

  async function accessToken(): Promise<string> {
    if (token && token.expiresAt - TOKEN_SKEW_MS > now()) return token.value;
    return mintToken();
  }

  async function callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const send = async (bearer: string) =>
      doFetch(options.mcpUrl, {
        method: "POST",
        headers: {
          authorization: `Bearer ${bearer}`,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name, arguments: args },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });

    let res = await send(await accessToken());
    if (res.status === 401) {
      token = undefined;
      res = await send(await accessToken());
    }
    if (!res.ok) throw new Error(`gbrain ${name} ${res.status}`);
    return toolResultText(await res.text());
  }

  return {
    async search(scopeId, q, limit) {
      try {
        return snippetsFrom(await callTool("search", { query: q, limit }), limit);
      } catch (e) {
        report(e);
        return [];
      }
    },
    async mirror(scopeId, content) {
      try {
        const slug = scopeMemorySlug(scopeId);
        const page = `---\ntype: note\ntitle: ${scopeId} memory\n---\n\n${content.trim()}\n`;
        await callTool("put_page", { slug, content: page });
      } catch (e) {
        report(e);
      }
    },
  };
}

export function createGbrainMemory(base: MemoryService, client: GbrainClient | undefined): MemoryService {
  if (!client) return base;
  return {
    ...base,
    async capture(scopeId, facts, at, author) {
      const added = await base.capture(scopeId, facts, at, author);
      if (added > 0) {
        void base
          .read(scopeId)
          .then((content) => client.mirror(scopeId, content))
          .catch(() => {});
      }
      return added;
    },
    async query(scopeId, q, limit) {
      const cap = limit ?? 10;
      const local = await base.query(scopeId, q, cap);
      if (local.length >= cap) return local;
      const remote = await client.search(scopeId, q, cap).catch(() => []);
      const seen = new Set(local.map((line) => line.toLowerCase().replace(/\s+/g, " ").trim()));
      const merged = [...local];
      for (const line of remote) {
        const key = line.toLowerCase().replace(/\s+/g, " ").trim();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        merged.push(line);
        if (merged.length >= cap) break;
      }
      return merged;
    },
  };
}
