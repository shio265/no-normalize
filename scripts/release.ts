import { createHash } from "node:crypto";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export function releaseMetadata(pkg: { name: string; version: string }, manifest: { version: string }, tag: string) {
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(pkg.name)) throw new Error("Package name must be safe for release filenames.");
  if (!/^\d+(?:\.\d+){0,3}$/.test(manifest.version) ||
      manifest.version.split(".").some((part) => Number(part) > 65535 || (part.length > 1 && part.startsWith("0"))) ||
      manifest.version.split(".").every((part) => Number(part) === 0)) {
    throw new Error("Manifest version must be a valid Chrome extension version.");
  }
  if (pkg.version !== manifest.version) throw new Error("package.json and src/manifest.json versions must match.");
  if (tag !== `v${manifest.version}`) throw new Error(`Release tag must be v${manifest.version}, received ${JSON.stringify(tag)}.`);
  const baseName = `${pkg.name}-${manifest.version}`;
  return {
    tag,
    version: manifest.version,
    base_name: baseName,
    zip_name: `${baseName}-chromium.zip`,
    crx_name: `${baseName}-chromium.crx`,
  };
}

export function validateCrx3(data: Buffer) {
  if (data.length < 16 || data.toString("ascii", 0, 4) !== "Cr24" || data.readUInt32LE(4) !== 3) {
    throw new Error("Chrome did not produce a valid CRX3 header.");
  }
  const zipOffset = 12 + data.readUInt32LE(8);
  if (zipOffset < 13 || zipOffset + 4 > data.length || !data.subarray(zipOffset, zipOffset + 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
    throw new Error("CRX3 ZIP payload is missing or truncated.");
  }
}

export async function writeChecksums(directory: string, names: string[]) {
  const files = await Promise.all([...names].sort().map(async (name) => {
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(name)) throw new Error("Unsafe checksum filename.");
    const data = await readFile(join(directory, name));
    if (data.length === 0) throw new Error(`Release asset is empty: ${name}`);
    if (name.endsWith(".crx")) validateCrx3(data);
    return { name, data };
  }));
  for (const [algorithm, filename] of [["md5", "MD5SUMS"], ["sha256", "SHA256SUMS"]] as const) {
    const lines = files.map(({ name, data }) => `${createHash(algorithm).update(data).digest("hex")}  ${name}\n`);
    await writeFile(join(directory, filename), lines.join(""));
  }
}

if (import.meta.main) {
  const pkg = await Bun.file(new URL("../package.json", import.meta.url)).json();
  const manifest = await Bun.file(new URL("../src/manifest.json", import.meta.url)).json();
  const metadata = releaseMetadata(pkg, manifest, process.env.RELEASE_TAG ?? "");
  switch (process.argv[2]) {
    case "metadata":
      if (process.env.GITHUB_OUTPUT) {
        await appendFile(process.env.GITHUB_OUTPUT, Object.entries(metadata).map(([key, value]) => `${key}=${value}\n`).join(""));
      }
      console.log(JSON.stringify(metadata, null, 2));
      break;
    case "checksums": {
      const built = await Bun.file("dist/chromium/manifest.json").json();
      if (built.version !== metadata.version) throw new Error("Built manifest version does not match the release.");
      await writeChecksums("release", [metadata.zip_name, metadata.crx_name]);
      break;
    }
    default:
      throw new Error("Usage: RELEASE_TAG=v<version> bun scripts/release.ts <metadata|checksums>");
  }
}
