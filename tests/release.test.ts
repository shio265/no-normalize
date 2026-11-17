import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { releaseMetadata, validateCrx3, writeChecksums } from "../scripts/release";

const pkg = { name: "no-normalize", version: "1.0.0" };
const manifest = { version: "1.0.0" };

test("release filenames follow the versioned Chromium ZIP produced by Extension.js", () => {
  expect(releaseMetadata(pkg, manifest, "v1.0.0")).toEqual({
    tag: "v1.0.0", version: "1.0.0", base_name: "no-normalize-1.0.0",
    zip_name: "no-normalize-1.0.0-chromium.zip", crx_name: "no-normalize-1.0.0-chromium.crx",
  });
});

test.each(["v2.0.0", "1.0.0", "v1.0.0-beta", "v1.0.0\ninjected=true"])("rejects mismatched or unsafe tag %s", (tag) => {
  expect(() => releaseMetadata(pkg, manifest, tag)).toThrow("Release tag must be");
});

test("rejects unsynchronized package and manifest versions", () => {
  expect(() => releaseMetadata({ ...pkg, version: "1.0.1" }, manifest, "v1.0.0")).toThrow("versions must match");
});

test.each(["01.0.0", "1.0.65536", "0.0.0", "1.0.0.0.1", "1.0.0-beta"])("rejects invalid Chrome version %s", (version) => {
  expect(() => releaseMetadata({ ...pkg, version }, { version }, `v${version}`)).toThrow("valid Chrome");
});

test("rejects filenames that could escape the asset directory or inject workflow outputs", () => {
  expect(() => releaseMetadata({ ...pkg, name: "../private" }, manifest, "v1.0.0")).toThrow("safe for release filenames");
});

function crxFixture() {
  const data = Buffer.alloc(20);
  data.write("Cr24");
  data.writeUInt32LE(3, 4);
  data.writeUInt32LE(4, 8);
  Buffer.from([0x50, 0x4b, 0x03, 0x04]).copy(data, 16);
  return data;
}

test("validates CRX3 framing and rejects wrong versions or truncated payloads", () => {
  const data = crxFixture();
  expect(() => validateCrx3(data)).not.toThrow();
  expect(() => validateCrx3(Buffer.from("not a CRX"))).toThrow();
  const old = Buffer.from(data);
  old.writeUInt32LE(2, 4);
  expect(() => validateCrx3(old)).toThrow();
  expect(() => validateCrx3(data.subarray(0, 18))).toThrow("payload");
});

test("writes stable MD5/SHA256 manifests for both assets, never for private keys", async () => {
  const temp = await mkdtemp(join(process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "Temp", "opencode") : tmpdir(), "no-normalize-checksums-"));
  try {
    const crx = crxFixture();
    const zip = Buffer.from("zip fixture");
    await writeFile(join(temp, "test.crx"), crx);
    await writeFile(join(temp, "test.zip"), zip);
    await writeFile(join(temp, "private.pem"), "must not be released");
    await writeChecksums(temp, ["test.zip", "test.crx"]);
    for (const [algorithm, filename] of [["md5", "MD5SUMS"], ["sha256", "SHA256SUMS"]] as const) {
      const contents = await readFile(join(temp, filename), "utf8");
      expect(contents).toBe(
        `${createHash(algorithm).update(crx).digest("hex")}  test.crx\n` +
        `${createHash(algorithm).update(zip).digest("hex")}  test.zip\n`,
      );
      expect(contents).not.toContain("private.pem");
    }
    await expect(writeChecksums(temp, ["../private.pem"])).rejects.toThrow("Unsafe");
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
