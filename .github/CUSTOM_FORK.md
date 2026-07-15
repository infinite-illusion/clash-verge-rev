# Custom fork maintenance

This repository is maintained for personal custom builds under the
`infinite-illusion` account.

## Branches

- `main` is a strict mirror of `clash-verge-rev/clash-verge-rev:main`.
- `dev` is a strict mirror of `clash-verge-rev/clash-verge-rev:dev`.
- `custom` is the default branch. It merges stable upstream changes and keeps
  the custom feature and release infrastructure.

Never develop directly on `main` or `dev`.

## Synchronization and releases

`custom-sync.yml` runs every six hours and can also be dispatched manually. It
mirrors the upstream branches, merges `upstream/main` into `custom`, validates
the custom code against both stable `main` and development `dev`, and reports
failures through a repository issue.

The upstream AutoBuild and Mihomo changelog workflows remain available for
manual dispatch, but their schedules are disabled on this fork.

The development compatibility check uses
`.github/scripts/custom-dev-compat.mjs` for the one file where `dev` has already
removed an API that is still present on stable `main`. If the upstream shape
changes again, the adapter fails explicitly instead of guessing.

When the version in `package.json` has a matching upstream tag, the workflow
creates the same tag name on `custom` and dispatches `release.yml`. The app
version therefore stays identical to upstream.

Personal releases only build macOS ARM64, Windows x64, and Windows ARM64.
Windows fixed-WebView2 installers are built for both Windows architectures.
Linux and Intel macOS artifacts are intentionally excluded.

## Signing and updates

- Tauri updater artifacts are signed with the repository secret
  `TAURI_PRIVATE_KEY`.
- Only the matching public key is committed to the Tauri configuration.
- macOS artifacts use ad-hoc signing (`signingIdentity: "-"`) so no personal
  Apple Developer identity is exposed.
- Updater endpoints point only to releases in this repository.
- Updater manifests contain only macOS ARM64 and the two Windows targets, and
  are generated from artifacts that have both a download URL and signature.

Keep an offline backup of the updater private key. Losing it means installed
custom builds cannot verify future updates signed by a replacement key.
