# GitHub HTML Preview (Firefox)

A Firefox extension that adds a **Preview** button next to `Code | Blame` on GitHub blob pages for HTML files. Clicking it toggles the code view to an inline rendered view in the same spot.

Target pages: `https://github.com/{owner}/{repo}/blob/{branch}/.../*.html` (and `.htm`).

## Install

### End users
1. Download the latest `.xpi` from [Releases](https://github.com/yunik1004/firefox-github-html-viewer/releases).
2. Drag and drop the file into Firefox and confirm the install prompt.

> Unsigned builds cannot be installed permanently on Firefox Release/ESR. Either use Firefox Developer Edition / Nightly with `about:config` → `xpinstall.signatures.required=false`, or load it temporarily via `about:debugging`.

### Developers (temporary install)
1. Clone this repository.
2. `npm install && npm run prepare-build` to produce `build/`.
3. Open `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** → select `build/manifest.json` (produced in step 2).
4. The extension stays loaded until Firefox is restarted.

## Development

Requirements: Node.js 20+

```sh
npm install
npm run typecheck    # tsc --noEmit (type check only)
npm start            # initial build + concurrent tsc --watch & web-ext run (live reload)
npm run lint         # rebuild + web-ext lint
npm run build        # rebuild + produce dist/*.zip (== .xpi)
npm run ci           # typecheck + lint + build (parity with CI)
```

TypeScript source lives in `src/`, static assets (`manifest.json`, `content.css`, `icons/`) in `public/`. `npm run prepare-build` (chained from `start`/`lint`/`build`/`sign`) does:
1. `rm -rf build dist`
2. `tsc` — compiles `src/*.ts` to `build/`
3. Copies the contents of `public/` to `build/`

`web-ext` then operates on `build/` as its source directory.

## Release

1. Bump the version. `npm version <patch|minor|major>` updates `package.json`, runs `scripts/sync-manifest-version.mjs` to mirror the bump into `public/manifest.json`, then creates a version commit and tag:
   ```sh
   npm version patch    # 0.1.0 -> 0.1.1, commits, tags v0.1.1
   git push --follow-tags
   ```
2. `.github/workflows/release.yml` then automatically:
   - verifies the tag matches `manifest.json` version,
   - runs lint and build,
   - signs with `web-ext sign --channel=unlisted` if AMO secrets are configured,
   - creates a GitHub Release and attaches the `.xpi`.

### AMO signing (optional, required for install on stock Firefox)
1. Generate a JWT issuer / secret at https://addons.mozilla.org/developers/addon/api/key/.
2. Register both as **repository secrets** (not variables) in Settings → Secrets and variables → Actions → **Secrets** tab → *New repository secret*:
   - `AMO_JWT_ISSUER`
   - `AMO_JWT_SECRET`

   They must be Secrets, not Variables: Variables are exposed to fork-PR builds and appear unmasked in logs, while Secrets are auto-masked and withheld from fork PRs.
3. The next release will attach a signed `.xpi` automatically.

## Project layout

```
src/
└── content.ts        # URL check → button injection → fetch + iframe render
public/
├── manifest.json     # MV3, content_scripts on github.com/*/blob/*
├── content.css       # Preview button / iframe styling
└── icons/icon.svg
scripts/
└── sync-manifest-version.mjs  # mirrors package.json version into manifest
build/                # generated: tsc output + copied public/ assets (gitignored)
dist/                 # generated: web-ext .xpi output (gitignored)
package.json          # typescript + web-ext + concurrently devDeps, npm scripts
tsconfig.json         # strict TS, target ES2022, outDir build/
web-ext-config.mjs    # sourceDir: "build", artifactsDir: "dist"
.github/workflows/
├── ci.yml            # push/PR: lint + build artifact
└── release.yml       # tag push: build + sign + release
```

## Private repo support

Supported. As long as the user is logged into GitHub in the same browser, the preview works for private repositories.

How it works: the extension fetches `https://github.com/{owner}/{repo}/raw/{branch}/{path}` with `credentials: "include"`. GitHub authenticates the request via the session cookie, then 302-redirects to a short-lived signed URL on `raw.githubusercontent.com`. `fetch` follows the redirect and returns the file body.

## Security model

The iframe is created with `sandbox="allow-scripts"`. `allow-same-origin` is intentionally omitted, so the frame runs in an **opaque origin**:
- Scripts in the iframe cannot reach the parent github.com page's DOM, cookies, or storage.
- Form submission, popups, and top-level navigation from inside the frame are blocked.

Relative resources (`./style.css`, `<img src="logo.png">`, etc.) are resolved by injecting a `<base href="...">` tag into the fetched HTML's `<head>`, pointing at the directory of the file's raw URL so same-repo assets load correctly.

## Out of scope

- Preview on PR diff / commit diff / Gist views.
- Additional extensions like `.svg` or `.md` (GitHub already renders these).
- An options page (e.g., toggling the sandbox policy).
- Chrome / Edge builds.
