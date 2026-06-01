// Sync public/manifest.json version from package.json.
// Invoked by the `version` npm script during `npm version <bump>`, so the
// manifest stays in lockstep with the package version that npm just bumped.
import { readFileSync, writeFileSync } from "node:fs";

const manifestPath = "public/manifest.json";
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

if (manifest.version === pkg.version) {
  console.log(`manifest already at ${pkg.version}, nothing to sync`);
  process.exit(0);
}

manifest.version = pkg.version;
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(`synced ${manifestPath} -> ${pkg.version}`);
