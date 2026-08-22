# Change 022 tasks

## 1. Codex sandbox flag

- [x] 1.1 Add `-s danger-full-access` to `buildCodexInvocation` args (before
  `-m`, prompt stays last positional); update the stale 0.147.0 comment.

## 2. Stdin isolation

- [x] 2.1 Spawn executor children with
  `stdio: ['ignore', 'pipe', 'pipe']` in `WindowsPowerShellAdapter.spawn`.
- [x] 2.2 Same stdio configuration in `WslAdapter.spawn`.

## 3. Focused coverage

- [x] 3.1 New `executor-invocation.test.ts`: codex profile args contain the
  full verified sequence with the user-configured model and trailing prompt;
  kimi/generic profiles pinned unchanged.
- [x] 3.2 Adapter test: Windows adapter child has no stdin writer while
  stdout/stderr remain readable; WSL spawn options use stdin-ignored stdio.

## 4. Gates + durable state

- [x] 4.1 Focused suite green; typecheck/build/lint/`git diff --check` green;
  strict OpenSpec validation green; record results truthfully. (Focused 6/6 in
  `executor-invocation.test.ts`; fast tier 53 files / 259 tests; typecheck,
  build, lint exit 0; `openspec validate --all --strict` 22 passed / 0 failed;
  `git diff --check` clean.)
- [ ] 4.2 Commit/push coherent checkpoint to `main`; update waypoint at the
  next meaningful checkpoint of the qualification campaign.
