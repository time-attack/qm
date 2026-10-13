import assert from "node:assert/strict";
import { test } from "node:test";
import {
  chunkPasswordItems,
  credentialImportToken,
  passwordFailure,
  passwordImportSummary,
  publicError,
} from "../passwords.mjs";
import { createPasswordExchange } from "../password-exchange.mjs";

test("credential import token is the Passwords activity UUID", () => {
  assert.equal(
    credentialImportToken({ ASCredentialImportToken: "A1B2C3D4-E5F6-4789-A123-456789ABCDEF" }),
    "a1b2c3d4-e5f6-4789-a123-456789abcdef",
  );
  assert.equal(credentialImportToken({ ASCredentialImportToken: "not-a-token" }), null);
  assert.equal(credentialImportToken(null), null);
  assert.equal(credentialImportToken({ other: "a1b2c3d4-e5f6-4789-a123-456789abcdef" }), null);
});

test("password failures never carry the secret", () => {
  const failure = passwordFailure(
    { title: "GitHub", username: "octocat", password: "super-secret" },
    "Could not save this password.",
  );
  assert.deepEqual(failure, {
    service: "GitHub",
    accountLabel: "octocat",
    message: "Could not save this password.",
  });
  assert.equal(JSON.stringify(failure).includes("super-secret"), false);
  assert.equal(publicError("rejected super-secret", [{ password: "super-secret" }]), "Could not save these passwords.");
});

test("oversized password items stay out of the upload", () => {
  const { chunks, oversized } = chunkPasswordItems(
    [
      { title: "Small", password: "a" },
      { title: "Huge", password: "x".repeat(80) },
    ],
    80,
  );
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0][0].title, "Small");
  assert.equal(oversized.length, 1);
  assert.equal(oversized[0].title, "Huge");
});

test("an import waits for Export to Another App and returns counts only", async () => {
  const stored = [];
  let opened = 0;
  const exchange = createPasswordExchange({
    timeoutMs: 1_000,
    ask: async () => true,
    openPasswords: async () => {
      opened += 1;
    },
    importToken: async (token) => [{ title: "GitHub", username: "octocat", password: "super-secret", token }],
    storeItems: async (items) => {
      stored.push(items);
      return { imported: items.length, skipped: 0, failed: [] };
    },
    notify: () => {},
    notifyError: () => {},
  });
  const pending = exchange.begin();
  exchange.receive("ASCredentialExchangeActivity", {
    ASCredentialImportToken: "a1b2c3d4-e5f6-4789-a123-456789abcdef",
  });
  const summary = await pending;
  assert.equal(opened, 1);
  assert.equal(stored[0][0].password, "super-secret");
  assert.deepEqual(summary, {
    imported: 1,
    skipped: 0,
    failed: [],
    truncated: false,
    message: "Imported 1 password from Passwords.",
  });
  assert.equal(JSON.stringify(summary).includes("super-secret"), false);
});

test("cancelling the import does not open Passwords", async () => {
  let opened = 0;
  const exchange = createPasswordExchange({
    timeoutMs: 50,
    ask: async () => false,
    openPasswords: async () => {
      opened += 1;
    },
    importToken: async () => [],
    storeItems: async () => ({ imported: 0, skipped: 0, failed: [] }),
    notify: () => {},
    notifyError: () => {},
  });
  assert.deepEqual(await exchange.begin(), { cancelled: true });
  assert.equal(opened, 0);
});

test("a missed export tells the user how to choose QM", async () => {
  const exchange = createPasswordExchange({
    timeoutMs: 20,
    ask: async () => true,
    openPasswords: async () => {},
    importToken: async () => [],
    storeItems: async () => ({ imported: 0, skipped: 0, failed: [] }),
    notify: () => {},
    notifyError: () => {},
  });
  await assert.rejects(exchange.begin(), /Export Data to Another App/);
});

test("an export started in Passwords is saved without the keychain button", async () => {
  let summary;
  const exchange = createPasswordExchange({
    timeoutMs: 50,
    ask: async () => false,
    openPasswords: async () => {},
    importToken: async () => [{ title: "Example", username: "", password: "pw" }],
    storeItems: async (items) => ({ imported: items.length, skipped: 0, failed: [] }),
    notify: (value) => {
      summary = value;
    },
    notifyError: () => {},
  });
  exchange.receive("ASCredentialExchangeActivity", {
    ASCredentialImportToken: "a1b2c3d4-e5f6-4789-a123-456789abcdef",
  });
  for (let i = 0; i < 20 && !summary; i++) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(summary.message, "Imported 1 password from Passwords.");
  assert.equal(
    passwordImportSummary({ imported: 0, failed: [] }),
    "Passwords didn't include any website passwords to save.",
  );
});
