import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { chmod, mkdir, stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

const run = promisify(execFile);
const directory = path.dirname(fileURLToPath(import.meta.url));
const buildDir = path.join(directory, "build");
const electronVersion = "44.4.3";

async function newer(output, inputs) {
  let built;
  try {
    built = await stat(output);
  } catch {
    return false;
  }
  for (const input of inputs) {
    if ((await stat(input)).mtimeMs > built.mtimeMs) return false;
  }
  return true;
}

async function headers() {
  const root = path.join(tmpdir(), "qm-desktop-node-headers", "node_headers");
  const include = path.join(root, "include/node/node_api.h");
  try {
    await stat(include);
    return root;
  } catch {
    await mkdir(path.dirname(root), { recursive: true });
  }
  const archive = path.join(tmpdir(), `qm-electron-headers-${electronVersion}.tar.gz`);
  const url = `https://artifacts.electronjs.org/headers/dist/v${electronVersion}/node-v${electronVersion}-headers.tar.gz`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not download Electron headers (${response.status}).`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(archive));
  await run("tar", ["-xzf", archive, "-C", path.dirname(root)]);
  return root;
}

export async function buildNative() {
  if (process.platform !== "darwin") return;
  await mkdir(buildDir, { recursive: true });
  const swift = path.join(directory, "password-import.swift");
  const provider = path.join(directory, "credential-provider.swift");
  const addon = path.join(directory, "password-import.c");
  const dylib = path.join(buildDir, "libQMPasswordImport.dylib");
  const node = path.join(buildDir, "password_import.node");
  const extension = path.join(buildDir, "QMCredentialProvider");
  if (!(await newer(dylib, [swift]))) {
    await run("swiftc", [
      "-parse-as-library",
      "-emit-library",
      "-module-name",
      "QMPasswordImport",
      "-target",
      "arm64-apple-macos26.0",
      "-O",
      "-Xlinker",
      "-install_name",
      "-Xlinker",
      "@rpath/libQMPasswordImport.dylib",
      "-framework",
      "AuthenticationServices",
      "-o",
      dylib,
      swift,
    ]);
  }
  if (!(await newer(node, [addon, dylib]))) {
    const root = await headers();
    await run("clang", [
      "-bundle",
      "-undefined",
      "dynamic_lookup",
      "-DNAPI_VERSION=8",
      `-I${path.join(root, "include/node")}`,
      "-target",
      "arm64-apple-macos26.0",
      "-o",
      node,
      addon,
    ]);
  }
  if (!(await newer(extension, [provider]))) {
    await run("swiftc", [
      "-parse-as-library",
      "-module-name",
      "QMCredentialProvider",
      "-target",
      "arm64-apple-macos26.0",
      "-O",
      "-Xlinker",
      "-e",
      "-Xlinker",
      "_NSExtensionMain",
      "-Xlinker",
      "-application_extension",
      "-framework",
      "AuthenticationServices",
      "-framework",
      "Cocoa",
      "-o",
      extension,
      provider,
    ]);
    await chmod(extension, 0o755);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildNative();
}
