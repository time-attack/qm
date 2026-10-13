import {
  PASSWORD_IMPORT_ACTIVITY,
  PASSWORD_IMPORT_LIMIT,
  PASSWORD_IMPORT_TIMEOUT,
  credentialImportToken,
  passwordImportSummary,
} from "./passwords.mjs";

export function createPasswordExchange(deps) {
  let pending = null;
  let running = null;
  let queued = null;
  let beginning = false;

  async function run(token, notify) {
    const items = await deps.importToken(token);
    const limited = Array.isArray(items) ? items.slice(0, PASSWORD_IMPORT_LIMIT) : [];
    const stored = await deps.storeItems(limited);
    const summary = { ...stored, truncated: Array.isArray(items) && items.length > PASSWORD_IMPORT_LIMIT };
    summary.message = passwordImportSummary(summary);
    if (notify) deps.notify(summary);
    return summary;
  }

  function pump() {
    if (running || pending || beginning || !queued) return;
    const token = queued;
    queued = null;
    running = run(token, true)
      .catch((error) => deps.notifyError(error instanceof Error ? error.message : PASSWORD_IMPORT_TIMEOUT))
      .finally(() => {
        running = null;
        pump();
      });
  }

  return {
    receive(type, userInfo) {
      if (type !== PASSWORD_IMPORT_ACTIVITY) return;
      const token = credentialImportToken(userInfo);
      if (!token) return;
      if (pending) {
        const current = pending;
        pending = null;
        clearTimeout(current.timer);
        current.resolve(token);
        return;
      }
      queued = token;
      pump();
    },
    async begin() {
      if (pending || beginning) throw new Error("A Passwords import is already in progress.");
      beginning = true;
      try {
        if (!(await deps.ask())) return { cancelled: true };
        await deps.openPasswords();
        const token =
          queued ??
          (await new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
              if (pending?.resolve !== resolve) return;
              pending = null;
              reject(new Error(PASSWORD_IMPORT_TIMEOUT));
            }, deps.timeoutMs);
            pending = { resolve, timer };
          }));
        queued = null;
        if (running) await running.catch(() => {});
        running = run(token, false).finally(() => {
          running = null;
          pump();
        });
        return await running;
      } finally {
        beginning = false;
        pump();
      }
    },
  };
}
