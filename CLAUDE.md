# CLAUDE.md

## Architecture

Angular v22 multi-project workspace with pnpm. Two apps:

- `public-app` (`projects/public-app/`) — SSR via Express + `@angular/ssr`
- `admin-app` (`projects/admin-app/`) — SSR via Express + `@angular/ssr`

### Key Stack

- **Angular 22** with strict TypeScript (ES2022 target, TS ~6.0)
- **Tailwind CSS v4** via PostCSS (per-project `.postcssrc.json`)
- **Angular Material + CDK** for UI components
- **@ngrx/signals** for state management
- **Vitest** for unit testing (with `jsdom`)
- **Firebase** — Auth, Firestore (project: `analog-jones-v2`; Cloud Storage is not used)
- **Playwright** for e2e testing (Chromium, Firefox, WebKit)
- **Prettier** for formatting (single quotes, 100 char width)

### Core Library (`projects/core/`)

Single Angular library at `projects/core/` (package name `@aj/core`, generated via `ng generate library`). All domain services, stores, models, and shared infra live here. Apps consume it via the `@aj/core` path alias resolving directly to `projects/core/src/public-api`, so `ng build`/`ng test`/`ng serve` work on a clean checkout without prebuilding the lib. Run `pnpm build:core` only when you actually need the packaged output in `dist/core`.

Subfolders under `projects/core/src/lib/`:

- `category/`, `episode/`, `genre/`, `tag/`, `user/` — each with `<domain>.model.ts`, `<domain>.service.ts`, `<domain>.store.ts` (+ specs)
- Taxonomy is **embedded denormalized** on the `Episode` document (`categories`/`genres`/`tags` arrays), not stored in junction collections. The `category`/`genre`/`tag` services own propagating name/slug edits and add/remove across episodes; there is no `junction/` folder.
- `shared/` — cross-cutting infra only: `firebase.token.ts` (injection tokens `FIRESTORE`, `FIRESTORE_OPS`), `firebase-auth.token.ts` (`AUTH`, `AUTH_OPS`) and `transfer-state.helpers.ts`. The auth tokens live in their own file so public-app, which has no auth, does not bundle the `firebase/auth` SDK; keep `firebase/auth` imports out of files public-app loads.
- `styles/` — `theme.scss`, `theme-public.scss` (consumed via Sass `@use`, not exported from `public-api.ts`)

Each domain follows the same pattern:

- `<domain>.store.ts` — `signalStore` with `withState`, `withComputed`, `withMethods`
- `<domain>.service.ts` — Firebase data access

**Lib tests have their own target** — run `ng test core` (or `pnpm test:core`). They do NOT run under admin-app or public-app test targets.

**SEO** lives in `projects/public-app/src/app/seo/` (public-app-only — not part of `@aj/core`).

### Firebase

Each app has `projects/<app>/src/app/firebase.ts` exporting its Firebase instances and its `firestoreOps`. Uses Firebase modular SDK — NOT `@angular/fire`.

The two apps use different Firestore builds:

- **admin-app**: the full SDK (`firebase/firestore`).
- **public-app**: the REST-only build (`firebase/firestore/lite`), for the browser and SSR. It only does one-shot reads, and the full SDK's long-lived streaming connection stalled in-app reads on phones for 30s+ once it went stale. Keep `firebase/firestore` value imports (anything but `import type`) out of files public-app loads; `pnpm check:public-bundle` fails the build if the full SDK (or `firebase/auth`) reaches the public bundle.

Provided via injection tokens in each app's `app.config.ts`:

- **admin-app**: `AUTH`, `FIRESTORE`, `FIRESTORE_OPS`
- **public-app**: `FIRESTORE`, `FIRESTORE_OPS` (no auth)

Connects to emulators when `environment.useEmulators` is true.

**Static SDK functions are wrapped in injection tokens.** Because `vi.mock()` is banned (see Testing), services do not call `firebase/firestore` or `firebase/auth` static functions directly. Instead they inject:

- `FIRESTORE_OPS` — `collection`, `doc`, `documentId`, `query`, `orderBy`, `where`, `limit`, `getDoc`, `getDocs`, `getCountFromServer`, `addDoc`, `updateDoc`, `writeBatch`, plus the build's `Timestamp` class
- `AUTH_OPS` — `GoogleAuthProvider`, `signInWithPopup`, `signOut`, `onAuthStateChanged`

They are defined in `projects/core/src/lib/shared/firebase.token.ts` and `firebase-auth.token.ts` respectively. `AUTH_OPS` has a default factory that returns the real implementations. `FIRESTORE_OPS` has **no** default factory (a default would bundle one Firestore build into both apps): each app builds `firestoreOps` in its `firebase.ts` and provides it in `app.config.ts`. Tests override them via `TestBed.configureTestingModule({ providers: [{ provide: <TOKEN>, useValue: ... }] })` to actually exercise service methods. When a service needs an SDK function not yet on `FirestoreOps`, extend the interface and both apps' `firestoreOps` together (public-app's is checked with `satisfies`, so a missing key fails the build). Code that needs `Timestamp` at runtime in `@aj/core` takes it from `FIRESTORE_OPS`, because the full and lite builds each have their own class and `instanceof` fails across them.

