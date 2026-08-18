# Repository Guide

## Source of truth

- The executable app is still the legacy generic labeler. The planned PR study is **not implemented**.
- Before product work, run `openspec status --change "card-sorting-prs-mvp" --json` and read the returned
  artifact paths.
- For the target behavior, prefer `openspec/changes/card-sorting-prs-mvp/` over older drafts in `plans/`.
- Fixed MVP decisions: retrospective sample of 300 PRs; default 3 configurable participants; all receive the same
  300 PRs and complete every non-withdrawn card; categories stay hidden across participants; only `CLASSIFIED` has
  exactly one private flat category; only the normalized final taxonomy is hierarchical; CSV selects the sample and
  GitHub API enriches snapshots; no webhooks in the MVP.
- OpenSpec `propose`/`update` are planning-only. Start code changes only through an explicit apply request.

## Commands

Run from the repository root; EJS views and `dotenv` rely on the working directory.

```bash
npm ci
npm run dev          # nodemon, development, http://localhost:3000
npm run start        # production mode
npm run lint:js      # reliable focused check
```

Local Docker stack:

```bash
docker compose --env-file deployment/.env -f deployment/docker-compose.yml up --build -d
docker compose --env-file deployment/.env -f deployment/docker-compose.yml ps
curl http://localhost:7755/actuator/health
docker compose --env-file deployment/.env -f deployment/docker-compose.yml down
```

- `.env` files are ignored. The templates contain shell placeholders, not ready-to-use values; create concrete local
  files without committing credentials.
- `npm run lint` is currently misleading: `lint:css` repeats `stylelint` in its path arguments and
  `.stylelintrc.json` extends missing `stylelint-config-standard`.
- `npm run lint:md` checks only root `*.md`, including this file; it does not cover `plans/` or `openspec/`.
- `npm run minify` rewrites `public/css/*.css` in place. It is a build step, not a read-only verification command.
- There is no test script or automated test suite yet. Do not report tests as passing when only lint/build ran.

## Runtime architecture

- `index.js` is the entrypoint: Express middleware, EJS SSR, actuator, response minification, rotating logs, and
  Socket.io. Starting it creates `logs/`.
- `routes/` uses `express-file-routing`: filesystem paths define URLs and modules export `get`, `post`, `del`, etc.
  Bracketed names such as `[id]` and `[target]` are route parameters.
- `util/pg-pool.js` is the shared PostgreSQL pool. Routes issue SQL directly; there is no ORM or service layer.
- `schema/01_...` through `06_...` are loaded in numeric order: schema, declarations, views, then implementations.
  There is no migration runner in the legacy app.
- Frontend code is EJS plus inline JavaScript and CDN dependencies; there is no bundler. Instance rendering is
  centralized in `views/partials/instance/data.ejs`.
- Current exports stream JSONL from PostgreSQL views; they are not the planned reproducible CSV/TSV study package.

## PostgreSQL and fixture traps

- PostgreSQL executes `/docker-entrypoint-initdb.d` only for empty `PGDATA`. SQL or fixture edits do nothing to an
  existing `labeling-data` volume. `down -v` deletes it; the next `up` reloads schema and fixtures, losing local data.
- Compose mounts `test-data/{label.txt,reviewer.txt,instance.tsv}`: 4 labels, 3 reviewers, and 6 fake PRs. It does not
  load the 300-record research CSV.
- The legacy loader accepts only two columns: `category` plus JSON, with no header. The research CSV has 69 columns,
  multiline quoted fields, and embedded JSON; it requires the importer specified by OpenSpec.
- `scripts/init-data.sh` checks CSV before TSV despite the README claiming TSV precedence. Its nonstandard quote
  character also makes conventional CSV with JSON commas unsafe; use the mounted TSV for legacy fixtures.
- `COMPOSE_PROJECT_NAME` changes the project name, but explicit container, volume, and network names (`labeling-*`)
  still prevent parallel stack isolation. PostgreSQL is internal-only; the app is exposed at port 7755.

## Legacy behavior that must not leak into the MVP

- “Login” only enumerates reviewers and trusts a client-supplied `reviewer_id`; there are no sessions, authorization,
  or CSRF protections.
- Labels are global, multiselect, and broadcast through Socket.io. In the MVP, personal categories remain private;
  only a `CLASSIFIED` result has exactly one flat category.
- Candidate/finished SQL hard-codes 2 reviews; bucket completion hard-codes 366.
- Review label inserts are neither awaited nor transactional.
- Conflict resolution deletes or overwrites original reviews/discards and materializes a shared outcome. The MVP must
  preserve originals and store normalization, agreement, and adjudication separately.

## Style and workflow

- JavaScript is ESM with 4 spaces, double quotes, semicolons, and Unix line endings; prefix intentionally unused names
  with `_`.
- SQL uses `snake_case`; preserve the definition/implementation split when touching legacy SQL.
- Git Flow is initialized with `master`, `develop`, and `feature/`. Use feature branches from `develop`.
- Commit messages must be conventional commits written in Spanish with an explanatory body. Obtain explicit approval
  before any commit or push.
