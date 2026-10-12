#!/usr/bin/env node
// Fails when an SDK that public-app must not ship is present in its built bundle.
//
// - firebase/auth: public-app has no auth; the SDK gets pulled in whenever a
//   file it imports (directly or through @aj/core) also imports `firebase/auth`,
//   which costs every visitor about 90 kB on first load.
// - the full firebase/firestore build: public-app reads through the REST-only
//   `firebase/firestore/lite`. The full build reads over a long-lived streaming
//   connection that stalled in-app reads on phones for 30s+ once it went stale,
//   and it costs about 160 kB on first load.
//
// admin-app bundles both, so its build is the positive control: if a marker is
// not found there either, the marker has gone stale and this check would pass
// without guarding anything.
//
// Usage: pnpm check:public-bundle   (after `pnpm build:public && pnpm build:admin`)
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const PUBLIC_DIR = 'dist/public-app/browser';
const ADMIN_DIR = 'dist/admin-app/browser';

const BANNED = [
  {
    sdk: 'firebase/auth',
    // The Identity Toolkit hostname only appears in the firebase/auth SDK.
    marker: 'identitytoolkit',
    fix:
      'Keep `firebase/auth` imports out of files public-app loads; the auth tokens ' +
      'live in projects/core/src/lib/shared/firebase-auth.token.ts for this reason.',
  },
  {
    sdk: 'the full firebase/firestore build',
    // The session parameter of the streaming (WebChannel) transport, which the
    // lite build does not contain.
    marker: 'gsessionid',
    fix:
      'Keep `firebase/firestore` value imports out of files public-app loads (use ' +
      '`import type`, or `firebase/firestore/lite`); FIRESTORE_OPS has no default ' +
      'factory in projects/core/src/lib/shared/firebase.token.ts for this reason.',
  },
];

function fail(message) {
  console.error(message);
  process.exit(1);
}

// The .js files under `dir` (any depth), as { name, source }.
function load(dir, build) {
  if (!existsSync(dir)) fail(`${dir} not found. Run \`${build}\` first.`);
  const names = readdirSync(dir, { recursive: true }).filter((name) => name.endsWith('.js'));
  if (names.length === 0) fail(`No .js files in ${dir}; the build output looks wrong.`);
  return names.map((name) => ({ name, source: readFileSync(join(dir, name), 'utf8') }));
}

const hits = (scripts, marker) =>
  scripts.filter(({ source }) => source.includes(marker)).map(({ name }) => name);

const admin = load(ADMIN_DIR, 'pnpm build:admin');
const publicApp = load(PUBLIC_DIR, 'pnpm build:public');

for (const { sdk, marker, fix } of BANNED) {
  if (hits(admin, marker).length === 0) {
    fail(
      `"${marker}" was not found in the admin-app bundle, which does use ${sdk}. ` +
        'The marker no longer detects the SDK; update BANNED in scripts/check-public-bundle.mjs.',
    );
  }
  const found = hits(publicApp, marker);
  if (found.length > 0) {
    fail(`${sdk} is bundled into public-app (${found.join(', ')}). ${fix}`);
  }
}

console.log(
  `✔ public-app bundle is free of ${BANNED.map(({ sdk }) => sdk).join(' and ')} ` +
    `(${publicApp.length} files checked).`,
);
