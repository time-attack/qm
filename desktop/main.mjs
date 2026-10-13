import { app, BrowserWindow, dialog, ipcMain, Menu, shell, session as electronSession } from "electron";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createLogin, loginCallback } from "./login.mjs";
import { tabStep } from "./shortcuts.mjs";
import { instanceUrl, externalUrl, browserLoginUrl, loginDestination, internalUrl } from "./url.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const setupUrl = pathToFileURL(path.join(directory, "setup.html")).href;
let mainWindow;
const workspaceWindows = new Set();
let setupWindow;
let target;
let pendingLogin;
let loginStatus = "";

app.setName("QM");
app.on("open-url", (event, url) => {
  event.preventDefault();
  void finishBrowserSignIn(url);
});
let passwordExchange;
if (process.platform === "darwin") {
  const { importApplePasswords } = await import("./native/load.mjs");
  const { createPasswordExchange } = await import("./password-exchange.mjs");
  const { PASSWORD_IMPORT_ACTIVITY, chunkPasswordItems, passwordFailure, publicError } =
    await import("./passwords.mjs");
  app.on("will-continue-activity", (event, type) => {
    if (type === PASSWORD_IMPORT_ACTIVITY) event.preventDefault();
  });
  app.on("continue-activity", (event, type, userInfo) => {
    if (type !== PASSWORD_IMPORT_ACTIVITY) return;
    event.preventDefault();
    passwordExchange.receive(type, userInfo);
  });

  async function storePasswordItems(items) {
    if (!target) throw new Error("Sign in to QM before importing passwords.");
    const { chunks, oversized } = chunkPasswordItems(items, 500_000);
    const failed = oversized.map((item) => passwordFailure(item, "That password is too large to save."));
    let imported = 0;
    let skipped = 0;
    for (const chunk of chunks) {
      let response;
      try {
        response = await instanceSession(target).fetch(new URL("/api/keychain/passwords", target).href, {
          method: "POST",
          redirect: "error",
          credentials: "include",
          headers: { "content-type": "application/json", origin: new URL(target).origin },
          body: JSON.stringify({ passwords: chunk }),
          signal: AbortSignal.timeout(60_000),
        });
      } catch {
        failed.push(...chunk.map((item) => passwordFailure(item, "Could not save these passwords.")));
        continue;
      }
      const text = await response.text();
      let body = {};
      try {
        body = text ? JSON.parse(text) : {};
      } catch {
        body = {};
      }
      if (!response.ok) {
        const message =
          response.status === 401
            ? "Sign in to QM before importing passwords."
            : response.status === 404
              ? "This QM workspace can't save imported passwords yet."
              : publicError(body.message, chunk);
        failed.push(...chunk.map((item) => passwordFailure(item, message)));
        continue;
      }
      imported += Number(body.imported) || 0;
      skipped += Number(body.skipped) || 0;
      if (Array.isArray(body.failed)) {
        for (const entry of body.failed) {
          if (!entry || typeof entry !== "object") continue;
          failed.push(
            passwordFailure({ title: entry.service, username: entry.accountLabel }, publicError(entry.message, chunk)),
          );
        }
      }
    }
    return { imported, skipped, failed };
  }

  function importDialogOptions() {
    return {
      type: "info",
      message: "Import passwords from Passwords",
      detail:
        "Passwords will open. Choose Export Data to Another App, then choose QM. Website and generated passwords are saved to your keychain. Passkeys stay in Passwords.",
      buttons: ["Open Passwords", "Cancel"],
      defaultId: 0,
      cancelId: 1,
    };
  }

  passwordExchange = createPasswordExchange({
    timeoutMs: 180_000,
    ask: async () => {
      const parent = BrowserWindow.getFocusedWindow() ?? mainWindow;
      const choice =
        parent && !parent.isDestroyed()
          ? await dialog.showMessageBox(parent, importDialogOptions())
          : await dialog.showMessageBox(importDialogOptions());
      return choice.response === 0;
    },
    openPasswords: async () => {
      const error = await shell.openPath("/System/Applications/Passwords.app");
      if (error) throw new Error("Could not open Passwords.");
    },
    importToken: (token) => importApplePasswords(token),
    storeItems: (items) => storePasswordItems(items),
    notify: (summary) => {
      for (const page of workspaceWindows) {
        if (!page.isDestroyed()) page.webContents.send("qm:passwords-imported", summary);
      }
      void dialog.showMessageBox({ type: "info", message: summary.message || "Imported passwords from Passwords." });
    },
    notifyError: (message) => {
      void dialog.showMessageBox({ type: "warning", message: "Could not import passwords", detail: message });
    },
  });
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", (_event, argv) => {
    const callback = argv.find((arg) => arg.startsWith("qm-desktop:"));
    if (callback) void finishBrowserSignIn(callback);
    const window = setupWindow ?? mainWindow;
    if (window?.isMinimized()) window.restore();
    window?.show();
  });
  app
    .whenReady()
    .then(start)
    .catch((error) => {
      dialog.showErrorBox("QM could not start", error.message);
      app.quit();
    });
}

