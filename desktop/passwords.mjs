const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ITEMS = 2000;
const MAX_LABEL = 200;

export function credentialImportToken(userInfo) {
  if (!userInfo || typeof userInfo !== "object") return null;
  return uuidString(userInfo.ASCredentialImportToken);
}

function uuidString(value) {
  if (typeof value !== "string") return null;
  const token = value.trim();
  return UUID.test(token) ? token.toLowerCase() : null;
}

function cleanLabel(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_LABEL);
}

export function chunkPasswordItems(items, maxBytes) {
  const chunks = [];
  const oversized = [];
  let current = [];
  let size = 2;
  for (const item of items) {
    const encoded = JSON.stringify(item);
    if (encoded.length + 32 > maxBytes) {
      oversized.push(item);
      continue;
    }
    if (current.length && size + encoded.length + 1 > maxBytes) {
      chunks.push(current);
      current = [];
      size = 2;
    }
    current.push(item);
    size += encoded.length + 1;
  }
  if (current.length) chunks.push(current);
  return { chunks, oversized };
}

export function passwordFailure(item, message) {
  const service = cleanLabel(item?.title) || cleanLabel(item?.service) || "password";
  const account = cleanLabel(item?.username) || cleanLabel(item?.accountLabel) || "";
  const text = typeof message === "string" ? message.trim().slice(0, 200) : "";
  return {
    service,
    ...(account ? { accountLabel: account } : {}),
    message: text || "Could not save this password.",
  };
}

export function publicError(message, items) {
  if (typeof message !== "string") return "Could not save these passwords.";
  const text = message.trim();
  if (!text || text.length > 200) return "Could not save these passwords.";
  if (items.some((item) => typeof item?.password === "string" && item.password && text.includes(item.password)))
    return "Could not save these passwords.";
  return text;
}

export function passwordImportSummary(result) {
  const imported = result.imported || 0;
  const failed = result.failed?.length || 0;
  const noun = imported === 1 ? "password" : "passwords";
  if (result.truncated && imported) return `Imported the first ${imported} ${noun} from Passwords.`;
  if (!imported && !failed) return "Passwords didn't include any website passwords to save.";
  if (!failed) return `Imported ${imported} ${noun} from Passwords.`;
  const problem = failed === 1 ? "1 could not be saved" : `${failed} could not be saved`;
  return `Imported ${imported} ${noun} from Passwords. ${problem}.`;
}

export const PASSWORD_IMPORT_LIMIT = MAX_ITEMS;
export const PASSWORD_IMPORT_ACTIVITY = "ASCredentialExchangeActivity";
export const PASSWORD_IMPORT_TIMEOUT =
  "Passwords didn't send an export. In Passwords, choose Export Data to Another App, then choose QM.";
