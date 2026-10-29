# 18. Quality and continuous integration

🇧🇷 [Português](../18-Qualidade-e-CI.md) · 🇺🇸 **English**

[Documentation index](README.md) · ← [17. Tests](17-Tests.md)

> Local hooks, the CI pipeline and the contribution flow.

**On this page**

- [Local hooks (Husky)](#local-hooks-husky)
  - [Fast pre-push (#367)](#fast-pre-push-367)
- [CI (GitHub Actions)](#ci-github-actions)
  - [CI images pinned by digest](#ci-images-pinned-by-digest)
  - [Contract tests of the real sources](#contract-tests-of-the-real-sources)
- [Contribution flow](#contribution-flow)

## Local hooks (Husky)

Installed automatically by `npm install` (`prepare` script).

| Hook | Check | Scope |
| --- | --- | --- |
| `pre-commit` | ESLint (`--max-warnings=0`), Prettier and related tests (`vitest related`); `prisma format --check` and `prisma validate` when the commit has `.prisma` files | Only staged files (`lint-staged.config.mjs`), in batches of up to 6000 characters: the default Windows limit (8191) does not count the quotes around paths with spaces, and a commit with dozens of files overflowed the command line |
| `commit-msg` | Conventional Commits with the scope restricted to the project's modules and areas | Commit message (`commitlint.config.mjs`) |
| `pre-push` | `scripts/verify-push.mjs`: typecheck, ESLint on the whole project and only the unit tests affected by the pushed files (`vitest related`) | Every commit not yet published; skipped when the push does not change code, schema or configuration |

### Fast pre-push (#367)

The pre-push used to run `npm run verify` (typecheck, every unit test with coverage and every e2e test)
and had come to cost about **11 minutes** per push (the e2e alone, 593 s in the #333 round). Now it runs
what is cheap and decisive before publishing, and leaves the full suite to CI:

| Step | Where it runs | What it guarantees |
| --- | --- | --- |
| `pre-commit` | every commit | ESLint, Prettier and tests affected by the staged files (NFSE09) |
| `pre-push` | every push with code | typecheck, **ESLint on the whole project** and unit tests affected by the files of every pushed commit |
| CI | every PR and every push to `develop`, `pre-prod` and `main` | lint, Prettier, typecheck, **every** unit test with a 75% minimum coverage (NFPD03) and **every** e2e test; it is the check required by branch protection (NFSE11) |

- **Which tests run.** `vitest related` follows the import graph from the pushed files. A change in
  `package.json`, `package-lock.json`, `tsconfig*.json`, the Vitest configuration or the Prisma schema runs
  the whole unit suite (`forceRerunTriggers` in `vitest.config.ts`: the graph does not see those files).
  Without a base to compare against or with more than 200 files, it also runs everything, never nothing.
- **Why the e2e tests left the push.** Each e2e file starts the whole `AppModule`; following the import
  graph, any change in `src` affects all of them, and a diff-based filter would select the whole suite
  anyway. They run in CI, and `npm run verify` runs them locally.
- **Lint joined the push.** The old pre-push did not run ESLint, and the unsafe-types error of an e2e test
  in #333 only showed up in CI. The commit's lint-staged fixes what it can, but it does not replace the
  full lint.
- **Measured time** (Windows, same machine): one changed code file, **82 s** (typecheck, ESLint and 2 test
  files); Prisma schema, `tsconfig` or more than 200 files, 113 to 116 s (the whole unit suite); no code,
  54 s. Before, ~11 min in every case.
- **Manual use.** `npm run verify:push` compares the branch with `origin/develop` (merge base), adding
  what has not been committed yet.

## CI (GitHub Actions)

The `.github/workflows/ci.yml` workflow runs on pull requests and pushes to `develop`, `pre-prod` and
`main`, with no deploy step:

- **Lint**: commit messages and the PR title, Prisma schema, ESLint, Prettier and typecheck;
- **Tests** (job "Testes"): unit tests with the 75% coverage threshold, e2e tests against the MongoDB and
  Redis from `docker-compose.yml` (awaited by `docker compose up --wait`), a coverage summary in the job
  and the full report as an artifact. The MongoDB image is **pinned to the patch** (`mongo:8.3.11`), so CI
  and every machine run the same database; upgrading the version is a deliberate change in
  `docker-compose.yml`. If the infrastructure fails to start, a step prints the containers' log.
- **The Tests job's runner is pinned to Ubuntu 22.04.** From Linux kernel 6.19 to 7.0.13, MongoDB 8
  refuses to start (an incompatibility between tcmalloc and the kernel, SERVER-121912, valid for every 8.x
  image and package; fixed in kernel 7.0.14). `ubuntu-latest` started using a kernel in that range, and the
  infrastructure step failed with `container bios-mongodb exited (1)`. A step records the runner's
  `uname -r`. Running the database locally is not affected (Docker Desktop's kernel is older). If 22.04
  also reaches that range, the alternative is to use MongoDB 7.0 in CI, which does not have the problem.

Actions are pinned by commit SHA and updated by Dependabot (`.github/dependabot.yml`), which also opens
weekly npm dependency PRs against `develop`, grouped by ecosystem. The majors the stack does not accept
are blocked there, with the reason recorded: Prisma 7 (no MongoDB support), TypeScript 7 (refused by the
peers of `@nestjs/swagger` and `typescript-eslint`) and Vitest 5 (Rolldown's native binary, which npm does
not install from the lockfile).

### CI images pinned by digest

The Tests job gets MongoDB and Redis from alternative registries (Google's mirror, ECR Public and Docker
Hub, in this order), and a published tag may start pointing to different content without notice. That is
why the content is decided by the **multi-architecture index digest** in `.github/ci-images.lock` (the
same in the three registries): `pull-ci-images.sh` pulls `<registry>/<image>@sha256:…`, the engine
refuses different content and only then applies the local tag that `docker-compose.ci.yml` expects. A
Compose image without a digest in the lock stops the step before the infrastructure starts. The
development Compose still uses tags.

To upgrade a version (a deliberate change, in its own PR):

1. change the tag in `docker-compose.yml`, in `docker-compose.ci.yml` and in the first column of
   `.github/ci-images.lock`;
2. run `bash .github/scripts/update-ci-images.sh` (needs Docker with buildx and network access), which
   resolves the current digest of each tag and rewrites the lock;
3. run `bash .github/scripts/pull-ci-images.test.sh` and `update-ci-images.test.sh` (no network).

Dependabot does not update the lock. What watches for drift is the **CI images** job (`Imagens do CI`) of
the contract workflow (below), which runs `update-ci-images.sh --check` and fails when the tag has started
pointing to another digest (a rebuild of the base image, for example). The failure is a warning: the lock
only changes through the procedure above.

### Contract tests of the real sources

The e2e tests simulate each source with the shape the code assumes, and that is how the GHG error (10
organizations instead of 1029) slipped through. The `.github/workflows/contract.yml` workflow (every
Monday at 09:00 UTC and on demand, in *Actions → Contrato das fontes → Run workflow*) queries the real
sources with the same readers as the production code and flags format changes. **It is not a PR status
check** and it is part of neither `verify` nor the pre-push.

| Source | What the contract checks |
| --- | --- |
| IBAMA | Download of both dumps with `200` and not as an HTML page; size between 1 MB and the adapter's limit; CSV header with every column read; a sample of 50 thousand lines with legal-entity records that the mapper accepts. |
| CGU (CEIS and CNEP) | `200` with JSON using the key in the `chave-api-dados` header; lines accepted by the page reader; page 2 different from page 1; a call without a key refused (`401`/`403`). |
| GHG | `SearchAllOrganizations` delivers the whole requested page (not a sample) with a total above it; the next page without repeating organizations; a published inventory; a PDF report (`%PDF`, below the limit) whose CNPJ and year the reader identifies. |

The addresses come from the seeded catalog (`data_sources.seeder.ts`), that is, what goes to production.
The CGU key is the repository's `CGU_API_KEY` secret: it arrives only as the step's environment variable
(masked in the logs), and the tests neither print it nor pass it on to error messages. In CI, a missing
secret fails the run; locally the CGU suite is skipped with a warning.

```bash
npm run test:contract      # the three sources (downloads ~330 MB from IBAMA); CGU_API_KEY in the environment
npx vitest run --config vitest.config.contract.ts test/contract/ghg.contract-spec.ts   # one source
```

## Contribution flow

1. Open the issue with the appropriate template (task, bug or configuration), pasting the bios-docs
   artifacts that support it.
2. Create the branch from `develop` and open the PR back into it, with a Conventional Commits title (it
   becomes the commit message on a squash merge).
3. Promote `develop` → `pre-prod` → `main` through PRs; `main` and `pre-prod` are protected and only accept
   a merge with the **Lint** and **Testes** checks passing (NFR NFSE11).

---

[Documentation index](README.md) · ← [17. Tests](17-Tests.md)
