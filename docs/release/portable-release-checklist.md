# Portable edition release checklist

English | [中文](portable-release-checklist.zh.md)

This checklist covers publishing the Windows portable edition from this fork. The repository is an unofficial fork of DeepSeek Harness under the MIT license: read [NOTICE.md](../../NOTICE.md) before publishing anything.

## Before building

The packaging step installs the desktop runtime with pnpm, which creates a store symlink under `apps/desktop/.desktop-build/pnpm-store`. Creating a symlink needs either an elevated shell or Windows Developer Mode. Without one, packaging stops with:

```text
pnpm: EPERM: operation not permitted, symlink ... -> .../pnpm-store/v11/projects/<hash>
```

Requirements:

- Node at or above the version this repository declares (`engines.node`), because `scripts/build.ts` only runs `main()` when `import.meta.main` is defined.
- `apps/desktop/.env.windows`, which the repository ignores. Start from `.env.windows.example` and set `DSH_DESKTOP_APP_ID` to an identifier you own.
- Enough free disk for one build: roughly 5 GB in `apps/desktop/.desktop-build`, including the downloaded Electron, Node, pnpm, and Python payloads.
- An elevated PowerShell window, for the symlink reason above.

## Build

```powershell
node scripts/build.ts --scope artifacts
node node_modules\pnpm\bin\pnpm.cjs --filter @deepseek-ai/dsh-desktop exec tsx scripts/package-target.ts win-x64 --unsigned --dir
node node_modules\pnpm\bin\pnpm.cjs --filter @deepseek-ai/dsh-desktop exec tsx scripts/package-portable.ts --unpacked C:\path\to\apps\desktop\.desktop-build\targets\win-x64\unsigned-artifacts\win-unpacked
```

The first command builds the shared artifacts, the second produces the unsigned unpacked directory, and the third assembles the edition.

`package-portable.ts` runs inside `apps/desktop`, so `--unpacked` must be an absolute path. An unsigned build writes to `unsigned-artifacts`, not `artifacts`, and carries no `app-update.yml`, so the automatic update path is inactive in these builds.

Step three writes two artifacts under `apps/desktop/.desktop-build/targets/win-x64/portable`: `DeepSeek-Harness-<version>-portable\` for the drive and `deepseek-harness-<version>-win-x64-portable.zip` for the release.

The assembly copies the guide, both desktop READMEs, `AGENTS.md`, `LICENSE`, `NOTICE.md`, and `THIRD_PARTY_NOTICES.md` beside `portable.json` in the edition root. A missing file fails the assembly before the manifest is written, so a shipped archive always carries its licenses.

## Checksums

```powershell
$zip = 'apps\desktop\.desktop-build\targets\win-x64\portable\deepseek-harness-<version>-win-x64-portable.zip'
$hash = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
"$hash  $(Split-Path $zip -Leaf)" | Set-Content 'apps\desktop\.desktop-build\targets\win-x64\portable\SHA256SUMS.txt' -Encoding utf8NoBOM
```

Publish `SHA256SUMS.txt` next to the archive so downloaders can verify it.

## Release notes

The archive is the release; the notes state what it carries. Cover these facts in the notes you write:

- Scope: an unofficial Windows portable edition of DeepSeek Harness, unpacked onto a removable drive and started from `app\DeepSeek Harness.exe`. Everything it writes stays on that drive.
- Relocation: moving the drive to another letter rewrites the recorded paths on the next start.
- License: MIT, with `LICENSE` and `NOTICE.md` inside the archive.
- Signing: the archive is unsigned, so SmartScreen warns about an unknown publisher, and automatic updates stay inactive.
- Limits: third-party plugins that write into the user profile are outside the edition's control.
- Integrity: the archive is verified with `SHA256SUMS.txt`.

## Publishing

```powershell
gh release create v<version>-portable --title "DeepSeek Harness Portable <version>" --notes-file <notes>.md `
  apps\desktop\.desktop-build\targets\win-x64\portable\deepseek-harness-<version>-win-x64-portable.zip `
  apps\desktop\.desktop-build\targets\win-x64\portable\SHA256SUMS.txt
```

Publish the archive and the checksum file; do not attach intermediate build directories (`unsigned-artifacts`, `dsh`, `electron`, `runtime`, `packed`, `package-set`), `pnpm-store`, `packaging-runs`, or any file from `apps/desktop/.env.windows`. Those carry local paths or signing settings and are not distribution artifacts.
