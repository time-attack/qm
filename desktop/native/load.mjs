import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const addonPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "build/password_import.node");
const unavailable = "Password import is not available in this copy of QM.";

export function importApplePasswords(token) {
  if (!existsSync(addonPath)) return Promise.reject(new Error(unavailable));
  const addon = require(addonPath);
  return new Promise((resolve, reject) => {
    try {
      addon.start(token, (error, json) => {
        if (error) {
          reject(new Error(typeof error === "string" ? error : unavailable));
          return;
        }
        try {
          const parsed = JSON.parse(json);
          if (!Array.isArray(parsed)) throw new Error("bad");
          resolve(parsed);
        } catch {
          reject(new Error("Passwords could not be read."));
        }
      });
    } catch (error) {
      reject(error instanceof Error ? error : new Error(unavailable));
    }
  });
}
