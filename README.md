# No Normalize

An extension that compensates for YouTube's **audio normalization**, bringing playback closer to the video's original volume.

Currently supports **Chromium-based browsers**, including Chrome, Edge, and Brave.

## Installation

Open this repository's **Releases** page and download the appropriate file under **Assets**.

### Install from a `.crx` file

1. Download `no-normalize-<version>-chromium.crx` from a release.
2. Open your browser's extensions page:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
   - Brave: `brave://extensions`
3. Enable **Developer mode** if your browser requires it.
4. Drag the `.crx` file onto the extensions page and confirm installation if your browser allows it.
5. Reload any open YouTube tabs, then click the extension's icon to use it.

> [!WARNING]  
> This extension has not been published on the Chrome Web Store or other extension stores. Installing or using the `.crx` file may be blocked or unsupported on some browsers and operating systems. Do not disable your browser's security protections to install it. If installation is blocked, use **Load unpacked** below.

### Install with Load unpacked

1. Download `no-normalize-<version>-chromium.zip` under **Assets**.
   - Do not choose GitHub's automatically generated **Source code (zip)** archive; it is not a built extension.
2. Extract the archive into a permanent folder.
3. Open your browser's extensions page as described above and enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the extracted folder that directly contains `manifest.json`.
6. Reload YouTube and open the extension's popup.

Do not delete or move the folder used for Load unpacked. To update, replace its contents with the new build, click **Reload** on the extensions page, and reload your YouTube tabs.

## Development

Built with **React + TypeScript + Extension.js**, using **Bun** for dependency management.

### Requirements

- **Node.js 22.12 or later**; Node.js 24 LTS is recommended.
- **Bun 1.4.4** to match the CI environment.
- Chromium or Chrome for testing.

### Install dependencies and start development

Clone the repository, then open a terminal in the project directory:

```sh
bun install --frozen-lockfile
bun run dev
```

Extension.js starts the development server, opens a browser, and loads the extension. Edit files in `src/` to develop with hot reload.

If Chromium is missing, install the development browser and try again:

```sh
bunx extension install chromium
bun run dev
```

To use Chrome instead of the default Chromium target:

```sh
bun run dev -- --browser=chrome
```

### Build and preview a production version

```sh
bun run build
bun run preview
```

The default build outputs the extension to **`dist/chromium/`**. You can also select this directory with Load unpacked to test it in your own browser.

### Code checks

```sh
bunx tsc --noEmit
bun test
```

> After reloading or updating the extension, **reload your YouTube tabs** (for example, with `Ctrl+F5`) to replace the old content scripts and audio graphs. If the extensions page still shows errors from a previous version, clear the error history and check again.

## Automated builds and releases

Pushing a `v*` tag triggers GitHub Actions to build and package the extension, then attach the ZIP, CRX, `MD5SUMS`, and `SHA256SUMS` to a GitHub Release.

See the [release guide](docs/RELEASING.md) for signing-key setup and release instructions.
