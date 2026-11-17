# GitHub Releases

Workflow: [`.github/workflows/release.yml`](../.github/workflows/release.yml).

## One-time setup

1. Prepare an RSA key for signing CRX files. Keep your existing `.pem` key if the extension has been packaged before. If you do not have a key, generate one once in a secure directory outside the repository:

   ```sh
   openssl genrsa -out no-normalize.pem 2048
   ```

2. In the GitHub repository, open **Settings → Secrets and variables → Actions → New repository secret**:
   - Name: `CRX_PRIVATE_KEY`
   - Secret: the complete, unencrypted RSA private key in PEM format, including the BEGIN/END lines and line breaks.

Never commit the private key or upload it as an artifact. The workflow writes the key only to the runner's temporary directory and deletes it when packaging finishes. A missing or invalid key causes the workflow to fail. Do not generate a new random key for each release, as this changes the extension ID.

## Creating a release

1. Set the same version in `package.json` and `src/manifest.json`, for example `1.0.1`.
2. Commit the changes, including the workflow, then create and push a matching tag:

   ```sh
   git tag v1.0.1
   git push origin v1.0.1
   ```

The workflow installs dependencies from `bun.lock`, runs TypeScript checks and tests, builds the Chromium extension with Extension.js, packages ZIP/CRX3 files, and creates a GitHub Release with these assets:

- `no-normalize-1.0.1-chromium.zip` — an unpacked build with `manifest.json` at the archive root.
- `no-normalize-1.0.1-chromium.crx` — a CRX3 package signed with your persistent key.
- `MD5SUMS` — MD5 checksums for both files.
- `SHA256SUMS` — SHA-256 checksums for both files.

You can rerun the workflow through **Actions → Build and release extension → Run workflow** by entering an existing tag, such as `v1.0.1`. If the release already exists, the workflow replaces assets with matching names without overwriting the release notes. Files are also retained as workflow artifacts for 14 days. No personal access token (PAT) is required; the publish job uses `GITHUB_TOKEN` with `contents: write` permission.

MD5 is intended to detect download corruption, not to protect against malicious tampering. Prefer SHA-256 for integrity checks:

```sh
md5sum --check MD5SUMS
sha256sum --check SHA256SUMS
```

**Installation note:** A self-signed CRX is not a Chrome Web Store extension. Chrome on Windows and macOS may block CRX installation from outside the store. For development, extract the ZIP and use **Load unpacked** in `chrome://extensions` with Developer mode enabled.