Every public read goes through `TransferCacheService.cached()` (`shared/transfer-state.helpers.ts`), which retries a read that got no answer (three attempts) and bounds server-side reads to 10s. public-app's `firestoreOps` also fails any read with no answer after 30s so it can be retried. New public reads should go through `cached()` too.

### Shell Layout

Root shell (`layout/shell/`) wraps all routes:

- `mat-toolbar` for desktop nav
- `mat-sidenav` at `position="end"` for mobile (hamburger at right end)
- `BreakpointObserver` (`Breakpoints.Handset`) drives `isMobile` signal
- Public-app shell has sticky footer with all nav links

## Testing

- Do NOT use `vi.mock()` — this is an Angular toolchain constraint, not a project convention. `@angular/build`'s unit-test builder (used by `ng test`) injects a `vitest-mock-patch` to integrate Vitest with Angular's compilation pipeline; that patch and `vi.mock()`'s module-hoisting/interception mechanism step on each other and produce flaky failures (passes locally, fails in CI, or vice versa). Any Angular project using `@angular/build` + Vitest hits the same issue — it would only go away by switching to Jest or running Vitest outside the Angular builder. Applies equally to core, admin-app, and public-app specs. Mock via TestBed injection tokens instead.
- Mock Firebase by providing fake values for `AUTH`, `FIRESTORE`, `FIRESTORE_OPS`, or `AUTH_OPS` tokens (imported from `@aj/core`) in `TestBed.configureTestingModule`
- Use `vi.stubGlobal()` for browser APIs unavailable in jsdom (`OffscreenCanvas`, `createImageBitmap`)
- Detailed lib testing patterns (domain service / store) live in `projects/core/README.md`

## Angular Rules

- Do NOT set `standalone: true` — it's the default in Angular v20+
- Do NOT use `@HostBinding` / `@HostListener` — use `host: {}` in `@Component`/`@Directive` instead
- Do NOT use `ngClass` or `ngStyle` — use `class` and `style` bindings
- Use native control flow (`@if`, `@for`, `@switch`), not structural directives
- Use `input()` / `output()` functions, not decorators
- `NgOptimizedImage` for all static images (does not work for inline base64)
- `ChangeDetectionStrategy.OnPush` on all components
- Reactive forms over template-driven
- Do not assume globals like `new Date()` are available in templates

## State Management (@ngrx/signals)

```typescript
signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withComputed((store) => ({
    /* derived signals */
  })),
  withMethods((store) => ({
    /* async methods using patchState(store, {...}) */
  })),
);
```

Use `patchState()` for mutations. Never use `mutate`.

## Accessibility

Must pass all AXE checks and meet WCAG AA minimums (focus management, color contrast, ARIA).

## Formatting

Prettier: single quotes, 100 char width.

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:

- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
- Author a backlog-ready spec/issue → invoke /spec

## Versioning

- The root `VERSION` file is the source of truth, in `MAJOR.MINOR.PATCH.MICRO` form. `package.json` mirrors it as the 3-part translation (`1.2.3.4` → `1.2.3`); `projects/core/package.json` does not carry the release version.
- `/ship` bumps `VERSION` and adds the `CHANGELOG.md` entry on every PR. Do not hand-edit either; use `gstack-version-bump`.
- `CHANGELOG.md` entries are `## [X.Y.Z.W] - YYYY-MM-DD` with `### Added` / `Changed` / `Fixed` / `Removed`, written for site visitors and the hosts, not as a commit log.
- `pnpm release` tags the deployed commit `v<VERSION>` in addition to cutting the `Release_` branch.

## Deploy Configuration (configured by /setup-deploy)

- Platform: Cloud Run + Firebase Hosting (custom script, `scripts/deploy.mjs`)
- Production URL: https://analogjonestof.com
- Deploy workflow: none (GitHub Actions only builds and tests)
- Deploy status command: `gcloud run services describe public-app --project analog-jones-v2 --region us-central1 --format='value(status.latestReadyRevisionName,status.conditions[0].status)'`
- Merge method: squash
- Project type: web app
- Post-deploy health check: https://analogjonestof.com/

### Custom deploy hooks

- Pre-merge: none
- Deploy trigger: manual. `/land-and-deploy` only merges and verifies; it never runs a deploy command. After the merge, run `pnpm release --yes` from a checkout with active `gcloud` and `firebase` logins, then let the status command and health check confirm the new revision.
- Rollback: `pnpm rollback --list` shows each service's serving and recent revisions (note them before a release). `pnpm rollback --public <revision> --admin <revision>` shifts Cloud Run traffic and then redeploys Hosting to clear the CDN; shifting traffic alone leaves cached HTML pointing at JS chunks the older revision does not have. `--dry-run` prints the commands. A rolled-back service stays pinned to that revision; do not unpin it by hand (that would route traffic back to the release just rolled back). The next `pnpm release` moves traffic to the revision it deploys. Firestore rules and indexes are not rolled back: if the bad release changed them, check out the previous `Release_` branch and run `pnpm deploy:rules`, then run `pnpm deploy:rules` from `main` after the fix release (the release only deploys rules that changed since the previous release branch). Script tests: `pnpm test:scripts`.
- Deploy status: `gcloud run services describe public-app --project analog-jones-v2 --region us-central1 --format='value(status.latestReadyRevisionName,status.conditions[0].status)'`
- Health check: https://analogjonestof.com/
