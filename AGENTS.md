# Repository Agent Instructions

## GitHub Identity and Remote Operations

These rules are mandatory for every agent working in this repository.

- Do not run `gh auth switch` for repository work. It changes the active
  account for the entire `github.com` host and affects unrelated repositories.
- Run every GitHub CLI command targeting this repository through
  `./scripts/gh-custom`, for both reads and writes. Do not use bare `gh` for
  this repository.
- `./scripts/gh-custom` selects the stored `infinite-illusion` credential for
  the command, sets the repository to
  `infinite-illusion/clash-verge-rev`, and does not change the global active
  `gh` account.
- If the wrapper is missing or cannot authenticate, stop and report the
  problem. Do not work around it by changing the global `gh` account.
- Before a GitHub write, verify the effective identity and target when there
  is any doubt:

  ```bash
  ./scripts/gh-custom api user --jq .login
  ./scripts/gh-custom api repos/{owner}/{repo} --jq .full_name
  ```

- Git transport is separate from GitHub CLI authentication. `origin` fetches
  from the repository HTTPS URL, while its push URL uses
  `git@github.com.ii:infinite-illusion/clash-verge-rev.git`. Preserve this
  separation and use `git push origin <branch>` for branch pushes.
- Git authorship is also separate. Use the repository-local Git identity with
  user name `infinite-illusion`; either its GitHub noreply email or its
  maintained email is acceptable. Do not replace it with the global Git
  identity.
- Never print, log, commit, or paste GitHub tokens or the Tauri updater private
  key. The updater key location and recovery procedure are documented in
  `.github/CUSTOM_FORK.md`.

For branch synchronization, release, signing, and updater operations, follow
`.github/CUSTOM_FORK.md`.
