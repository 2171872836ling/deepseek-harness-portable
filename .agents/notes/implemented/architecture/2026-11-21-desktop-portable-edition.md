# Agent Note: Desktop portable edition

Status: implemented

English | [中文](2026-11-21-desktop-portable-edition.zh.md)

## Problem

The desktop shell assumed the fixed locations Electron and DSH resolve on their own: `userData` and `sessionData` under `%APPDATA%`, logs and crash dumps under the platform default, the Harness home at `~/.dsh`, and package-manager caches wherever the package managers put them. A drive-letter-bound installation, registry entries, or symlinked directories that hide profile writes satisfy the specification's "portable" wording only on the machine where they were created. Users who carry DSH on removable media need every write — sessions, credentials, plugins, caches, logs, updates — to land beside the executable, and no write to the host at all.

## Decision

A portable edition is a normal Electron package plus a `portable.json` manifest at the portable root. The marker, not a build flag, selects the mode, so one artifact behaves as a portable edition on removable media and as an ordinary installation when the manifest is absent.

`apps/desktop/src/portable/` owns the mode and runs from `main.ts` module scope, before the first `app.getPath('userData')` call:

- `root.ts` finds the root from `process.execPath` (the executable's directory, then its parent, which covers the `app\` staging layout) or from `DSH_PORTABLE_ROOT`.
- `config.ts` parses the manifest: `pathVersion` 1, relative directories, `portableMode`, optional `updateFeed`.
- `layout.ts` resolves each directory and rejects any path that escapes the root, so a hostile or corrupted manifest cannot redirect writes to the host.
- `bootstrap.ts` creates the layout, applies the environment, and repoints `userData`, `sessionData`, `logs`, `crashDumps`, and `temp`, plus the Chromium disk cache switch.
- `environment.ts` maps caches (`npm_config_cache`, `pnpm_config_store_dir`, `PYTHONPYCACHEPREFIX`, `PIP_CACHE_DIR`, `UV_CACHE_DIR`) and `DSH_HOME` onto the volume. Cache variables use their conventional names rather than `DSH_` names because plugin installs run pnpm with `scrubbedParentEnv()`, which drops every `DSH_`-prefixed variable.

Portable mode also withholds the writes Electron performs implicitly: the app does not call `app.setAppLogsPath()` or `app.setAsDefaultProtocolClient()`, because both resolve to host-profile or registry state, and command management offers the drive folder instead of writing a `dsh` entry under `HKCU\Environment`.

Updates stay on the volume. `updater.ts` builds an `NsisUpdater` with a custom `AppAdapter` whose `baseCachePath` is `updates\downloads`. Applying an update cannot rename the running application directory, so `apply.ts` schedules a detached Node helper (`ELECTRON_RUN_AS_NODE=1`) that waits for the shell to exit, installs into `updates\staging`, swaps directories, and relaunches; `update.ts` records the attempt in `updates\apply.json` and `settlePortableUpdate()` decides on the next start whether the swap completed or must be rolled back.

The volume carries its own record of where it has run. `relocation.ts` keeps the last five roots in the manifest's `rootHistory` and, at startup before anything reads the home, replaces every recorded root in text configuration files and rewrites session headers together with their directories, because a session directory name derives from the working directory the header records. `session-log.ts` decompresses and recompresses only the header frame, so session events stay byte-identical.

Two operations run outside the shell. `backup.ts` copies the whole home into `backup\snapshots\`, verifying file and byte counts on both sides and restoring with a rename-based rollback, and `snapshot-cli.ts` exposes list, create, and restore. `install.ts` replaces a system installer with a preflight — volume kind, free space, non-empty target, payload containment — followed by a verified copy that writes the manifest last, so an interrupted install leaves a folder the next start reports as incomplete rather than a half-installed edition. Startup also reports a nearly full volume and redirects downloads into `data\downloads`, since both would otherwise surface as unexplained write failures or host-profile artifacts.

## Alternatives considered

**An outer launcher that sets environment variables and starts the installed application.** Rejected: the launcher cannot repoint Electron's `userData`, `sessionData`, log, crash-dump, and temp directories, and those are where Electron writes first. It also leaves the updater's cache and the default-protocol registration in the host profile, so the guarantee would depend on never using those features.

**A dedicated portable installer built on NSIS.** Rejected: NSIS installers write `HKLM`/`HKCU` uninstall entries. "Unzip the archive" satisfies both the no-registry rule and the copy-anywhere rule with no installer to maintain.

**Moving the update into the running process.** Rejected: Windows cannot rename a directory that contains the running executable, and the `app` directory holds the very code that would perform the rename.

**Rewriting absolute paths stored in sessions and settings to relative ones.** Rejected: it would change released session files and every reader. The volume-local `DSH_HOME` already makes stored paths meaningful, and the manifest's relative directories keep the drive letter out of configuration.

## Consequences

One code path serves both modes, and the non-portable path is unchanged when no manifest is present, which keeps the existing 200-plus desktop specs meaningful. A user who removes the marker gets a nested profile layout where sessions created on the volume are not visible; that is the deliberate cost of a mode switch rather than a migration.

Rollback is limited to the previous application directory: sessions and plugin data live outside `app\`, so an update failure never touches them, but `backup\versions\` retains only the last three applications.

`pathVersion` is a hard stop. A manifest written by a newer build refuses to start rather than guessing at directory semantics, so a downgrade requires editing the manifest by hand.

The portable edition is Windows-only in this change: the layout code is pure path arithmetic with a Windows flavor, but packaging, the update swap, and the detached helper are Windows behaviors.
