import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { scopeId, type ScopeId } from "../src/types.ts";
import type { MemoryService } from "../src/memory/memory-service.ts";
import {
  createGbrainClient,
  createGbrainMemory,
  isVisibleToScope,
  scopeMemorySlug,
  type GbrainClient,
} from "../src/memory/gbrain-memory-service.ts";

const SCOPE = scopeId("personal", "U0ALICE");

function stubBase(overrides: Partial<MemoryService> = {}): MemoryService {
  return {
    recall: async () => "",
    capture: async () => 1,
    query: async () => [],
    read: async () => "# Memory\n\n- (2026-08-01) alice ships on fridays",
    replace: async () => {},
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function toolResponse(text: string, status = 200): Response {
  return jsonResponse({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text }] } }, status);
}

function tokenResponse(value = "at-1", expiresIn = 3600): Response {
  return jsonResponse({ access_token: value, expires_in: expiresIn });
}

interface Call {
  url: string;
  init: RequestInit;
}

function recordingFetch(handlers: Array<(call: Call) => Response | undefined>): {
  calls: Call[];
  impl: typeof fetch;
} {
  const calls: Call[] = [];
  const impl = (async (url: string | URL | Request, init: RequestInit = {}) => {
    const call = { url: String(url), init };
    calls.push(call);
    for (const h of handlers) {
      const res = h(call);
      if (res) return res;
    }
    throw new Error(`unexpected fetch: ${call.url}`);
  }) as unknown as typeof fetch;
  return { calls, impl };
}

const clientOptions = (fetchImpl: typeof fetch, onError?: (e: unknown) => void) => ({
  mcpUrl: "https://brain.example.com/mcp",
  issuerUrl: "https://brain.example.com",
  clientId: "gbrain_cl_test",
  clientSecret: "gbrain_cs_test",
  fetchImpl,
  ...(onError ? { onError } : {}),
});

describe("scopeMemorySlug", () => {
  it("maps a scope to a lowercase slug-safe path", () => {
    assert.match(scopeMemorySlug(scopeId("personal", "U0ALICE")), /^qm\/personal\/u0alice-[0-9a-f]{12}\/memory$/);
    assert.match(scopeMemorySlug(scopeId("channel", "C_123/../x")), /^qm\/channel\/c-123-x-[0-9a-f]{12}\/memory$/);
  });

  it("keeps distinct scopes on distinct slugs", () => {
    assert.notEqual(scopeMemorySlug(scopeId("personal", "U1")), scopeMemorySlug(scopeId("channel", "U1")));
  });
});

describe("createGbrainMemory without a client", () => {
  it("returns the base service untouched", () => {
    const base = stubBase();
    assert.equal(createGbrainMemory(base, undefined), base);
  });
});

describe("createGbrainMemory query", () => {
  const clientStub = (search: GbrainClient["search"]): GbrainClient => ({
    search,
    mirror: async () => {},
  });

  it("merges remote hits after local ones and dedupes", async () => {
    const base = stubBase({ query: async () => ["alice ships on fridays"] });
    const memory = createGbrainMemory(
      base,
      clientStub(async () => ["Alice ships on Fridays", "acme renewal closed in q3"]),
    );
    assert.deepEqual(await memory.query(SCOPE, "alice", 5), ["alice ships on fridays", "acme renewal closed in q3"]);
  });

  it("respects the limit", async () => {
    const base = stubBase({ query: async () => ["a"] });
    const memory = createGbrainMemory(
      base,
      clientStub(async () => ["b", "c", "d"]),
    );
    assert.deepEqual(await memory.query(SCOPE, "q", 2), ["a", "b"]);
  });

  it("does not call the brain when local results already fill the limit", async () => {
    let searched = false;
    const base = stubBase({ query: async () => ["a", "b"] });
    const memory = createGbrainMemory(
      base,
      clientStub(async () => {
        searched = true;
        return ["c"];
      }),
    );
    await memory.query(SCOPE, "q", 2);
    assert.equal(searched, false);
  });

  it("still returns local results when the brain fails", async () => {
    const base = stubBase({ query: async () => ["local only"] });
    const memory = createGbrainMemory(
      base,
      clientStub(async () => {
        throw new Error("brain down");
      }),
    );
    assert.deepEqual(await memory.query(SCOPE, "q", 5), ["local only"]);
  });
});

describe("createGbrainMemory capture", () => {
  it("mirrors the notebook after a successful capture", async () => {
    const mirrored: Array<{ scopeId: ScopeId; content: string }> = [];
    const memory = createGbrainMemory(stubBase(), {
      search: async () => [],
      mirror: async (s, content) => {
        mirrored.push({ scopeId: s, content });
      },
    });
    assert.equal(await memory.capture(SCOPE, ["alice ships on fridays"], Date.now()), 1);
    await new Promise((r) => setImmediate(r));
    assert.equal(mirrored.length, 1);
    assert.equal(mirrored[0]!.scopeId, SCOPE);
    assert.match(mirrored[0]!.content, /alice ships on fridays/);
  });

  it("does not mirror when nothing was added", async () => {
    let mirrors = 0;
    const memory = createGbrainMemory(stubBase({ capture: async () => 0 }), {
      search: async () => [],
      mirror: async () => {
        mirrors += 1;
      },
    });
    await memory.capture(SCOPE, ["dupe"], Date.now());
    await new Promise((r) => setImmediate(r));
    assert.equal(mirrors, 0);
  });

  it("returns the base count even when mirroring throws", async () => {
    const memory = createGbrainMemory(stubBase(), {
      search: async () => [],
      mirror: async () => {
        throw new Error("brain down");
      },
    });
    assert.equal(await memory.capture(SCOPE, ["fact"], Date.now()), 1);
    await new Promise((r) => setImmediate(r));
  });
});

