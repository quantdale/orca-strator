# repository-source-truth Change Delta

## ADDED Requirements

### Requirement: Generated-data ignore rules are anchored

The `.gitignore` MUST anchor generic local-data directory rules (`logs/`,
`runtime/`, `browser-profile/`, `.orca-local/`) to the repository root so they
cannot match nested directories anywhere in the monorepo. Build-output
patterns (`dist/`, `build/`, `out/`, coverage, packaging output) MAY remain
unanchored because workspaces legitimately produce identically named
directories.

#### Scenario: Nested source directory named like a data directory

- **WHEN** a production source directory such as `apps/controller/src/runtime/` exists
- **THEN** Git does not ignore it by virtue of any generic data-directory rule

#### Scenario: Root-level local runtime data stays excluded

- **WHEN** local runtime data is created at the repository root under `runtime/`, `logs/`, `browser-profile/`, or `.orca-local/`
- **THEN** Git ignores it exactly as before

### Requirement: Tracked-source import integrity is enforced

A repository-integrity guard MUST verify that every relative import inside
tracked TypeScript source resolves to a file that exists on disk AND is
tracked in Git. The guard MUST fail with per-import diagnostics classifying
each violation as missing, IGNORED_BY_GITIGNORE, or UNTRACKED, and MUST fail
identically from a clean clone when required modules are absent.

#### Scenario: Ignored rescuing source detected

- **WHEN** tracked source imports a module that exists locally but is excluded by `.gitignore`
- **THEN** the guard exits non-zero naming the importing file, the specifier, and the ignored target

#### Scenario: Untracked source detected

- **WHEN** tracked source imports a module that exists locally but was never added to Git
- **THEN** the guard exits non-zero naming the untracked target

#### Scenario: Clean checkout of a coherent repository passes

- **WHEN** all relative imports of tracked TypeScript source resolve to tracked files
- **THEN** the guard exits zero reporting the checked file/import counts

#### Scenario: Sources directly under src are scanned

- **WHEN** a tracked source file sits directly under `src/` (e.g. `src/index.ts`)
- **THEN** its relative imports are verified by the guard

### Requirement: Fresh-clone reproducibility is proven from origin-only trees

Qualification claims that require a buildable repository MUST be re-provable
from a clean worktree populated strictly from committed Git state, without
borrowing ignored or untracked files from any development workspace.

#### Scenario: Clean worktree gate

- **WHEN** a detached clean worktree at `origin/main` installs dependencies and runs affected workspace typecheck/build plus focused suites
- **THEN** all succeed without reference to the primary working tree's untracked or ignored content
