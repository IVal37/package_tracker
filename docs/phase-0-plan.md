# Phase 0 — Foundation: plan

Postgres host decided: **Supabase** (2026-10-02).


## Goal

An empty but fully wired project: scaffold, lint, tests, CI, typed env, DB connection module. No features, no schema (the schema comes in Phase 1).

## Decisions

- **Postgres: Supabase.** Connect with the `postgres` (postgres.js) driver through Drizzle's `drizzle-orm/postgres-js`. Use the Supabase **transaction pooler** URL (port 6543) at runtime with `prepare: false`, which the pooler requires. Migrations use the direct/session URL. Using postgres.js keeps the code portable if the host ever changes.
- **Package manager:** npm, matching the Commands in CLAUDE.md. Use Node 24 locally (v24.19.0) and in CI.
- **Next.js:** whatever `create-next-app@latest` installs. App Router, TypeScript, ESLint flat config, `src/` dir, `@/*` import alias. No Tailwind unless asked.

## Dependencies to approve (CLAUDE.md: ask before adding anything not under Stack)

| Package | Why |
| --- | --- |
| next, react, react-dom, typescript, @types/* | scaffold (Stack) |
| eslint, eslint-config-next, prettier, eslint-config-prettier | lint (Stack: ESLint/Prettier) |
| vitest, @vitest/coverage-v8, @vitejs/plugin-react, jsdom | test runner, coverage, JSX transform, DOM environment |
| @testing-library/react, @testing-library/jest-dom, @testing-library/user-event | component tests (Stack) |
| msw | HTTP mocking (Stack) |
| zod | env + input validation (required by Code conventions) |
| drizzle-orm, drizzle-kit, postgres | ORM, migrations, Postgres driver |

Approving this plan approves this list. Nothing else gets added without asking.

## Steps (one commit each)

1. **Scaffold.** `create-next-app` refuses to run in a folder that already has `CLAUDE.md`, `.claude/` and `.env.local`, so generate it in the scratchpad dir and copy the files in. Merge its `.gitignore` into the existing one and keep the current entries. Turn on `"strict": true` and `"noUncheckedIndexedAccess": true` in `tsconfig.json`. Replace the boilerplate home page with a minimal page that renders the `Wordmark` component (step 4).
   Commit: `chore: scaffold Next.js app`
2. **Lint/format.** Add `eslint.config.mjs` (next core-web-vitals + typescript + prettier), `.prettierrc`, `.prettierignore`, and a `no-explicit-any: error` rule. Scripts: `lint` = `eslint . && prettier --check .`, `format` = `prettier --write .`, `typecheck` = `tsc --noEmit`.
   Commit: `chore: configure ESLint and Prettier`
3. **Test harness.**
   - `vitest.config.ts`: react plugin, `@` alias resolved by hand (so `vite-tsconfig-paths` isn't needed), default `jsdom` environment, `setupFiles: ['tests/setup.ts']`, coverage via v8 over `src/**` with `text` + `html` reporters.
   - `tests/setup.ts` imports `@testing-library/jest-dom/vitest` and starts the shared MSW server.
   - `tests/msw/server.ts` exports `setupServer()` with no handlers. Use `onUnhandledRequest: 'error'` so a test can never reach a real service. Reset handlers after each test.
   - Create a `tests/fixtures/` dir with a `.gitkeep`.
   - Scripts: `test` = `vitest run`, `test:watch` = `vitest`, `test:coverage` = `vitest run --coverage`.

   Commit: `chore: add Vitest, Testing Library and MSW`
4. **Sample component.** `src/components/wordmark.tsx`: a `Wordmark` component that renders the "Wayfind" name and tagline. Test it in `src/components/wordmark.test.tsx`.
   Commit: `feat: add Wordmark component`
5. **Typed env loader.** `src/lib/env.ts`:
   - A zod schema with `DATABASE_URL` (url, required), `DATABASE_URL_DIRECT` (url, optional, used by drizzle-kit) and `NODE_ENV` (enum, default `development`). Later phases add keys such as `TRACKING_PROVIDER`.
   - `parseEnv(source: Record<string, string | undefined>)` is pure. On failure it throws `Error("Invalid environment: missing DATABASE_URL; …")` and lists every bad key by name, **never its value**.
   - `getEnv()` parses `process.env` lazily on first call and caches the result. It is server-only: the file never exports `NEXT_PUBLIC_*` keys and says so in a comment.
   - Test `src/lib/env.test.ts` checks: valid input parses; a missing key throws a message that names the key; a malformed URL throws; secret values never appear in the error message.

   Commit: `feat: add typed env loader`
6. **DB module.** `src/lib/db/client.ts`:
   - `createDb(url, opts?)` returns `{ db, sql }`, where `sql` = `postgres(url, { prepare: false, max })` and `db` = `drizzle(sql, { schema })`.
   - `checkConnection(db)` runs `select 1`.
   - `getDb()` is a lazy singleton built from `getEnv().DATABASE_URL` (one pool per process, so dev hot reload doesn't leak connections).
   - `src/lib/db/schema.ts` exists but is empty; Phase 1 fills it.
   - Test `src/lib/db/client.test.ts` (node environment) uses `vi.mock('postgres')` and checks: the test URL and `prepare: false` reach the driver; `checkConnection` resolves when the query succeeds and rejects on a driver error; `getDb()` returns the same instance on repeated calls.
   - `drizzle.config.ts`: dialect postgresql, schema `src/lib/db/schema.ts`, out `drizzle/`, credentials from `DATABASE_URL_DIRECT ?? DATABASE_URL`.
   - Scripts: `db:generate` = `drizzle-kit generate`, `db:migrate` = `drizzle-kit migrate`.

   Commit: `feat: add Postgres connection module`
7. **Env example.** `.env.example` lists every key with placeholder values and comments, including Supabase pooler and direct URL formats. It must contain no real values. Never read or touch `.env.local`.
   Commit: `chore: add .env.example`
8. **CI.** `.github/workflows/ci.yml` runs on every push and pull_request: checkout → setup-node 24 with npm cache → `npm ci` → `npm run lint` → `npm run typecheck` → `npm run test:coverage`. Tests need no secrets because the env and DB are mocked. Set a dummy `DATABASE_URL` only if `next build` is added later.
   Commit: `ci: run lint, typecheck and tests on push`
9. **Docs.** Update the CLAUDE.md Commands section to the real scripts, adding `typecheck`, `format` and `db:generate`. Update the Folder layout with `src/lib/env.ts`, `tests/setup.ts` and `tests/msw/`. Set the Stack line to "Postgres (Supabase) + Drizzle ORM".
   Commit: `docs: fill in commands and layout`

## Files created

`package.json`, `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `.prettierrc`, `vitest.config.ts`, `drizzle.config.ts`, `.env.example`, `.github/workflows/ci.yml`, `src/app/{layout,page}.tsx`, `src/components/wordmark.tsx`, `src/lib/env.ts`, `src/lib/db/{client,schema}.ts`, `tests/setup.ts`, `tests/msw/server.ts`, plus a co-located `*.test.ts(x)` for each module.

## Explicitly not in Phase 0

Drizzle tables or migrations, any tracking/provider code, auth, the Upgrade button, Supabase Auth or RLS setup, Tailwind, Playwright.

## Test gate

- The env loader throws a clear error that names a missing key (and doesn't leak values).
- The DB module connects with a test URL through the mocked driver; `checkConnection` passes and fails correctly.
- `Wordmark` renders.
- `npm run lint`, `npm run typecheck` and `npm test` are green locally and in GitHub Actions.
- Run `npm run test:coverage` and report the numbers. `docs/plan.md` sets no Phase 0 target, so aim for ≥90% on `src/lib/**`.
- Push to `origin/main` (ask the user first), confirm the Actions run is green on GitHub (the `gh` CLI isn't installed, so check in the browser or ask the user), then tag `phase-0-done`, push the tag, and update CLAUDE.md "Current phase" to Phase 1.

## Verification (manual, build session)

1. `npm run dev` → http://localhost:3000 shows the Wordmark.
2. `npm test` → all green. Delete `DATABASE_URL` in a scratch shell and call `getEnv()` (via a test) to see the named-key error.
3. Optional real-DB smoke test, once the user has created a Supabase project and put the URLs in `.env.local` themselves: a one-off `checkConnection(getDb())` returns without error. This isn't a gate requirement.