describe("createGbrainClient", () => {
  it("mints a token once and reuses it across calls", async () => {
    const { calls, impl } = recordingFetch([
      (c) => (c.url.endsWith("/token") ? tokenResponse() : undefined),
      (c) => (c.url.endsWith("/mcp") ? toolResponse("[]") : undefined),
    ]);
    const client = createGbrainClient(clientOptions(impl));
    await client.search(SCOPE, "q", 5);
    await client.search(SCOPE, "q", 5);
    assert.equal(calls.filter((c) => c.url.endsWith("/token")).length, 1);
    assert.equal(calls.filter((c) => c.url.endsWith("/mcp")).length, 2);
  });

  it("re-mints once on a 401 and retries the call", async () => {
    let mcpCalls = 0;
    const { calls, impl } = recordingFetch([
      (c) => (c.url.endsWith("/token") ? tokenResponse() : undefined),
      (c) => {
        if (!c.url.endsWith("/mcp")) return undefined;
        mcpCalls += 1;
        return mcpCalls === 1 ? new Response("nope", { status: 401 }) : toolResponse("[]");
      },
    ]);
    const client = createGbrainClient(clientOptions(impl));
    await client.search(SCOPE, "q", 5);
    assert.equal(calls.filter((c) => c.url.endsWith("/token")).length, 2);
    assert.equal(mcpCalls, 2);
  });

  it("sends the bearer token and a tools/call envelope", async () => {
    const { calls, impl } = recordingFetch([
      (c) => (c.url.endsWith("/token") ? tokenResponse("at-xyz") : undefined),
      (c) => (c.url.endsWith("/mcp") ? toolResponse("[]") : undefined),
    ]);
    await createGbrainClient(clientOptions(impl)).search(SCOPE, "renewal", 3);
    const mcp = calls.find((c) => c.url.endsWith("/mcp"))!;
    assert.equal((mcp.init.headers as Record<string, string>).authorization, "Bearer at-xyz");
    const body = JSON.parse(String(mcp.init.body)) as {
      method: string;
      params: { name: string; arguments: { query: string; limit: number } };
    };
    assert.equal(body.method, "tools/call");
    assert.equal(body.params.name, "search");
    assert.equal(body.params.arguments.query, "renewal");
    assert.ok((body.params.arguments.limit as number) >= 3);
  });

  it("parses structured search results into snippets", async () => {
    const { impl } = recordingFetch([
      (c) => (c.url.endsWith("/token") ? tokenResponse() : undefined),
      (c) =>
        c.url.endsWith("/mcp")
          ? toolResponse(
              JSON.stringify([
                { slug: "org/handbook", title: "Handbook", chunk_text: "we ship on   fridays" },
                { slug: "org/notes" },
              ]),
            )
          : undefined,
    ]);
    assert.deepEqual(await createGbrainClient(clientOptions(impl)).search(SCOPE, "q", 5), [
      "Handbook: we ship on fridays",
      "org/notes",
    ]);
  });

  it("reads results out of an SSE framed response", async () => {
    const sse = `event: message\ndata: ${JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: {
        content: [{ type: "text", text: JSON.stringify([{ slug: "org/t", title: "T", chunk_text: "body" }]) }],
      },
    })}\n\n`;
    const { impl } = recordingFetch([
      (c) => (c.url.endsWith("/token") ? tokenResponse() : undefined),
      (c) =>
        c.url.endsWith("/mcp")
          ? new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } })
          : undefined,
    ]);
    assert.deepEqual(await createGbrainClient(clientOptions(impl)).search(SCOPE, "q", 5), ["T: body"]);
  });

  it("reports and swallows transport failures instead of throwing at the caller", async () => {
    const seen: unknown[] = [];
    const { impl } = recordingFetch([
      (c) => (c.url.endsWith("/token") ? new Response("no", { status: 500 }) : undefined),
    ]);
    const client = createGbrainClient(clientOptions(impl, (e) => seen.push(e)));
    assert.deepEqual(await client.search(SCOPE, "q", 5), []);
    await client.mirror(SCOPE, "# Memory");
    assert.equal(seen.length, 2);
  });

  it("mirrors the notebook to the scope's own slug with frontmatter", async () => {
    const { calls, impl } = recordingFetch([
      (c) => (c.url.endsWith("/token") ? tokenResponse() : undefined),
      (c) => (c.url.endsWith("/mcp") ? toolResponse("{}") : undefined),
    ]);
    await createGbrainClient(clientOptions(impl)).mirror(SCOPE, "# Memory\n\n- fact");
    const body = JSON.parse(String(calls.find((c) => c.url.endsWith("/mcp"))!.init.body)) as {
      params: { name: string; arguments: { slug: string; content: string } };
    };
    assert.equal(body.params.name, "put_page");
    assert.equal(body.params.arguments.slug, scopeMemorySlug(SCOPE));
    assert.match(body.params.arguments.content, /^---\ntype: note\n/);
    assert.match(body.params.arguments.content, /- fact/);
  });

  it("surfaces a tool-level error through onError", async () => {
    const seen: unknown[] = [];
    const { impl } = recordingFetch([
      (c) => (c.url.endsWith("/token") ? tokenResponse() : undefined),
      (c) =>
        c.url.endsWith("/mcp")
          ? jsonResponse({
              jsonrpc: "2.0",
              id: 1,
              result: { isError: true, content: [{ type: "text", text: "permission_denied" }] },
            })
          : undefined,
    ]);
    const client = createGbrainClient(clientOptions(impl, (e) => seen.push(e)));
    assert.deepEqual(await client.search(SCOPE, "q", 5), []);
    assert.match(String(seen[0]), /permission_denied/);
  });
});

