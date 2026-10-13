const { contextBridge, ipcRenderer } = require("electron");

const qmDesktop = {
  openBrowser: (url) => ipcRenderer.invoke("qm:open-browser", url),
};
if (process.platform === "darwin") {
  qmDesktop.importPasswords = () => ipcRenderer.invoke("qm:import-passwords");
  ipcRenderer.on("qm:passwords-imported", (_event, summary) => {
    window.dispatchEvent(new CustomEvent("qm-passwords-imported", { detail: summary }));
  });
}
contextBridge.exposeInMainWorld("qmDesktop", qmDesktop);

window.addEventListener("DOMContentLoaded", () => {
  const root = document.documentElement;
  const mac = process.platform === "darwin";
  root.dataset.qmDesktop = process.platform;
  const style = document.createElement("style");
  style.textContent = `
    html[data-qm-desktop="darwin"] body { padding-top: 48px; }
    html[data-qm-desktop="darwin"] body::before {
      content: ""; position: fixed; inset: 0 0 auto; height: 48px;
      background: var(--background, #f5f4f0); z-index: 100;
      -webkit-app-region: drag;
    }
    html[data-qm-desktop="darwin"] .layout { height: calc(100dvh - 48px); }
    html[data-qm-desktop="darwin"] .layout.bannered {
      height: calc(100dvh - 86px - env(safe-area-inset-top));
    }
    html[data-qm-desktop="darwin"] .top-banner { top: 48px; }
    html[data-qm-desktop="darwin"] header.top { top: 48px; }
    html[data-qm-desktop="darwin"] #app-view #main .admin-inner { margin-inline: 0; }
    @media (min-width: 901px) {
      html[data-qm-desktop="darwin"]:has(.admin-app:not(.hidden)) body { padding-top: 0; }
      html[data-qm-desktop="darwin"]:has(.admin-app:not(.hidden)) body::before { display: none; }
      html[data-qm-desktop="darwin"]:has(.admin-app:not(.hidden)) header.top {
        top: 0; -webkit-app-region: drag;
      }
      html[data-qm-desktop="darwin"] .admin-sidebar { top: 0; height: 100dvh; }
      html[data-qm-desktop="darwin"] .admin-sidebar .brand {
        min-height: 56px; padding-left: 92px; -webkit-app-region: drag; user-select: none;
      }
      html[data-qm-desktop="darwin"] header.top :is(a, button, input, select) {
        -webkit-app-region: no-drag;
      }
    }
    @media (max-width: 900px) {
      html[data-qm-desktop="darwin"] .admin-sidebar { top: calc(48px + var(--header-total-h)); }
    }
    @media (max-width: 860px) {
      html[data-qm-desktop="darwin"] .layout { top: 48px; }
    }
    @media (min-width: 861px) {
      html[data-qm-desktop="darwin"]:has(.layout:not(.bannered)) body { padding-top: 0; }
      html[data-qm-desktop="darwin"]:has(.layout:not(.bannered)) body::before { display: none; }
      html[data-qm-desktop="darwin"] .layout:not(.bannered) { height: 100dvh; --rail-w: 100px; }
      html[data-qm-desktop="darwin"] .layout:not(.bannered) .sidebar { padding-top: 0; }
      html[data-qm-desktop="darwin"] .layout:not(.bannered) .brand {
        height: 56px; min-height: 56px; box-sizing: border-box; padding: 0 8px 0 92px;
        justify-content: flex-end; -webkit-app-region: drag; user-select: none;
      }
      html[data-qm-desktop="darwin"] .layout:not(.bannered) .brand-lockup { display: none; }
      html[data-qm-desktop="darwin"] .layout:not(.bannered).sidebar-closed .brand {
        height: 96px; min-height: 96px; padding: 48px 0 8px; justify-content: center;
      }
      html[data-qm-desktop="darwin"] .brand button { -webkit-app-region: no-drag; }
      html[data-qm-desktop="darwin"] .dv-tabs-and-actions-container,
      html[data-qm-desktop="darwin"] .chat-topbar { -webkit-app-region: drag; }
      html[data-qm-desktop="darwin"] .dv-tabs-and-actions-container :is(button, a, input, [role="tab"], .dv-tab),
      html[data-qm-desktop="darwin"] .chat-topbar :is(button, a, input, [role="tab"]) {
        -webkit-app-region: no-drag;
      }
    }
    html[data-qm-desktop="darwin"] .single-pane .dv-tabs-and-actions-container .dv-tab {
      -webkit-app-region: drag; user-select: none;
    }
    html[data-qm-desktop="darwin"] .single-pane .dv-tab :is(button, a, input) {
      -webkit-app-region: no-drag;
    }
    [data-qm-shortcut] { position: relative; }
    html[data-qm-shortcuts] [data-qm-shortcut] { padding-right: 48px !important; }
    [data-qm-shortcut]::after {
      content: attr(data-qm-shortcut); display: none; position: absolute; right: 7px;
      top: 50%; transform: translateY(-50%); min-width: 28px; height: 20px;
      align-items: center; justify-content: center; box-sizing: border-box;
      padding: 0 4px; border: 1px solid var(--border, #ddd); border-radius: 5px;
      background: var(--background, #f5f4f0); color: var(--muted-foreground, #777);
      font: 11px ui-sans-serif, system-ui, sans-serif; font-variant-numeric: tabular-nums;
      pointer-events: none;
    }
    html[data-qm-shortcuts] [data-qm-shortcut]::after { display: flex; }
    html[data-qm-shortcuts] .session-row:has([data-qm-shortcut]) .session-menu { visibility: hidden; }
    html.glass {
      color-scheme: light;
      --background: #f6f5f1;
      --foreground: #172033;
      --card: #fffcf8;
      --popover: #fffcf8;
      --secondary: #efece6;
      --muted: #efece6;
      --muted-foreground: #5c6b80;
      --accent: #e7eef8;
      --accent-foreground: #243056;
      --border: rgb(23 32 51 / 0.12);
      --input: #fffcf8;
      --sidebar: transparent;
      --sidebar-accent: rgb(255 255 255 / 0.55);
      --sidebar-border: rgb(255 255 255 / 0.4);
      --scrim: rgb(23 32 51 / 0.46);
      --cta: oklch(0.46 0.14 272);
      --cta-hover: oklch(0.52 0.14 272);
      --brand-accent: #5646cc;
      --markdown-link: #2a4cb5;
    }
    html.glass.dark {
      color-scheme: dark;
      --background: #141820;
      --foreground: #f4f7fc;
      --card: #1c2230;
      --popover: #1c2230;
      --secondary: #242a38;
      --muted: #242a38;
      --muted-foreground: #b7c2d4;
      --accent: #2a3348;
      --accent-foreground: #e8ecf8;
      --border: rgb(255 255 255 / 0.12);
      --input: #242a38;
      --sidebar-accent: rgb(255 255 255 / 0.12);
      --sidebar-border: rgb(255 255 255 / 0.14);
      --scrim: rgb(6 8 14 / 0.62);
      --cta: oklch(0.74 0.11 272);
      --cta-hover: oklch(0.8 0.1 272);
      --cta-foreground: #16141f;
      --brand-accent: #c4bcff;
      --markdown-link: #b7c6ff;
    }
    html.glass,
    html.glass body,
    html.glass #app,
    html.glass .layout {
      background: transparent !important;
      background-image: none !important;
    }
    html.glass[data-qm-desktop="darwin"] body::before { background: transparent !important; }
    html.glass .sidebar {
      background: linear-gradient(180deg, rgb(255 255 255 / 0.3), rgb(255 255 255 / 0.14)) !important;
      border-right-color: rgb(255 255 255 / 0.62);
      box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.85), inset -1px 0 0 rgb(255 255 255 / 0.4);
    }
    html.glass.dark .sidebar {
      background: rgb(16 18 26 / 0.55) !important;
      border-right-color: rgb(255 255 255 / 0.1);
      box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.14);
    }
    html.glass .main,
    html.glass .split-canvas,
    html.glass .split-dock,
    html.glass .dv-dockview,
    html.glass .dockview-theme-qm,
    html.glass .dv-content-container,
    html.glass .custom-chat,
    html.glass .custom-chat-shell,
    html.glass .chat-scroll,
    html.glass .chat-topbar,
    html.glass .dockview-theme-qm .dv-tabs-and-actions-container {
      background: transparent !important;
      background-image: none !important;
      --split-strip-bg: transparent;
    }
    html.glass .dv-groupview {
      background: linear-gradient(165deg, rgb(255 255 255 / 0.24), rgb(255 255 255 / 0.08) 46%, rgb(226 238 255 / 0.16)) !important;
      box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.72);
    }
    html.glass.dark .dv-groupview {
      background: rgb(14 18 28 / 0.46) !important;
    }
    html.glass .main > .pane,
    html.glass .project-dialog {
      background: var(--background) !important;
    }
    html.glass .chat-topbar { border-bottom-color: rgb(255 255 255 / 0.38); }
    html.glass.dark .chat-topbar { border-bottom-color: rgb(255 255 255 / 0.1); }
    html.glass .session-row.active .session, html.glass .session-row.menu-open .session {
      background: rgb(255 255 255 / 0.46);
      box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.8);
    }
    html.glass.dark .session-row.active .session, html.glass.dark .session-row.menu-open .session {
      background: rgb(255 255 255 / 0.12);
      box-shadow: none;
    }
    html.glass .composer-wrap {
      border: 1px solid rgb(255 255 255 / 0.72) !important;
      border-radius: 22px;
      background: rgb(255 252 248 / 0.72) !important;
      background-image: none !important;
      box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.95), 0 12px 32px rgb(40 60 100 / 0.12);
    }
    html.glass.dark .composer-wrap {
      border-color: rgb(255 255 255 / 0.12) !important;
      background: #1c2230 !important;
      box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.08), 0 10px 28px rgb(0 0 0 / 0.28);
    }
    html.glass .user-bubble { --bubble-bg: rgb(255 255 255 / 0.58); box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.8); }
    html.glass.dark .user-bubble { --bubble-bg: #242a38; box-shadow: none; }
    html.glass :is(.menu-popover, .loadout-submenu, .session-menu-popover, .user-menu-popover, .chat-search-palette) {
      background: #fffcf8 !important;
      border: 1px solid rgb(23 32 51 / 0.1) !important;
      border-radius: 16px;
      box-shadow: 0 16px 40px rgb(40 60 100 / 0.16);
      backdrop-filter: none;
    }
    html.glass.dark :is(.menu-popover, .loadout-submenu, .session-menu-popover, .user-menu-popover, .chat-search-palette) {
      background: #1c2230 !important;
      border-color: rgb(255 255 255 / 0.12) !important;
      box-shadow: 0 16px 40px rgb(0 0 0 / 0.4);
    }
    html.glass .loadout-row.active,
    html.glass .loadout-row:hover,
    html.glass .loadout-row:focus-within { background: #efece6; box-shadow: none; }
    html.glass.dark .loadout-row.active,
    html.glass.dark .loadout-row:hover,
    html.glass.dark .loadout-row:focus-within { background: #2a3344; box-shadow: none; }
    html.glass .loadout-button:hover,
    html.glass .loadout-button[aria-expanded="true"] { background: #efece6; }
    html.glass.dark .loadout-button:hover,
    html.glass.dark .loadout-button[aria-expanded="true"] { background: #2a3344; }
    [data-qm-desktop] .message-stack .user-row.latest-prompt,
    [data-qm-desktop] .message-stack .user-row.stuck {
      position: static !important;
      top: auto !important;
      z-index: auto !important;
      min-height: 0 !important;
      margin-top: 0 !important;
      padding-top: 0 !important;
      pointer-events: auto !important;
    }
    [data-qm-desktop] .user-bubble > .pin-content {
      display: flow-root !important;
      -webkit-line-clamp: unset !important;
      max-height: none !important;
      overflow: visible !important;
    }
    [data-qm-desktop] .pin-toggle { display: none !important; }
    [data-qm-desktop] .message-stack .user-row.stuck > .user-bubble { box-shadow: none !important; }
    [data-qm-desktop] .custom-chat-shell > .qm-turn-rail {
      position: absolute;
      z-index: 6;
      left: 10px;
      top: 64px;
      bottom: 112px;
      width: 22px;
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 6px;
      margin: 0;
      padding: 0;
      pointer-events: none;
    }
    [data-qm-desktop] .custom-chat-shell > .qm-turn-rail[hidden] { display: none !important; }
    [data-qm-desktop] .qm-turn-mark {
      pointer-events: auto;
      display: flex;
      align-items: center;
      width: 22px;
      height: 12px;
      margin: 0;
      padding: 0;
      border: 0;
      background: transparent;
      cursor: pointer;
    }
    [data-qm-desktop] .qm-turn-mark span {
      display: block;
      width: 10px;
      height: 2px;
      border-radius: 99px;
      background: color-mix(in srgb, var(--foreground, #172033) 34%, transparent);
    }
    [data-qm-desktop] .qm-turn-mark:hover span,
    [data-qm-desktop] .qm-turn-mark[aria-current="true"] span {
      width: 18px;
      background: color-mix(in srgb, var(--foreground, #172033) 82%, transparent);
    }
  `;
  document.head.append(style);
  const glassStored = () => {
    try {
      return localStorage.getItem("theme") === "glass";
    } catch {
      return false;
    }
  };
  const systemDark = () => !!window.matchMedia?.("(prefers-color-scheme: dark)")?.matches;
  const applyStoredGlass = () => {
    if (!glassStored()) return;
    root.classList.add("glass");
    root.classList.toggle("dark", systemDark());
  };
  const mountGlassOption = () => {
    if (!document?.querySelector) return;
    const group = document.querySelector('.settings-choice[aria-label="Theme"]');
    if (
      !group ||
      [...group.querySelectorAll(".settings-choice-option")].some((option) =>
        option.textContent.includes("Liquid glass"),
      )
    ) {
      return;
    }
    const button = document.createElement("button");
    button.type = "button";
    button.className = "settings-choice-option";
    button.dataset.qmTheme = "glass";
    button.setAttribute("role", "radio");
    button.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 16.3c2.2 0 4-1.83 4-4.05 0-1.16-.57-2.26-1.71-3.19S7.29 6.75 7 5.3c-.29 1.45-1.14 2.84-2.29 3.76S3 11.1 3 12.25c0 2.22 1.8 4.05 4 4.05z"/><path d="M12.56 6.6A10.97 10.97 0 0 0 14 3.02c.5 2.5 2 4.9 4 6.5s3 3.5 3 5.5a6.98 6.98 0 0 1-11.91 4.97"/></svg><span>Liquid glass</span>';
    button.addEventListener("click", () => {
      try {
        localStorage.setItem("theme", "glass");
      } catch {
        void 0;
      }
      applyStoredGlass();
      for (const option of group.querySelectorAll(".settings-choice-option")) {
        const selected = option === button;
        option.classList.toggle("selected", selected);
        option.setAttribute("aria-checked", selected ? "true" : "false");
      }
    });
    group.append(button);
    if (!glassStored()) return;
    for (const option of group.querySelectorAll(".settings-choice-option")) {
      const selected = option === button;
      option.classList.toggle("selected", selected);
      option.setAttribute("aria-checked", selected ? "true" : "false");
    }
  };
  document.addEventListener(
    "click",
    (event) => {
      const option = event.target instanceof Element ? event.target.closest(".settings-choice-option") : null;
      if (!option || option.dataset.qmTheme === "glass" || option.textContent.includes("Liquid glass")) return;
      if (!option.closest('[aria-label="Theme"]')) return;
      root.classList.remove("glass");
    },
    true,
  );
  window.matchMedia?.("(prefers-color-scheme: dark)")?.addEventListener?.("change", () => {
    if (glassStored()) root.classList.toggle("dark", systemDark());
  });
  applyStoredGlass();
  mountGlassOption();
  new MutationObserver(mountGlassOption).observe(document.body, { childList: true, subtree: true });
  const publishGlass = () => {
    if (window.top !== window) return;
    const mode = root.classList.contains("glass") ? (root.classList.contains("dark") ? "dark" : "light") : "off";
    void ipcRenderer.invoke("qm:glass", mode);
  };
  new MutationObserver(publishGlass).observe(root, { attributes: true, attributeFilter: ["class"] });
  publishGlass();
  let links = [];
  let held = false;
  const clear = () => {
    held = false;
    delete root.dataset.qmShortcuts;
  };
  const refresh = () => {
    for (const link of links) delete link.dataset.qmShortcut;
    const seen = new Set();
    links = [...document.querySelectorAll("#sidebar-body .session-row[data-session-id] > a.session[href]")]
      .filter((link) => {
        const id = link.parentElement.dataset.sessionId;
        if (seen.has(id) || !link.checkVisibility({ checkVisibilityCSS: true })) return false;
        seen.add(id);
        return true;
      })
      .slice(0, 9);
    links.forEach((link, index) => {
      link.dataset.qmShortcut = `${mac ? "⌘" : "Ctrl "}${index + 1}`;
    });
  };
  ipcRenderer.on("qm:cycle-tab", (_event, step) => {
    if (document.querySelector('dialog[open], [aria-modal="true"]:not(.sidebar)')) return;
    window.dispatchEvent(new CustomEvent("qm:cycle-tab", { detail: step }));
  });
  window.addEventListener(
    "keydown",
    (event) => {
      const modifier = mac ? event.metaKey : event.ctrlKey;
      if (!modifier || event.altKey || event.shiftKey || (mac && event.ctrlKey) || (!mac && event.metaKey)) {
        clear();
        return;
      }
      if (event.isComposing || document.querySelector('dialog[open], [aria-modal="true"]:not(.sidebar)')) {
        clear();
        return;
      }
      refresh();
      held = true;
      root.dataset.qmShortcuts = "";
      const index = /^[1-9]$/.test(event.key) ? Number(event.key) - 1 : -1;
      const link = links[index];
      if (!link) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!event.repeat) link.click();
    },
    true,
  );
  window.addEventListener(
    "keyup",
    (event) => {
      if (!(mac ? event.metaKey : event.ctrlKey)) clear();
    },
    true,
  );
  window.addEventListener("blur", clear);
  document.addEventListener("visibilitychange", clear);
  new MutationObserver(() => {
    if (held) refresh();
  }).observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "style", "hidden"],
  });
  const turnLabel = (row) =>
    (row.querySelector(".pin-content")?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 90);
  const syncTurnRails = () => {
    if (!document?.querySelectorAll) return;
    for (const shell of document.querySelectorAll(".custom-chat-shell")) {
      const scroller = shell.querySelector(".chat-scroll");
      if (!scroller) continue;
      let rail = shell.querySelector(":scope > nav.qm-turn-rail");
      if (!rail) {
        rail = document.createElement("nav");
        rail.className = "qm-turn-rail";
        rail.setAttribute("aria-label", "Jump to a message");
        shell.append(rail);
      }
      if (scroller.dataset.qmTurnRail !== "1") {
        scroller.dataset.qmTurnRail = "1";
        scroller.addEventListener("scroll", scheduleTurnRails, { passive: true });
      }
      const rows = [...scroller.querySelectorAll(".message-stack > .user-row")];
      while (rail.children.length > rows.length) rail.lastElementChild.remove();
      rows.forEach((row, index) => {
        let mark = rail.children[index];
        if (!mark) {
          mark = document.createElement("button");
          mark.type = "button";
          mark.className = "qm-turn-mark";
          mark.innerHTML = "<span></span>";
          mark.addEventListener("click", () => {
            const target = mark.qmRow;
            const scroll = mark.qmScroll;
            if (!target?.isConnected || !scroll?.isConnected) return;
            const top = target.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop - 8;
            const next = Math.max(0, top);
            const reduce = !!window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
            if (typeof scroll.scrollTo === "function")
              scroll.scrollTo({ top: next, behavior: reduce ? "auto" : "smooth" });
            else scroll.scrollTop = next;
          });
          rail.append(mark);
        }
        mark.qmRow = row;
        mark.qmScroll = scroller;
        const label = turnLabel(row) || "Message";
        if (mark.getAttribute("aria-label") !== `Jump to ${label}`) mark.setAttribute("aria-label", `Jump to ${label}`);
        mark.title = label;
      });
      rail.hidden = rows.length < 2;
      if (rail.hidden) continue;
      const edge = scroller.getBoundingClientRect().top + 16;
      let active = 0;
      rows.forEach((row, index) => {
        if (row.getBoundingClientRect().top <= edge) active = index;
      });
      [...rail.children].forEach((mark, index) => {
        if (index === active) mark.setAttribute("aria-current", "true");
        else mark.removeAttribute("aria-current");
      });
    }
  };
  let turnQueued = false;
  const scheduleTurnRails = () => {
    if (turnQueued) return;
    turnQueued = true;
    queueMicrotask(() => {
      turnQueued = false;
      syncTurnRails();
    });
  };
  if (document.body) new MutationObserver(scheduleTurnRails).observe(document.body, { childList: true, subtree: true });
  scheduleTurnRails();
});
