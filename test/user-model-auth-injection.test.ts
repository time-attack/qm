import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createMemoryMap } from "../src/persistence/durable-map.ts";
import { createUserModelCredentialStore } from "../src/model/user-model-credential-store.ts";
import { readFileSync } from "node:fs";
import { prepareCodexHome } from "../src/harness/codex-harness.ts";
import { codexOAuthAuthFromValue } from "../src/harness/codex-auth-store.ts";
import { resolveIndividualAuthRouting } from "../src/core/individual-auth-routing.ts";
import type { UserModelCredential } from "../src/model/user-model-credential-store.ts";

const apikey = (provider: "anthropic" | "openai", apiKey: string): UserModelCredential => ({
  provider,
  kind: "apikey",
  apiKey,
  updatedAt: 0,
});
const oauth = (provider: "anthropic" | "openai"): UserModelCredential => ({
  provider,
  kind: "oauth",
  oauth: { accessToken: "acc", refreshToken: "ref" },
  updatedAt: 0,
});

function fakeIdToken(accountId: string): string {
  const seg = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${seg({ alg: "RS256", typ: "JWT" })}.${seg({ "https://api.openai.com/auth": { chatgpt_account_id: accountId } })}.sig`;
}

const KEY_MATERIAL = "test-key-material-that-is-long-enough";

test("user model credential store round-trips api key and oauth per user+provider", async () => {
  const store = createUserModelCredentialStore({ backing: createMemoryMap(), keyMaterial: KEY_MATERIAL });
  await store.setApiKey("u1", "anthropic", "sk-ant-abc");
  const anth = await store.get("u1", "anthropic");
  assert.equal(anth?.kind, "apikey");
  assert.equal(anth?.apiKey, "sk-ant-abc");

  await store.setOAuth("u1", "openai", {
    accessToken: "acc",
    refreshToken: "ref",
    idToken: fakeIdToken("acct_1"),
    accountId: "acct_1",
    expiresAt: 123,
  });
  const oai = await store.get("u1", "openai");
  assert.equal(oai?.kind, "oauth");
  assert.equal(oai?.oauth?.accessToken, "acc");
  assert.equal(oai?.oauth?.refreshToken, "ref");

  assert.deepEqual(await store.connections("u1"), [
    { provider: "anthropic", kind: "apikey" },
    { provider: "openai", kind: "oauth" },
  ]);
  assert.deepEqual(await store.connections("stranger"), []);

  await store.delete("u1", "anthropic");
  assert.equal(await store.get("u1", "anthropic"), null);
  assert.deepEqual(await store.connections("u1"), [{ provider: "openai", kind: "oauth" }]);
});

test("routing: anthropic api key -> pi harness with a claude model", () => {
  const r = resolveIndividualAuthRouting(apikey("anthropic", "sk-ant-x"), null, undefined);
  assert.equal(r?.kind, "apikey");
  assert.equal(r?.harness, "pi");
  assert.equal(r?.provider, "anthropic");
  assert.equal((r as { apiKey: string }).apiKey, "sk-ant-x");
});

test("routing: anthropic OAuth login -> claude harness (not pi)", () => {
  const r = resolveIndividualAuthRouting(oauth("anthropic"), null, undefined);
  assert.equal(r?.kind, "oauth");
  assert.equal(r?.harness, "claude");
  assert.equal(r?.model, "claude-opus-5");
});

test("routing: openai OAuth login -> codex harness (not pi)", () => {
  const r = resolveIndividualAuthRouting(null, oauth("openai"), undefined);
  assert.equal(r?.kind, "oauth");
  assert.equal(r?.harness, "codex");
  assert.equal(r?.model, "gpt-5.6-sol");
});

test("routing: requested model provider wins when that provider is connected", () => {
  const r = resolveIndividualAuthRouting(oauth("anthropic"), oauth("openai"), "gpt-5.6-sol");
  assert.equal(r?.harness, "codex");
});

test("routing: no credentials -> null (falls through to gate, no deployment key)", () => {
  assert.equal(resolveIndividualAuthRouting(null, null, undefined), null);
});

test("per-user codex child auth is derived material: valid chatgpt auth without the refresh token", () => {
  const userAuth = codexOAuthAuthFromValue({
    auth_mode: "chatgpt",
    tokens: {
      access_token: "acc-token",
      refresh_token: "ref-token",
      id_token: fakeIdToken("acct_9"),
      account_id: "acct_9",
    },
  });
  assert.ok(userAuth, "per-user tokens must satisfy the codex auth validator");
  const jail = mkdtempSync(join(tmpdir(), "codex-inject-"));
  prepareCodexHome({}, jail, userAuth);
  const child = JSON.parse(readFileSync(join(jail, "codex-home", "auth.json"), "utf8")) as {
    auth_mode?: string;
    tokens?: Record<string, unknown>;
  };
  assert.equal(child.auth_mode, "chatgpt");
  assert.equal(child.tokens?.access_token, "acc-token");
  assert.equal(child.tokens?.refresh_token, undefined);
  assert.ok(child.tokens?.id_token);
});