function workspaceChrome() {
  return process.platform === "darwin"
    ? {
        titleBarStyle: "hiddenInset",
        trafficLightPosition: { x: 20, y: 20 },
        transparent: true,
        backgroundColor: "#00000000",
        vibrancy: "under-window",
        hasShadow: true,
        visualEffectState: "active",
      }
    : { backgroundColor: "#f5f4f0" };
}

function applyWindowGlass(page, mode) {
  if (page.isDestroyed()) return;
  const on = mode === "light" || mode === "dark";
  if (process.platform === "darwin") {
    let native = false;
    if (
      on &&
      typeof page.isGlassEffectSupported === "function" &&
      page.isGlassEffectSupported() &&
      typeof page.setGlassEffect === "function"
    ) {
      try {
        page.setVibrancy?.(null);
        page.setGlassEffect({
          style: mode === "dark" ? "regular" : "clear",
          cornerRadius: 0,
          tintColor: mode === "dark" ? "#10151f88" : "#f7fbff66",
        });
        native = true;
      } catch {
        native = false;
      }
    } else if (!on && typeof page.setGlassEffect === "function") {
      try {
        page.setGlassEffect(null);
      } catch {
        void 0;
      }
    }
    if (!native && typeof page.setVibrancy === "function") {
      page.setVibrancy(on ? (mode === "dark" ? "hud" : "under-window") : null);
    }
    page.setBackgroundColor?.(on ? "#00000000" : "#f5f4f0");
    return;
  }
  if (process.platform === "win32" && typeof page.setBackgroundMaterial === "function") {
    page.setBackgroundMaterial(on ? "acrylic" : "none");
  }
}

function openExternal(url) {
  if (externalUrl(url)) {
    shell.openExternal(url).catch((error) => dialog.showErrorBox("Could not open link", error.message));
  }
}