describe("scope isolation of remote results", () => {
  const OTHER = scopeId("personal", "U0BOB");

  it("hides another scope's memory page from this scope", () => {
    assert.equal(isVisibleToScope(SCOPE, scopeMemorySlug(OTHER)), false);
    assert.equal(isVisibleToScope(SCOPE, scopeMemorySlug(SCOPE)), true);
  });

  it("keeps shared org pages visible", () => {
    assert.equal(isVisibleToScope(SCOPE, "org/handbook"), true);
  });

  it("drops rows with no slug, since visibility cannot be checked", () => {
    assert.equal(isVisibleToScope(SCOPE, undefined), false);
  });

  it("filters another scope's page out of live search results", async () => {
    const { impl } = recordingFetch([
      (c) => (c.url.endsWith("/token") ? tokenResponse() : undefined),
      (c) =>
        c.url.endsWith("/mcp")
          ? toolResponse(
              JSON.stringify([
                { slug: scopeMemorySlug(OTHER), title: "bob memory", chunk_text: "bob is interviewing elsewhere" },
                { slug: "org/handbook", title: "Handbook", chunk_text: "we ship on fridays" },
                { slug: scopeMemorySlug(SCOPE), title: "my memory", chunk_text: "mine" },
              ]),
            )
          : undefined,
    ]);
    const hits = await createGbrainClient(clientOptions(impl)).search(SCOPE, "interview", 10);
    assert.equal(
      hits.some((h) => h.includes("interviewing elsewhere")),
      false,
    );
    assert.deepEqual(hits, ["Handbook: we ship on fridays", "my memory: mine"]);
  });
});

describe("mutations other than capture reach the brain", () => {
  const recordingClient = (sink: string[]): GbrainClient => ({
    search: async () => [],
    mirror: async (_s, content) => {
      sink.push(content);
    },
  });

  it("mirrors after replace, so a local deletion does not persist off-box", async () => {
    const mirrored: string[] = [];
    let stored = "# Memory\n\n- secret";
    const base = stubBase({
      read: async () => stored,
      replace: async (_s, content) => {
        stored = content;
      },
    });
    const memory = createGbrainMemory(base, recordingClient(mirrored));
    await memory.replace(SCOPE, "# Memory\n");
    await new Promise((r) => setImmediate(r));
    assert.equal(mirrored.length, 1);
    assert.equal(mirrored[0]!.includes("secret"), false);
  });

  it("mirrors after a successful replaceIfRevision and not after a failed one", async () => {
    const mirrored: string[] = [];
    let ok = true;
    const base = stubBase({ replaceIfRevision: async () => ok });
    const memory = createGbrainMemory(base, recordingClient(mirrored));
    await memory.replaceIfRevision!(SCOPE, "x", "rev");
    await new Promise((r) => setImmediate(r));
    assert.equal(mirrored.length, 1);
    ok = false;
    await memory.replaceIfRevision!(SCOPE, "y", "rev");
    await new Promise((r) => setImmediate(r));
    assert.equal(mirrored.length, 1);
  });

  it("leaves optional methods absent when the base does not implement them", () => {
    const memory = createGbrainMemory(stubBase(), recordingClient([]));
    assert.equal(memory.replaceIfRevision, undefined);
    assert.equal(memory.restore, undefined);
  });

  it("serializes mirrors per scope so the last write wins", async () => {
    const order: string[] = [];
    let stored = "0";
    const base = stubBase({
      capture: async () => 1,
      read: async () => stored,
    });
    const memory = createGbrainMemory(base, {
      search: async () => [],
      mirror: async (_s, content) => {
        await new Promise((r) => setTimeout(r, 5));
        order.push(content);
      },
    });
    stored = "1";
    await memory.capture(SCOPE, ["a"], Date.now());
    stored = "2";
    await memory.capture(SCOPE, ["b"], Date.now());
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(order.at(-1), "2");
  });
});
