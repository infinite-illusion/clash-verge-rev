# Repository Agent Instructions

## Repository Context and Branch Contract

This repository is the user's personal fork of
`clash-verge-rev/clash-verge-rev`, hosted as
`infinite-illusion/clash-verge-rev`. It is maintained as both a faithful
mirror of the upstream project and a place for the user's own custom work.

- `upstream` is the canonical `clash-verge-rev/clash-verge-rev` repository.
- `main` must remain a strict mirror of `upstream/main`.
- `dev` must remain a strict mirror of `upstream/dev`.
- Do not make product, feature, fix, or configuration commits directly on
  `main` or `dev`, and do not merge `custom` into either mirror branch.
- `custom` is the user's personal customization branch and the default branch
  for this fork. Put the user's custom features, fixes, release configuration,
  and other fork-specific changes there. `custom` is intentionally allowed to
  differ from upstream while incorporating the desired upstream baseline.
- Only branch-synchronization work should update the mirror branches. For that
  work, preserve the exact upstream relationship rather than treating the
  branches as ordinary development branches.

## GitHub Identity and Remote Operations

These rules are mandatory for every agent working in this repository.

- Do not run `gh auth switch` for repository work. It changes the active
  account for the entire `github.com` host and affects unrelated repositories.
- Use bare `gh` for every GitHub CLI command targeting this repository, for
  both reads and writes. The user's custom multi-account GitHub CLI reads this
  checkout's `gh.account` Git config and selects the `infinite-illusion`
  account. Do not use `/opt/homebrew/bin/gh` or `./scripts/gh-custom`.
- Do not override the local multi-account selection with `GH_TOKEN`, a custom
  `GH_CONFIG_DIR`, or another authentication wrapper. If the custom `gh`
  cannot authenticate as `infinite-illusion`, stop and report the problem
  instead of changing the active account or working around the local
  configuration.
- Before the first GitHub operation in a task, verify the effective identity
  and access to the fork:

  ```bash
  gh api user --jq .login
  gh repo view infinite-illusion/clash-verge-rev --json nameWithOwner --jq .nameWithOwner
  ```

  The expected binary is the custom fork, and the expected results are
  `infinite-illusion` and
  `infinite-illusion/clash-verge-rev`. If either value differs, do not perform
  the GitHub operation.
- The local `main` and `dev` branches may track `upstream`, so an implicit
  repository lookup can legitimately resolve to
  `clash-verge-rev/clash-verge-rev`. This does not change the selected account.
  Pass the repository explicitly with `-R infinite-illusion/clash-verge-rev`
  for fork operations and `-R clash-verge-rev/clash-verge-rev` for intentional
  upstream reads.

- Git transport is separate from GitHub CLI authentication. Preserve the
  repository's configured fetch and push URLs, and use
  `git push origin <branch>` for branch pushes.
- Git authorship is also separate. Use the repository-local Git identity with
  user name `infinite-illusion`; either its GitHub noreply email or its
  maintained email is acceptable. Do not replace it with the global Git
  identity.
- Never print, log, commit, or paste GitHub tokens or the Tauri updater private
  key. The updater key location and recovery procedure are documented in
  `.github/CUSTOM_FORK.md`.

For branch synchronization, release, signing, and updater operations, follow
`.github/CUSTOM_FORK.md`.
