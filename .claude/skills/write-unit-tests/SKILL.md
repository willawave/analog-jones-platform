---
name: write-unit-tests
description: Write or extend Vitest unit tests for Angular code in this workspace. Use when the user asks to test, add coverage for, or write specs for a `.ts` file under `projects/` — services, signal stores, components, directives, or pipes. Co-locates `.spec.ts` files next to the source. Follows the project's TestBed-based mocking conventions and avoids `vi.mock()`.
---

# write-unit-tests

Write unit tests for the file(s) the user provides using Vitest for Angular.

## File placement

- If a `.spec.ts` file does not exist, create it as `[filename].spec.ts` (e.g. `episode.store.spec.ts`) co-located with the source file.
- If a `.spec.ts` file already exists, **add** tests to it without removing existing ones.
- Lib specs live under `projects/core/src/lib/**/*.spec.ts` and run via their own target — `ng test core` (or `pnpm test:core`). They do NOT run under admin-app or public-app test targets.
- App specs live under `projects/admin-app/**/*.spec.ts` or `projects/public-app/**/*.spec.ts` and run via `ng test admin-app` / `ng test public-app`.

## Framework rules

- Use Vitest: `import { describe, it, expect, vi, beforeEach } from 'vitest'` — never jasmine or jest.
- Use Angular's `TestBed` for components, directives, and services that require DI.
- Use Angular Material component harnesses for testing Angular Material components.
- Components default to `ChangeDetectionStrategy.OnPush` — call `fixture.detectChanges()` after signal/state updates.
- Native control flow only in test fixtures (`@if`, `@for`) — no structural directives.

## Mocking

- **Do NOT use `vi.mock()`.** This is an Angular toolchain constraint, not a project convention. `@angular/build`'s unit-test builder injects a `vitest-mock-patch` to integrate Vitest with Angular's compilation pipeline; that patch and `vi.mock()`'s module-hoisting/interception mechanism step on each other and produce flaky failures (passes locally, fails in CI, or vice versa). Mock via TestBed providers / injection tokens instead.
- Mock Firebase by providing fake values for the `AUTH`, `AUTH_OPS`, `FIRESTORE`, and `FIRESTORE_OPS` injection tokens (imported from `@aj/core`) in `TestBed.configureTestingModule({ providers: [...] })`.
- Mock other services with `{ provide: SomeService, useValue: { method: vi.fn() } }`.
- Use `vi.fn()` / `vi.spyOn()` for individual functions.
- Use `vi.stubGlobal()` for browser APIs unavailable in jsdom (e.g. `OffscreenCanvas`, `createImageBitmap`); reset with `vi.unstubAllGlobals()` in `afterEach` if needed.

### Static SDK functions go through `*_OPS` tokens

Services do not call `firebase/firestore` or `firebase/auth` static functions directly. They inject one of the `*_OPS` tokens defined in `projects/core/src/lib/shared/firebase.token.ts` (Firestore) and `firebase-auth.token.ts` (Auth):

- **`FIRESTORE_OPS`** — for any service that reads/writes Firestore. Inject alongside `FIRESTORE`.
- **`AUTH_OPS`** — for sign-in/sign-out/auth state. Inject alongside `AUTH`.

`AUTH_OPS` has a default factory that returns the real SDK implementations. `FIRESTORE_OPS` has none: each app provides its own `firestoreOps` (full SDK in admin-app, `firebase/firestore/lite` in public-app), so every spec that builds a real service or a real `TransferCacheService` must provide a fake for it. Tests override the tokens with `vi.fn()` stubs to actually exercise the service. Without this indirection, the static imports cannot be intercepted (because `vi.mock()` is banned) and specs degenerate into shape-assertions that don't run any service code.

Reference: `projects/core/src/lib/category/category.service.ts` + `category.service.spec.ts` (Firestore), `projects/core/src/lib/user/user.service.ts` + `user.service.spec.ts` (Auth + Firestore).

When adding a service that needs an op not yet on the relevant `*Ops` interface, extend the interface **and** every implementation together: the default factory for `AuthOps`; both apps' `firestoreOps` (`projects/<app>/src/app/firebase.ts`) and the fake `ops` objects in the service specs for `FirestoreOps`.

## Signal stores (`@ngrx/signals`)

- Provide the store via `TestBed.inject(SomeStore)` after configuring providers for its dependencies.
- Assert on signal values by calling them: `expect(store.items()).toEqual([...])`.
- Test `withMethods` actions by invoking them and asserting the resulting state via `patchState`-driven signals.
- For async methods, `await` the action then assert; to observe mid-flight `loading` state, mock the dependency with a manually-resolved `Promise`.

## Test coverage — write tests in each category

1. **Happy paths** — correct inputs produce expected outputs/state.
2. **Edge cases** — boundary values, empty arrays, null/undefined inputs, empty strings, in-flight cancellation/supersession.
3. **Error states** — thrown errors, Firebase errors, rejected promises/observables; verify `error` signal is set and `loading` resets.

## Reference specs (current paths)

- Service with Firestore: `projects/core/src/lib/episode/episode.service.spec.ts`
- Signal store: `projects/core/src/lib/episode/episode.store.spec.ts`
- Junction service: `projects/core/src/lib/junction/episode-tag.service.spec.ts`

## Coverage tooling

Uses `@vitest/coverage-v8`. If a coverage run fails because the package is missing, surface the install command rather than installing silently:

```
pnpm add -D @vitest/coverage-v8
```

## Workflow

1. Read the target file and any existing `.spec.ts` next to it.
2. Read one of the reference specs above to match the project's testing style.
3. Identify gaps: methods or branches not yet covered, including loading/error transitions.
4. Add focused tests; avoid duplicating existing coverage.
5. Run the appropriate target to verify:
   - Lib: `pnpm exec ng test core --watch=false --include='**/<file>.spec.ts'`
   - Admin-app: `pnpm exec ng test admin-app --watch=false --include='**/<file>.spec.ts'`
   - Public-app: `pnpm exec ng test public-app --watch=false --include='**/<file>.spec.ts'`
6. Report what was added and which categories (happy/edge/error) it covers.
