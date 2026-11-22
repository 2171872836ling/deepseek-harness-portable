# AGENTS.md — Desktop

These rules supplement the repo-wide [conventions](../AGENTS.md#conventions) for `apps/desktop`. The [portable edition guide](../docs/user/guide/desktop-portable.md) documents the shipped behavior; this file records what a change must preserve.

## Portable edition

- **`main.ts` module evaluation is the redirect deadline.** `initializePortableDesktop` must run before the first `app.getPath` call, including the locale-cache read near the top of the module. Electron fixes `userData`, `logs`, and `temp` during evaluation, so an asynchronous or deferred bootstrap leaves the first write on the host disk. The bootstrap therefore stays synchronous; `existsSync` and `readFileSync` are correct there, and every port in `PortableAppPort` exists so the sequence can be tested without Electron.
- **Non-portable runs are the default.** A `portable.json` anywhere else must leave every path untouched. A change to the redirect needs a test that runs without the manifest and asserts no `setPath` and no environment edit happened.
- **Path derivation stays letter-free.** `layout.ts` re-derives every directory from `process.execPath` and the manifest, never from a stored absolute path, and `resolvePortableLayout` refuses a directory outside the root. A stored absolute path, a hard-coded drive, or a fallback to the user profile breaks the edition's only promise.
- **Content, not directory existence, decides whether state exists.** `bootstrap.ts` creates `data\`, `data\downloads`, and `data\user-data` before any user state exists, so a guard on the import counts only non-empty entries. The one-time import runs on the launch that performs it; a pre-created empty directory must never make that launch look used.
- **`portable.json` is never rewritten except to record a root.** The updater, the installer, and the migration leave the manifest alone. `recordPortableRoot` appends to `rootHistory` and nothing else; a change that writes the manifest on an ordinary launch needs a reason recorded in the commit.
- **Update transactions settle on the next start.** `apply.json` is written before the application exits, and `settlePortableUpdate` decides from the running version whether to archive, restore, or wait. A helper process replaces `app\` because the running application cannot rename the directory holding its own code; do not move that work into the main process.
- **Registry writes stay at zero.** Protocol registration, login items, shortcuts, the crash reporter, the `dsh` `PATH` entry, and installer records are refused in portable mode. A new Windows integration needs the same guard and a test that proves the refusal.
- **Report what the edition cannot control.** `portableEnvironment` rewrites `DSH_HOME`, `TEMP`/`TMP`, and the package-manager and Python caches. `USERPROFILE` stays untouched because the operating system and every child process read it, so a plugin that builds a path from `os.homedir()` writes to the host profile. Do not silence that by rewriting the profile variables; keep the documented limit and let the plugin's own settings move its data.
- **The pure modules stay pure.** `root.ts`, `config.ts`, `layout.ts`, `environment.ts`, `session-log.ts`, and `update.ts` parse, derive, and classify; they take filesystem and process ports as parameters. Only `store.ts`, `bootstrap.ts`, `migration.ts`, `relocation.ts`, `backup.ts`, `install.ts`, and `apply.ts` touch the disk, and each has an injected clock or filesystem where a test needs to observe it.

## Testing the edition

- Every module under `src/portable/` has a matching `tests/portable-<module>.spec.ts`. A change to a guard needs the case that fails without it, not only the case that passes with it.
- Use Windows-shaped paths in assertions (`E:\DSH\...`) even on macOS and Linux: `pathFlavor` makes the module compute Windows semantics, so a POSIX temporary directory would exercise the wrong branch.
- Filesystem tests use `mkdtemp` under `tmpdir()` and remove the tree with `onTestFinished`. Never point a spec at a real drive letter.
- `main-startup.spec.ts` covers the wiring: the bootstrap call site, the `setAppLogsPath` guard, the protocol-registration guard, and the settlement and import order in `main()`.

## Packaging

- `scripts/portable-assembly.ts` produces the distributable; `scripts/package-portable.ts` wraps it. `readUnpackedVersion` reads `resources\app\package.json` and falls back to the packaged manifest inside `resources\app.asar`, because the production build keeps it there.
- An unsigned build writes `win-unpacked` under `unsigned-artifacts\`, and `pnpm --filter ... exec` runs with `apps/desktop` as the working directory: `--unpacked` needs an absolute path.
- Changing `electron-builder-config.mjs` `files` or `extraResources` changes what the portable edition carries. Re-run the assembly and check that `portable.json`, `data\`, and `runtime\versions.json` still land where the bootstrap expects them.
