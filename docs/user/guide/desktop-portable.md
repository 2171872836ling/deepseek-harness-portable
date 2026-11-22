# Portable edition (Windows)

English | [中文](desktop-portable.zh.md)

The portable edition runs DeepSeek Harness from a removable drive and keeps everything it writes on that drive. Sessions, credentials, plugins, caches, logs, and updates all live beside the application, so moving the drive to another computer or letter changes nothing but the drive letter itself.

## 1. What the portable edition is

An unpacked portable edition looks like this. The `portable.json` manifest in section 2 is what turns the folder into a portable edition; without it the application behaves like a normal installation and writes to your user profile.

```
DeepSeek-Harness-<version>-portable\
  DSH.exe
  portable.json
  data\
  cache\
  logs\
  updates\
  backup\
```

`DSH.exe` is the application, and the folder that holds it plays the role of `app\` in the manifest layout. `data\` is the Harness home (`DSH_HOME`); `cache\` holds caches that do not belong to it; `logs\` receives application logs and portable diagnostics; `updates\` holds downloaded updates, staging, and the pending-update record; `backup\` keeps configuration backups, previous application versions, volume snapshots, and quarantined files.

Directories the specification sketches separately — plugin downloads, plugin data, conversations, diary, archives — are owned by the Harness home instead of the portable root: they live under `data\` through the ordinary `DSH_HOME` rules. The table below maps the sketch to the actual paths.

| Sketch directory | Actual location |
| --- | --- |
| `data\config`, `data\conversations`, `data\worlds`, `data\diary`, `data\archive` | `data\<category>\` following the Harness home layout |
| `data\profiles` | `data\profiles\` (plugin profiles; the desktop profile is `data\profiles\desktop`) |
| `data\user-data` | `data\user-data\` (Electron `userData`) |
| `plugins\downloads`, `plugins\installed`, `plugins\dependencies`, `plugins\registry` | `data\profiles\desktop\` through pnpm |
| `plugins\cache`, `plugins\temporary` | `cache\` (`cache\npm`, `cache\pnpm-store`, `cache\temporary`) |
| `logs\application`, `logs\plugins`, `logs\updater`, `logs\errors` | `logs\application\` and `logs\portable\` |
| `updates\downloads`, `updates\staging`, `updates\packages` | `updates\downloads\`, `updates\staging\` |
| `backup\config`, `backup\database`, `backup\plugins`, `backup\versions` | `backup\snapshots\`, `backup\versions\`, and `backup\relocation\` |
| `cache\application`, `cache\node`, `cache\electron`, `cache\http` | `cache\`, `cache\electron\`, `cache\electron\http\` |
| `cache\temporary` | `cache\temporary\` |

## 2. The `portable.json` manifest

`portable.json` sits at the portable root. Only relative directories are stored, so the drive letter never appears in the file. `pathVersion` records the layout revision; a manifest written by a newer revision stops startup with an explicit message instead of guessing.

```json
{
  "portableMode": true,
  "pathVersion": 1,
  "dataDirectory": "data",
  "cacheDirectory": "cache",
  "tempDirectory": "cache/temporary",
  "logDirectory": "logs",
  "updateDirectory": "updates",
  "backupDirectory": "backup"
}
```

Startup resolves the portable root from the running executable: it looks for `portable.json` beside `DSH.exe` and one directory above it, so both `Root\DSH.exe` and `Root\app\DSH.exe` work. `DSH_PORTABLE_ROOT` overrides the search for testing.

A directory that is absolute, drive-relative, UNC, or climbs with `..` is refused. The start fails; it never falls back to the user profile.

A manifest that cannot be parsed is moved to `backup\portable.json.corrupt-<timestamp>`, a default manifest is written, and the event is recorded in `logs\portable\portable.log`. Turn portable mode off by setting `"portableMode": false`; the application then uses the ordinary per-user layout and reads nothing from the drive.

The application also appends the roots it has run from to `rootHistory`, keeping the last five. Section 5 uses that record to find stale paths after the drive letter changes.

## 3. What moves onto the drive

With a manifest present, startup redirects these before Electron or the Harness processes create them. Nothing here depends on the drive letter, so a new letter needs no edit.

| Data | Location on the drive |
| --- | --- |
| Harness home (`DSH_HOME`) | `data\` |
| Electron `userData`, `sessionData` | `data\user-data\` |
| Electron logs | `logs\application\` |
| Crash dumps | `cache\electron\crash-dumps\` |
| Electron and Chromium HTTP cache | `cache\electron\http\` |
| Files saved from the desktop shell | `data\downloads\` |
| `TEMP`, `TMP` | `cache\temporary\` |
| npm and pnpm caches and stores | `cache\npm\`, `cache\pnpm-store\` (plugin installs inherit them) |
| Python, pip, and uv caches | `cache\python\` |

Startup reads the drive's free space and warns in `logs\portable\portable.log` when less than 512 MiB remains. A full drive is reported early because sessions and plugin installs fail long after the operator could still make room; the warning never blocks the launch.

Portable mode also stops the writes that Windows only accepts in a user profile: no file-association registration, no default-protocol registration, no login item, no `PATH` entry for the `dsh` command, no uninstall registry entry, and no crash reporter. Uninstalling the portable edition is deleting the folder. Add the drive's `runtime\cli\bin` folder to `PATH` yourself if you want the command on the host.

### Plugin files the edition cannot redirect

Plugins installed through the marketplace are redirected: the plugin manager resolves their packages inside `data\profiles\desktop\`, and pnpm reads `npm_config_cache` and `pnpm_config_store_dir`, so their downloads, dependencies, lockfiles, and `node_modules` trees stay on the drive.

A plugin that composes its own path from the operating system, though, writes wherever that path points. A plugin calling `os.homedir()` with a literal `.dsh` segment receives the host's user profile, because the environment variable the portable edition rewrites is `DSH_HOME`, not `USERPROFILE`. Files like `%USERPROFILE%\.dsh\<plugin-state>` therefore appear on the host disk while the edition runs from the drive.

The redirect cannot prevent this. `USERPROFILE`, `HOMEDRIVE`, and `HOMEPATH` are read by the operating system and by every process the edition starts, so pointing them at the drive would move unrelated tools and programs along with them, and a plugin that resolves the profile through a Windows API rather than an environment variable ignores them anyway. The edition therefore reports the behavior instead of hiding it: check the plugin's own settings for a data-directory option, or accept the file in the user profile.

## 4. Updates

The portable updater downloads into `updates\downloads\` and installs into `updates\staging\`. Installing an update writes `updates\apply.json` before the application exits; a helper process then replaces `app\` with the staged build and relaunches. The next start settles the transaction:

- the running version matches the record's `toVersion`: the previous application is archived to `backup\versions\version-<fromVersion>\` and the newest three archives are kept;
- the running version matches `fromVersion` and `app\` is missing: the archived application is restored;
- anything else: the record stays for the next start, and `logs\portable\` explains why.

`portable.json` is never rewritten by an update, and the update never touches `data\`, `cache\`, `logs\`, or `backup\`.

## 5. Migrating an existing installation

The first portable start copies an existing per-user installation when `data\` has no Harness data yet:

1. `%USERPROFILE%\.dsh\` becomes `data\`;
2. `%APPDATA%\DeepSeek Harness\` becomes `data\user-data\`.

Copies are additive: the source stays in place, so the old installation keeps working. Each copy is measured before and after the transfer; a mismatch moves the incomplete destination to `backup\migration\<timestamp>\` so the next start does not treat a half copy as the user's data. Each run records what it copied in `logs\portable\migration-<timestamp>.log` and in `logs\portable\migration-<timestamp>.json`. When `data\` already holds data the migration is skipped; deleting `data\` before the first start migrates again.

### Relocating recorded paths

A drive letter change leaves recorded paths stale: the desktop profile's working directory and every session header that names it still carry the previous letter. Before anything else reads them, startup takes a snapshot of `data\` and rewrites those records:

1. text configuration files under `data\` (`.json`, `.jsonc`, `.yaml`, `.yml`, `.toml`, `.ini`, `.cfg`, `.conf`, `.txt` up to 2 MiB) have every recorded root replaced with the current one; each changed file is copied to `backup\relocation\<timestamp>\` first;
2. session groups under `data\profiles\<profile>\sessions\` are renamed so the directory name matches the new working directory, and the header line inside each session file is rewritten. Session events are untouched: only the first compressed frame, which holds the header, is re-compressed. A group is skipped when its directory name does not match the working directory it records, or when the new name is already taken.

Relocations are recorded in `logs\portable\relocation-<timestamp>.log`. Nothing here depends on the letter itself, so the same work happens on any drive the folder is moved to.

## 6. Backups and restore

`backup\snapshots\` holds whole copies of the Harness home. Startup takes one before it relocates recorded paths, and you can take or restore one at any time:

```sh
pnpm --filter @deepseek-ai/dsh-desktop exec tsx src/portable/snapshot-cli.ts list E:\DSH
pnpm --filter @deepseek-ai/dsh-desktop exec tsx src/portable/snapshot-cli.ts create E:\DSH
pnpm --filter @deepseek-ai/dsh-desktop exec tsx src/portable/snapshot-cli.ts restore E:\DSH latest
```

Each snapshot records the file count and byte count it holds. `restore` verifies the snapshot before touching the drive, moves the current home to `backup\restore\<timestamp>\`, copies the snapshot into place, and verifies the copy; any mismatch puts the previous home back. The newest three snapshots are kept. `scripts/portable-backup.ts` wraps the same commands for a shell outside the workspace; it takes the portable root first and the subcommand second:

```sh
node --import tsx/esm apps/desktop/scripts/portable-backup.ts E:\DSH list
```

## 7. Installing onto a removable drive

`scripts/portable-install.ts` copies an assembled payload onto a drive, checking the target before it writes anything:

```sh
pnpm --filter @deepseek-ai/dsh-desktop exec tsx scripts/portable-install.ts --payload dist/win-unpacked
```

Without `--target` the wrapper lists the volumes Windows reports, marks each as removable, fixed, or network, and suggests `<removable>\DSH`. `--yes` accepts the suggestion without a prompt; `--feed <url>` records an update feed in the written manifest. The preflight refuses a fixed drive, a target that already holds files, a target inside the payload, and a drive with less than the payload size plus 512 MiB free. The manifest is written last, so an interrupted copy leaves a folder that the next launch reports as incomplete rather than a half-installed edition.

There is no MSI or NSIS wizard: both register an uninstall entry, an install location, and protocol handlers that a portable edition must never write.

## 8. Building a portable edition

Build the Windows payload first, then assemble it:

```sh
pnpm --filter @deepseek-ai/dsh-desktop run package:win:x64:dir
pnpm --filter @deepseek-ai/dsh-desktop run package:win:x64:portable
```

`package:win:x64:portable` reads `win-unpacked` from the target's artifact directory, copies it to `app\`, writes the default `portable.json`, creates the empty data directories, and archives the result as `deepseek-harness-<version>-win-x64-portable.zip` under `.desktop-build\targets\win-x64\portable\`. Pass `--feed <url>` to record an update feed in the manifest.

The edition also carries this guide, both desktop READMEs, and `apps/desktop/AGENTS.md` at its root, beside `portable.json`. Pass `--documents <path,...>` to ship a different set, resolved against the repository root, or an empty value to ship none. An assembly fails rather than ship a partial set.

An unsigned build writes its payload to `unsigned-artifacts\win-unpacked` instead of `artifacts\win-unpacked`, so assemble from that directory explicitly. `pnpm --filter ... exec` runs in `apps\desktop`, which means the path must be absolute:

```sh
pnpm --filter @deepseek-ai/dsh-desktop exec tsx scripts/package-portable.ts --unpacked C:\path\to\.desktop-build\targets\win-x64\unsigned-artifacts\win-unpacked
```