function showSetup() {
  if (setupWindow) return setupWindow.show();
  setupWindow = new BrowserWindow({
    title: "Welcome to QM",
    width: 1040,
    height: 760,
    minWidth: 700,
    minHeight: 650,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#f7f6f2",
    webPreferences: {
      preload: path.join(directory, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  setupWindow.webContents.on("will-navigate", (event) => event.preventDefault());
  setupWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  setupWindow.on("closed", () => {
    setupWindow = undefined;
    pendingLogin?.controller.abort();
    pendingLogin = undefined;
    loginStatus = "";
  });
  setupWindow.loadURL(setupUrl);
}

function instanceSession(url) {
  return electronSession.fromPartition(`persist:qm-${new URL(url).origin}`);
}

async function beginBrowserSignIn(url, loginUrl) {
  if (pendingLogin?.instance === url) return;
  pendingLogin?.controller.abort();
  const attempt = { ...createLogin(url, Date.now(), loginUrl), controller: new AbortController() };
  pendingLogin = attempt;
  loginStatus = "Finish signing in in your browser. This window will open your workspace when you're done.";
  showSetup();
  mainWindow?.destroy();
  setupWindow.webContents.send("qm:login-status", loginStatus);
  try {
    await shell.openExternal(attempt.url);
  } catch {
    if (pendingLogin !== attempt) return;
    pendingLogin = undefined;
    loginStatus = "Could not open your browser. Try connecting again.";
    setupWindow?.webContents.send("qm:login-status", loginStatus);
  }
}

async function finishBrowserSignIn(url) {
  if (pendingLogin?.redeeming) return;
  const code = loginCallback(url, pendingLogin);
  if (!code) return;
  const attempt = pendingLogin;
  attempt.redeeming = true;
  try {
    const response = await instanceSession(attempt.instance).fetch(
      new URL("/auth/desktop/redeem", attempt.instance).href,
      {
        method: "POST",
        redirect: "error",
        credentials: "include",
        headers: { "content-type": "application/x-www-form-urlencoded", origin: new URL(attempt.instance).origin },
        body: new URLSearchParams({ code, verifier: attempt.verifier, state: attempt.state }).toString(),
        signal: AbortSignal.any([attempt.controller.signal, AbortSignal.timeout(15_000)]),
      },
    );
    if (pendingLogin !== attempt) return;
    if (!response.ok) throw new Error("Sign-in could not be completed. Please connect again to get a fresh link.");
    await instanceSession(attempt.instance).cookies.flushStore();
    if (pendingLogin !== attempt) return;
    pendingLogin = undefined;
    loginStatus = "";
    void showInstance(attempt.instance);
    setupWindow?.close();
  } catch {
    if (pendingLogin !== attempt) return;
    pendingLogin = undefined;
    loginStatus = "Sign-in could not be completed. Please connect again to get a fresh link.";
    showSetup();
    setupWindow.webContents.send("qm:login-status", loginStatus);
  }
}

async function showInstance(url) {
  pendingLogin?.controller.abort();
  pendingLogin = undefined;
  if (browserLoginUrl(url, new URL(url).origin)) url = loginDestination(url, url);
  if (mainWindow) mainWindow.destroy();
  const window = new BrowserWindow({
    title: "QM",
    width: 1440,
    height: 960,
    minWidth: 800,
    minHeight: 600,
    ...workspaceChrome(),
    webPreferences: {
      session: instanceSession(url),
      preload: path.join(directory, "workspace-preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  mainWindow = window;
  const origin = new URL(url).origin;
  const session = window.webContents.session;
  session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.setPermissionCheckHandler(() => false);
  let handedOff = false;
  const children = new Set();
  const configureNavigation = (page) => {
    workspaceWindows.add(page);
    page.on("closed", () => workspaceWindows.delete(page));
    const active = () => !page.isDestroyed() && !window.isDestroyed() && mainWindow === window;
    const signIn = (destination) => {
      handedOff = true;
      void beginBrowserSignIn(loginDestination(destination, url, page.webContents.getURL()), destination);
    };
    const navigate = (event, destination) => {
      if (!active()) return event.preventDefault();
      if (event.isMainFrame === false) return;
      if (browserLoginUrl(destination, origin)) {
        event.preventDefault();
        signIn(destination);
      } else if (!internalUrl(destination, origin)) {
        event.preventDefault();
        handedOff = true;
        openExternal(destination);
      }
    };
    page.webContents.on("will-navigate", navigate);
    page.webContents.on("will-redirect", navigate);
    page.webContents.on("will-attach-webview", (event) => event.preventDefault());
    page.webContents.on("before-input-event", (event, input) => {
      const step = tabStep(input);
      if (!step) return;
      event.preventDefault();
      page.webContents.send("qm:cycle-tab", step);
    });
    page.webContents.setWindowOpenHandler(({ url: destination }) => {
      if (!active()) return { action: "deny" };
      if (browserLoginUrl(destination, origin)) signIn(destination);
      else if (internalUrl(destination, origin)) {
        return {
          action: "allow",
          overrideBrowserWindowOptions: {
            width: 1100,
            height: 800,
            minWidth: 600,
            minHeight: 400,
            ...workspaceChrome(),
            webPreferences: {
              session,
              preload: path.join(directory, "workspace-preload.cjs"),
              nodeIntegration: false,
              contextIsolation: true,
              sandbox: true,
            },
          },
        };
      } else openExternal(destination);
      return { action: "deny" };
    });
    page.webContents.on("did-create-window", (child) => {
      children.add(child);
      child.on("closed", () => children.delete(child));
      configureNavigation(child);
    });
  };
  configureNavigation(window);
  window.on("closed", () => {
    for (const child of children) if (!child.isDestroyed()) child.destroy();
    if (mainWindow === window) mainWindow = undefined;
  });
  try {
    await window.loadURL(url);
  } catch (error) {
    if (window.isDestroyed() || handedOff || error.code === "ERR_ABORTED") return;
    await dialog.showMessageBox(window, {
      type: "error",
      message: "Could not connect to QM",
      detail:
        "Check that your instance is running and the URL is correct. You can retry with View → Reload or change the URL with QM → Change Instance.",
    });
    showSetup();
  }
}

async function start() {
  app.setAsDefaultProtocolClient("qm-desktop");
  const configPath = path.join(app.getPath("userData"), "instance.json");
  try {
    target = instanceUrl(JSON.parse(await readFile(configPath, "utf8")).url);
  } catch (error) {
    if (error.code !== "ENOENT") dialog.showErrorBox("QM settings could not be read", error.message);
  }
  if (process.env.QM_DESKTOP_URL) target = instanceUrl(process.env.QM_DESKTOP_URL);
  const assertSetup = (event) => {
    if (event.sender !== setupWindow?.webContents || event.senderFrame?.url !== setupUrl) {
      throw new Error("Untrusted settings request");
    }
  };
  if (passwordExchange) {
    ipcMain.handle("qm:import-passwords", async (event) => {
      if (
        !mainWindow ||
        mainWindow.isDestroyed() ||
        ![...workspaceWindows].some((page) => !page.isDestroyed() && page.webContents === event.sender) ||
        event.senderFrame !== event.sender.mainFrame ||
        !target ||
        new URL(event.senderFrame.url).origin !== new URL(target).origin
      ) {
        throw new Error("Untrusted import request");
      }
      return passwordExchange.begin();
    });
  }
  ipcMain.handle("qm:glass", (event, value) => {
    const page = [...workspaceWindows].find(
      (candidate) => !candidate.isDestroyed() && candidate.webContents === event.sender,
    );
    if (!page || event.senderFrame !== event.sender.mainFrame) return;
    applyWindowGlass(page, value === "light" || value === "dark" ? value : "off");
  });
  ipcMain.handle("qm:open-browser", async (event, value) => {
    if (
      !mainWindow ||
      mainWindow.isDestroyed() ||
      ![...workspaceWindows].some((page) => !page.isDestroyed() && page.webContents === event.sender) ||
      event.senderFrame !== event.sender.mainFrame ||
      !target ||
      new URL(event.senderFrame.url).origin !== new URL(target).origin ||
      typeof value !== "string"
    ) {
      throw new Error("Untrusted browser request");
    }
    const destination = new URL(value, target);
    if (
      destination.origin !== new URL(target).origin ||
      !externalUrl(destination.href) ||
      !["http:", "https:"].includes(destination.protocol)
    )
      throw new Error("Untrusted browser destination");
    await shell.openExternal(destination.href);
  });
  ipcMain.handle("qm:current-instance", (event) => {
    assertSetup(event);
    return { url: target ?? "", status: loginStatus };
  });
  ipcMain.handle("qm:connect", async (event, value) => {
    assertSetup(event);
    try {
      const url = instanceUrl(value);
      await writeFile(configPath, JSON.stringify({ url }), { mode: 0o600 });
      target = url;
      void showInstance(url);
      setupWindow.close();
      return { ok: true };
    } catch (error) {
      return { error: error.message };
    }
  });
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "QM",
        submenu: [
          { role: "about" },
          { label: "Change Instance…", accelerator: "CmdOrCtrl+,", click: showSetup },
          {
            label: "Open in Browser",
            click: () => {
              if (target) openExternal(target);
            },
          },
          { type: "separator" },
          { role: "hide" },
          { role: "hideOthers" },
          { role: "unhide" },
          { type: "separator" },
          { role: "quit" },
        ],
      },
      { role: "editMenu" },
      {
        label: "View",
        submenu: [
          {
            label: "Back",
            accelerator: "Alt+Left",
            click: () => {
              const contents = BrowserWindow.getFocusedWindow()?.webContents;
              if (contents?.navigationHistory.canGoBack()) contents.navigationHistory.goBack();
            },
          },
          {
            label: "Forward",
            accelerator: "Alt+Right",
            click: () => {
              const contents = BrowserWindow.getFocusedWindow()?.webContents;
              if (contents?.navigationHistory.canGoForward()) contents.navigationHistory.goForward();
            },
          },
          { role: "reload" },
          { role: "forceReload" },
          { role: "toggleDevTools" },
          { type: "separator" },
          { role: "resetZoom" },
          { role: "zoomIn" },
          { role: "zoomOut" },
          { type: "separator" },
          { role: "togglefullscreen" },
        ],
      },
      { role: "windowMenu" },
    ]),
  );
  app.on("activate", () => {
    if (setupWindow) setupWindow.show();
    else if (pendingLogin) showSetup();
    else if (mainWindow) mainWindow.show();
    else if (target) void showInstance(target);
    else showSetup();
  });
  if (target) await showInstance(target);
  else showSetup();
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
