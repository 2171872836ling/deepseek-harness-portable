# Portable edition user manual

English | [中文](desktop-portable-manual.zh.md)

This manual is for someone who has the portable archive and wants to use it. It covers putting the edition on a drive, starting it, finding what it writes, moving it to another machine or letter, updating it, backing it up, and what it cannot do. The engineering description of the same feature is the [portable guide](desktop-portable.md).

## 1. What you received

The archive `deepseek-harness-<version>-win-x64-portable.zip` holds one folder. Unzipped, it looks like this:

```
DeepSeek-Harness-<version>-portable\
  app\
    DeepSeek Harness.exe
    resources\
    ...
  data\
  cache\
  logs\
  updates\
  backup\
  portable.json
  README.md
  README.zh.md
  desktop-portable.md
  desktop-portable.zh.md
  desktop-portable-manual.md
  desktop-portable-manual.zh.md
  LICENSE
  NOTICE.md
  THIRD_PARTY_NOTICES.md
  AGENTS.md
```

The application is `app\DeepSeek Harness.exe`. Everything the application writes goes into `data\`, `cache\`, `logs\`, `updates\`, or `backup\`, all beside it. `portable.json` is the file that tells the application it is a portable edition; leaving it in place is what keeps your data on the drive.

Keep the `LICENSE`, `NOTICE.md`, and `THIRD_PARTY_NOTICES.md` files with the edition. The MIT license requires the first two to travel with any copy of the software.

## 2. Before you start

You need Windows on x64, about 4 GB of free space, and write access to the drive. The edition is unsigned, so Windows SmartScreen warns about an unknown publisher the first time you run it.

To start the application, unzip the archive onto the drive and double-click `app\DeepSeek Harness.exe`. A folder on a fixed disk works the same way as a folder on a USB drive; the portable behavior comes from `portable.json`, not from the drive type.

The first start takes longer than later ones because it creates the data directories. A progress window may appear while the application prepares its runtime.

### If SmartScreen blocks the start

Windows shows "Windows protected your PC" for any unsigned executable it has not seen before. Choose **More info**, then **Run anyway**. This is expected for unsigned builds: the check is about the missing signature, not about a detected problem.

### If the drive is write-protected

The application refuses to start when it cannot write beside itself, because falling back to your user profile would put your data on the host. Remove the write protection before starting.

## 3. First start

On the first start the edition:

1. creates `data\`, `cache\`, `logs\`, `updates\`, and `backup\` with their subdirectories;
2. copies an existing DeepSeek Harness installation from `%USERPROFILE%\.dsh\` into `data\`, and an existing desktop profile from `%APPDATA%\DeepSeek Harness\` into `data\user-data\`, when those exist and `data\` is still empty;
3. records the drive's root in `portable.json` under `rootHistory`.

The copy in step 2 leaves the original in place, so your installed copy keeps working. What it copied is listed in `logs\portable\migration-<timestamp>.log`, with a matching `.json` that records file and byte counts. A copy that does not match its measurement is moved to `backup\migration\<timestamp>\` instead of being presented as your data, and the next start tries again.

The migration happens once. Once `data\` holds data, later starts leave it alone.

## 4. Your first conversation

Start the application and the desktop shell opens. Choose a working folder when it asks: the edition suggests a folder on the drive, and you can pick any folder you can reach, including one on the host disk.

**A working folder on the host is not portable.** Sessions for that folder are stored in `data\` like every other session, but the files the agent reads and writes are on the host, and those do not travel with the drive. Use a folder on the drive when you want the whole conversation to be portable.

API credentials are entered once and stored in `data\.credentials.yaml`, which stays on the drive. Treat the drive like a password: anyone who has it has your credentials. There is no encryption beyond what the operating system provides.

## 5. What lives where

| Want to find | Look in |
| --- | --- |
| Sessions and their history | `data\sessions\` and `data\profiles\<profile>\sessions\` |
| Settings, world state, schedules | `data\storages\` |
| Installed plugins | `data\profiles\desktop\node_modules\` |
| Plugin operation history | `data\profiles\desktop\.plugin-manager\logs\` |
| Files the agent hands back to you | `data\downloads\` |
| Credentials | `data\.credentials.yaml` |
| Application logs | `logs\application\` |
| Portable diagnostics: manifest repairs, migrations, relocations | `logs\portable\` |
| Downloaded updates and staging | `updates\downloads\`, `updates\staging\` |
| Snapshots you can restore | `backup\snapshots\` |
| Previous application versions | `backup\versions\` |

Sizes worth knowing: `cache\` can grow to a few hundred megabytes with plugin caches and Chromium data, `data\` grows with your conversations, and `app\` is about 1 GB and only changes on an update.

The application warns in `logs\portable\portable.log` when less than 512 MiB remains on the drive. Sessions and plugin installs fail once the drive is full, so watch that log on a small drive.

## 6. Moving the drive to another computer

Stop the application, unplug the drive, and plug it into the other machine. Start the same way: `app\DeepSeek Harness.exe`.

Nothing needs reconfiguring on the new computer, because nothing is stored on the computer. The one exception is a conversation whose working folder was on the old computer's disk: that folder does not exist on the new machine, and the session reports it as missing.

## 7. When the drive letter changes

Windows assigns drive letters per machine and per plug-in order, so a drive that was `E:\` in one session can be `F:\` in the next. The edition handles that on its own.

On startup, before anything reads the stored paths, the edition compares the drive's current root with the roots recorded in `portable.json`. When they differ it:

1. takes a snapshot of `data\` into `backup\snapshots\`;
2. rewrites recorded paths in configuration files under `data\`, copying each changed file to `backup\relocation\<timestamp>\` first;
3. renames session folders and rewrites the working directory recorded inside each session header, so the sessions appear under the current drive letter.

The work is recorded in `logs\portable\relocation-<timestamp>.log`. Sessions whose working folder was on a host disk are not renamed: their path never mentioned the drive.

If a relocation is interrupted, the files it had already changed are under `backup\relocation\`, and the snapshot under `backup\snapshots\` holds the state before it began.

## 8. Backups

The edition keeps the newest three snapshots in `backup\snapshots\`. A snapshot is a full copy of the Harness home plus `portable.json`, with file and byte counts recorded so a damaged snapshot is detected before it is restored.

To take, list, and restore snapshots you need the repository checkout, because the snapshot tool ships with the source rather than with the archive:

```sh
pnpm --filter @deepseek-ai/dsh-desktop exec tsx src/portable/snapshot-cli.ts list E:\DSH
pnpm --filter @deepseek-ai/dsh-desktop exec tsx src/portable/snapshot-cli.ts create E:\DSH
pnpm --filter @deepseek-ai/dsh-desktop exec tsx src/portable/snapshot-cli.ts restore E:\DSH latest
```

Without a checkout, copy `data\` while the application is stopped. That is what a snapshot is, minus the verification.

## 9. Updates

**Automatic updates are inactive in unsigned builds**, and this archive is unsigned, so the application will not offer to update itself. To move to a newer release, download the new archive and replace `app\` with the new build's `app\` folder, keeping `portable.json`, `data\`, `cache\`, `logs\`, `updates\`, and `backup\` as they are. The manifest, your data, and your plugins survive because none of them live in `app\`.

Back up `data\` before replacing `app\`, so a build that turns out to be unusable does not cost you your sessions.

Signed builds from this project use the update path described in section 4 of the [portable guide](desktop-portable.md): download into `updates\downloads\`, stage into `updates\staging\`, replace `app\` while the application exits, and roll back on the next start if the swap did not complete.

## 10. Plugin limits

Plugins installed from the marketplace stay on the drive: their packages, dependencies, caches, and lockfiles all resolve under `data\` or `cache\`.

A plugin that builds its own path from the operating system can write outside the drive. The common case is a plugin that calls `os.homedir()` and appends `.dsh`: it writes into `%USERPROFILE%\.dsh\` on the host, because the edition redirects `DSH_HOME`, not `USERPROFILE`. The edition reports this in its documentation rather than preventing it, because redirecting the user profile would move unrelated programs with it.

If a plugin leaves files in your user profile, check the plugin's own settings for a data-directory option, or accept those files as a small exception to the portability promise.

## 11. Uninstalling

Stop the application and delete the folder. There is no uninstaller and nothing is left behind: the edition writes no registry keys, creates no shortcuts, registers no file associations, and adds nothing to `PATH`.

The only files outside the folder are those written by a third-party plugin through its own path, described in section 10.

## 12. When something goes wrong

**The application does not start and shows a message about `portable.json`.** The manifest is unreadable or was written by a newer release. A damaged manifest is moved to `backup\portable.json.corrupt-<timestamp>` and replaced with a default; when the message says the manifest is from a newer version, the archive is newer than the application you are running, so use the matching build.

**The application does not start and mentions a directory outside the volume.** A directory in `portable.json` is absolute, drive-relative, UNC, or climbs with `..`. Edit the manifest to a relative path, or delete it and let the application write a default one; your data under `data\` is untouched either way.

**The application does not start at all, with no message.** Start it from a terminal with `app\DeepSeek Harness.exe` so the console output is visible, and read `logs\portable\portable.log` and `logs\application\`.

**Conversations from the previous drive letter are missing.** Open `logs\portable\relocation-<timestamp>.log`. A session folder whose name does not match the working directory it records is skipped deliberately, and restoring a snapshot from `backup\snapshots\` brings the previous state back. Sessions whose working folder was on a host disk are not affected by a letter change and do not need relocation.

**A plugin install fails with a permission or space error.** Check free space first, then `logs\portable\portable.log` for the low-space warning. A drive that is full fails plugin installs long after it starts failing downloads.

**Data appears in `%USERPROFILE%\.dsh\` while the edition runs from the drive.** A third-party plugin wrote there through its own path; see section 10.
