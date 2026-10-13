import { packager } from "@electron/packager";
import { chmod, cp, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const mac = process.platform === "darwin";
const release = process.argv.includes("--release");
const identity = process.env.QM_MAC_SIGN_IDENTITY;
const keychainProfile = process.env.QM_MAC_NOTARY_PROFILE;
if (release && (!mac || !identity || !keychainProfile)) {
  throw new Error("Mac releases require macOS, QM_MAC_SIGN_IDENTITY and QM_MAC_NOTARY_PROFILE.");
}
if (mac) {
  const { buildNative } = await import("./native/build.mjs");
  await buildNative();
}
const ignore = [
  /^\/(dist|test|README\.md|package\.mjs)/,
  /^\/entitlements\.mac/,
  /^\/native\/build\.mjs$/,
  /^\/native\/[^/]+\.(swift|c|entitlements|plist)$/,
];
if (mac) ignore.push(/^\/native\/build\/(?!.*\.(node|dylib)$).+/);
else ignore.push(/^\/native\//, /^\/passwords\.mjs$/, /^\/password-exchange\.mjs$/);
const apps = await packager({
  dir: directory,
  name: "QM",
  appBundleId: "com.qm.desktop",
  protocols: [{ name: "QM", schemes: ["qm-desktop"] }],
  icon: path.join(directory, "assets/qm"),
  out: path.join(directory, "dist"),
  overwrite: true,
  asar: mac ? { unpack: "**/*.{node,dylib}" } : true,
  ...(mac ? { extendInfo: { NSUserActivityTypes: ["ASCredentialExchangeActivity"] } } : {}),
  ignore,
});

async function appBundle(dir) {
  if (dir.endsWith(".app")) return dir;
  const names = await readdir(dir);
  const app = names.find((name) => name.endsWith(".app"));
  if (!app) throw new Error(`No app bundle in ${dir}`);
  return path.join(dir, app);
}

async function installCredentialProvider(dir) {
  const app = await appBundle(dir);
  const plugins = path.join(app, "Contents/PlugIns");
  const appex = path.join(plugins, "QMCredentialProvider.appex");
  const executable = path.join(appex, "Contents/MacOS/QMCredentialProvider");
  await rm(appex, { recursive: true, force: true });
  await mkdir(path.dirname(executable), { recursive: true });
  await cp(path.join(directory, "native/build/QMCredentialProvider"), executable);
  await chmod(executable, 0o755);
  await cp(path.join(directory, "native/QMCredentialProvider-Info.plist"), path.join(appex, "Contents/Info.plist"));
  const { sign } = await import("@electron/osx-sign");
  const signIdentity = release ? identity : "-";
  await sign({
    app,
    identity: signIdentity,
    identityValidation: false,
    timestamp: release ? undefined : "none",
    optionsForFile: (filePath) => {
      if (
        filePath.includes(`${path.sep}QMCredentialProvider.appex${path.sep}`) ||
        filePath.endsWith("QMCredentialProvider.appex")
      ) {
        return { entitlements: path.join(directory, "native/credential-provider.entitlements") };
      }
      if (filePath.endsWith(`${path.sep}QM.app`) || filePath.endsWith(`${path.sep}MacOS${path.sep}QM`)) {
        return { entitlements: path.join(directory, "entitlements.mac.plist") };
      }
      if (
        !release &&
        (filePath.includes(`${path.sep}QM Helper.app`) ||
          filePath.includes("QM Helper (GPU).app") ||
          filePath.includes("QM Helper (Renderer).app"))
      ) {
        return { entitlements: path.join(directory, "entitlements.mac.helper.plist") };
      }
      return {};
    },
  });
  if (release) {
    const { notarize } = await import("@electron/notarize");
    await notarize({ appPath: app, keychainProfile });
  }
}

if (mac) {
  for (const app of apps) {
    await installCredentialProvider(app);
    console.log(await appBundle(app));
  }
} else {
  for (const app of apps) console.log(app);
}
