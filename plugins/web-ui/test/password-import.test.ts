import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { mintPortalIdentity, PORTAL_IDENTITY_HEADER } from "../../chassis/src/portal-identity.ts";
import { passwordCredentialDrafts } from "../server/password-import.ts";

test("website passwords become distinct keychain entries and drop everything else", () => {
  const built = passwordCredentialDrafts([
    { title: "GitHub", username: "octocat", password: "secret-one", url: "https://www.github.com/login" },
    { title: "GitHub", username: "hubot", password: "secret-two", url: "https://github.com" },
    { title: "Notes", username: "", password: "", url: "https://example.com" },
    { title: "Generated", username: "", password: "generated-secret" },
    { password: "no-name" },
  ]);
  assert.equal(built.ok, true);
  if (!built.ok) return;
  assert.equal(built.skipped, 2);
  assert.equal(built.drafts.length, 3);
  assert.equal(built.drafts[0]?.service, "github.com");
  assert.equal(built.drafts[0]?.host, "github.com");
  assert.equal(built.drafts[0]?.accountLabel, "octocat");
  assert.equal(built.drafts[0]?.secret, "secret-one");
  assert.notEqual(built.drafts[0]?.envKey, built.drafts[1]?.envKey);
  assert.match(built.drafts[0]?.envKey ?? "", /^PW_[A-Z0-9_]+_PASSWORD$/);
  assert.equal(built.drafts[2]?.service, "Generated");
  assert.equal(JSON.stringify(built.drafts).includes("origin"), false);
});

test("a password list that is not a list is refused", () => {
  assert.deepEqual(passwordCredentialDrafts({ password: "x" }), {
    ok: false,
    message: "passwords must be a list",
  });
});

const saved: Array<Record<string, unknown>> = [];
const core = createServer((req: IncomingMessage, res) => {
  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    const url = (req.url ?? "").split("?")[0];
    if (url === "/v1/session-cap") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ token: "cap" }));
      return;
    }
    if (req.method === "POST" && url === "/v1/keychain/credentials") {
      const body = JSON.parse(raw) as Record<string, unknown>;
      saved.push(body);
      res.writeHead(body.service === "nope.example" ? 400 : 200, { "content-type": "application/json" });
      res.end(
        body.service === "nope.example"
          ? JSON.stringify({ message: `rejected ${body.secret}` })
          : JSON.stringify({ credential: { id: "1" } }),
      );
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
});
await new Promise<void>((resolve) => core.listen(0, resolve));

process.env.CORE_API_URL = `http://127.0.0.1:${(core.address() as AddressInfo).port}`;
process.env.CORE_SIGNING_SECRET = "password-import-test";
process.env.PORTAL_IDENTITY_SECRET = "password-import-test";
process.env.WEB_UI_PUBLIC_URL = "http://127.0.0.1:8791";

const { handler } = await import("../server/index.ts");
const surface = createServer((req, res) => void handler(req, res));
await new Promise<void>((resolve) => surface.listen(0, resolve));
const base = `http://127.0.0.1:${(surface.address() as AddressInfo).port}`;
const headers = {
  [PORTAL_IDENTITY_HEADER]: mintPortalIdentity({ p: "alice", exp: Date.now() + 60_000 }, "password-import-test"),
  "content-type": "application/json",
};

test.after(() => {
  surface.close();
  core.close();
});

test("imported passwords are saved for the signed-in user and secrets stay out of the result", async () => {
  const response = await fetch(`${base}/api/keychain/passwords`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      passwords: [
        { title: "GitHub", username: "octocat", password: "secret-one", url: "https://github.com", origin: "evil" },
        { title: "Nope", username: "ada", password: "secret-two", url: "https://nope.example" },
      ],
    }),
  });
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    imported: number;
    failed: Array<{ service: string; message: string; secret?: string }>;
  };
  assert.equal(body.imported, 1);
  assert.equal(body.failed.length, 1);
  assert.equal(body.failed[0]?.service, "nope.example");
  assert.equal(body.failed[0]?.message, "Could not save this password.");
  assert.equal(JSON.stringify(body).includes("secret-one"), false);
  assert.equal(JSON.stringify(body).includes("secret-two"), false);
  assert.equal(saved[0]?.origin, "passwords-app");
  assert.equal(saved[0]?.secret, "secret-one");
  assert.equal(saved[0]?.service, "github.com");
  assert.equal("ownerId" in (saved[0] ?? {}), false);
});
