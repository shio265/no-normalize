// Uses a throwaway key outside the repository. Never produces release assets
// signed with a test key under release/.
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { validateCrx3, writeChecksums } from "../scripts/release";

const binary = process.env.CHROMIUM_BINARY;
if (!binary) throw new Error("Set CHROMIUM_BINARY to Chrome/Chromium before running bun tests/package-crx.ts.");
const root = process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "Temp", "opencode") : tmpdir();
await mkdir(root, { recursive: true });
const temp = await mkdtemp(join(root, "no-normalize-crx-test-"));
try {
  const extension = join(temp, "extension");
  const keyPath = join(temp, "test-key.pem");
  await cp(resolve("dist/chromium"), extension, { recursive: true });
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  await writeFile(keyPath, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
  const result = Bun.spawnSync([
    binary, "--headless=new", "--no-sandbox", "--disable-gpu", "--no-message-box",
    `--user-data-dir=${join(temp, "profile")}`,
    `--pack-extension=${extension}`, `--pack-extension-key=${keyPath}`,
  ], { stdout: "pipe", stderr: "pipe", timeout: 30000 });
  assert.equal(result.exitCode, 0, result.stderr.toString());
  await rename(`${extension}.crx`, join(temp, "test.crx"));
  const crx = await readFile(join(temp, "test.crx"));
  validateCrx3(crx);
  await writeFile(join(temp, "test.zip"), Buffer.from("checksum fixture"));
  await writeChecksums(temp, ["test.crx", "test.zip"]);
  for (const name of ["MD5SUMS", "SHA256SUMS"]) {
    const contents = await readFile(join(temp, name), "utf8");
    assert(contents.includes("test.crx") && contents.includes("test.zip"));
    assert(!contents.includes("test-key.pem"));
  }
  console.log(`CRX3 packaging and MD5/SHA256 generation passed (${crx.length} bytes). Test key was not released.`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
