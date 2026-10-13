import { createHash } from "node:crypto";

const MAX_ITEMS = 2000;
const MAX_LABEL = 200;
const MAX_SECRET = 4096;

export interface PasswordDraft {
  service: string;
  secret: string;
  envKey: string;
  accountLabel?: string;
  host?: string;
}

export function passwordCredentialDrafts(
  input: unknown,
): { ok: true; drafts: PasswordDraft[]; skipped: number } | { ok: false; message: string } {
  if (!Array.isArray(input)) return { ok: false, message: "passwords must be a list" };
  if (input.length > MAX_ITEMS) return { ok: false, message: "too many passwords" };
  const byKey = new Map<string, PasswordDraft>();
  let skipped = 0;
  for (const item of input) {
    const draft = draftOf(item);
    if (!draft) {
      skipped += 1;
      continue;
    }
    byKey.set(draft.envKey, draft);
  }
  return { ok: true, drafts: [...byKey.values()], skipped };
}

function draftOf(item: unknown): PasswordDraft | null {
  if (!item || typeof item !== "object") return null;
  const record = item as { title?: unknown; username?: unknown; password?: unknown; url?: unknown };
  if (typeof record.password !== "string" || !record.password || record.password.length > MAX_SECRET) return null;
  if (record.password.includes("\u0000")) return null;
  const host = websiteHost(record.url);
  const title = cleanLabel(record.title);
  const account = cleanLabel(record.username);
  const service = (host || title).slice(0, 120);
  if (!service) return null;
  return {
    service,
    secret: record.password,
    envKey: passwordEnvKey(service, account, title),
    ...(account ? { accountLabel: account } : {}),
    ...(host ? { host } : {}),
  };
}

function websiteHost(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    const host = url.hostname
      .toLowerCase()
      .replace(/\.$/, "")
      .replace(/^www\./, "");
    if (!host || host.length > 253 || !/^[a-z0-9.-]+$/.test(host)) return undefined;
    return host;
  } catch {
    return undefined;
  }
}

function cleanLabel(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_LABEL);
}

function passwordEnvKey(service: string, account: string, title: string): string {
  const digest = createHash("sha256")
    .update(`${service}\n${account}\n${title}`)
    .digest("hex")
    .slice(0, 10)
    .toUpperCase();
  const stem = `${service} ${account}`
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  const key = `PW_${stem ? `${stem}_` : ""}${digest}_PASSWORD`;
  return /^[A-Z_][A-Z0-9_]*$/.test(key) ? key : `PW_${digest}_PASSWORD`;
}
