# GitHub HTML Preview (Firefox)

A Firefox extension that adds a **Preview** link to the file header action row on GitHub HTML blob pages — sitting just to the left of the "Add to space" button. Clicking it opens the rendered HTML in a new tab.

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

TypeScript source lives in `src/`, static assets (`manifest.json`, `icons/`) in `public/`. `npm run prepare-build` (chained from `start`/`lint`/`build`/`sign`) does:
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
   - creates a GitHub Release and attaches the signed `.xpi` as `github_html_preview-<version>.xpi` (falls back to a `-unsigned` variant if signing didn't run).

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
└── content.ts        # URL check → button injection → fetch + blob URL + window.open
public/
├── manifest.json     # MV3, content_scripts on github.com/*/blob/*
└── icons/icon-48.png, icon-96.png
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

## How it works

On every HTML blob page, the content script locates the "Add to space" button (a Primer IconButton wrapping an `octicon-space` SVG) and inserts a Preview link to its left. The link's class names are deep-cloned from the existing "Raw" link button so the styling stays in lockstep with whatever Primer ships.

Clicking Preview:
1. Constructs `https://github.com/{owner}/{repo}/raw/{branch}/{path}`.
2. `fetch`es it with `credentials: "same-origin"` — the github.com session cookie authenticates the request, github.com 302-redirects to a short-lived signed `raw.githubusercontent.com` URL whose `?token=` carries the authorization, and the browser follows the redirect to retrieve the file body.
3. Injects `<base href="...">` into the HTML so relative resources (`./style.css`, `<img src="logo.png">`) resolve against the file's raw directory.
4. Wraps the result in a `Blob` of `type: "text/html"` and `window.open`s the resulting `blob:` URL in a new tab.

## Why a new tab (and not an inline iframe)

GitHub's response sends `Content-Security-Policy: script-src https://github.githubassets.com`. Any iframe rendered inside the github.com document inherits that CSP — including `srcdoc`, `blob:`, and `data:` iframes — so HTML files that load CDN scripts (Chart.js, Mermaid, etc.) were silently broken when previewed in-place. A new top-level tab loaded from a `blob:` URL is not embedded in github.com and so has no inherited CSP; external scripts run normally.

## Private repo support

Supported. The `credentials: "same-origin"` fetch sends the github.com session cookie on the initial request; github.com then issues a signed redirect that carries the authorization onward. Relative resources inside the previewed HTML route back through `github.com/.../raw/` via the injected `<base>`, so they reuse the same cookie-then-redirect path.

## Out of scope

- Preview on PR diff / commit diff / Gist views.
- Additional extensions like `.svg` or `.md` (GitHub already renders these).
- An options page.
- Chrome / Edge builds.
