# DeepSeek Harness Portable

English | [中文](README.zh.md)

**Unofficial build.** `deepseek-harness-portable` is a fork of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) that adds a Windows portable edition. It is not published, endorsed, or supported by DeepSeek. The upstream project is MIT licensed; see [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md).

DeepSeek Harness (`dsh`) is an open-source agent harness developed by [DeepSeek AI](https://deepseek.com). This fork makes it run from a USB drive: unzip, double-click, and everything the agent writes stays on that drive.

## What this fork adds

Upstream DeepSeek Harness keeps its state in `%USERPROFILE%\.dsh`, the Electron profile in `%APPDATA%`, and caches in `%TEMP%`, the npm and pnpm stores, and the Python cache directories. That is the right design for an installed application and the wrong one for a drive you carry between machines.

The portable edition puts all of it on the drive that holds the application:

| What | Where the portable edition keeps it |
|---|---|
| Harness home: profiles, sessions, storages, worlds, attachments, plugins | `data\` |
| Electron profile: Chromium cache, cookies, local state | `data\user-data\` |
| Files the agent hands back to you | `data\downloads\` |
| Electron disk cache, crash dumps, temporary files | `cache\electron\`, `cache\temporary\` |
| npm, pnpm, pip, uv, and Python bytecode caches | `cache\npm\`, `cache\pnpm-store\`, `cache\python\` |
| Application logs and portable diagnostics | `logs\application\`, `logs\portable\` |
| Update downloads, staging, and the apply transaction | `updates\` |
| Version backups, snapshots, quarantined manifests | `backup\` |

Nothing is written to the registry, so the drive leaves no trace behind on a borrowed machine. Uninstalling is deleting the directory.

## How it works

The edition is a set of modules under [`apps/desktop/src/portable/`](apps/desktop/src/portable/), started from [`main.ts`](apps/desktop/src/main.ts) before the first Electron path lookup:

1. **Find the root.** `root.ts` looks for `portable.json` beside the executable, then one directory above it, and honours `DSH_PORTABLE_ROOT` when set. The drive letter comes from `process.execPath`, so `E:`, `F:`, or `G:` all work without configuration.
2. **Read and validate the manifest.** `config.ts` and `store.ts` parse `portable.json`, accepting only relative directories that stay inside the root. A corrupt manifest is quarantined under `backup\` and rebuilt; a manifest written by a newer version stops the launch instead of guessing.
3. **Redirect every path.** `bootstrap.ts` calls `app.setPath` for `userData`, `sessionData`, `logs`, `crashDumps`, `temp`, and `downloads`, adds the `disk-cache-dir` switch, and exports `DSH_HOME`, `TEMP`, `TMP`, the npm and pnpm cache and store variables, and `PYTHONPYCACHEPREFIX`, `PIP_CACHE_DIR`, `UV_CACHE_DIR`. Plugin installs inherit those variables through the child-process environment, so a marketplace install lands on the drive too.
4. **Import earlier data.** `migration.ts` copies an existing `~\.dsh` and desktop profile on first start, records what the source held, verifies the copy file-for-file, and moves an unverified copy aside rather than presenting half of it as your data.
5. **Follow the drive.** `relocation.ts` keeps the roots this edition has lived at in the manifest. When the drive gets a new letter, it rewrites recorded paths in configuration files and session headers and renames the session directories derived from them, backing up every file it changes first.
6. **Update without an installer.** `update.ts`, `updater.ts`, and `apply.ts` download into `updates\downloads\`, stage into `updates\staging\`, record the transaction in `updates\apply.json`, and let a detached Node helper finish the swap after the shell exits. The next start settles the record: a completed swap moves the old build into `backup\versions\`, an interrupted one restores it.
7. **Back up and restore.** `backup.ts` snapshots the home directory and the manifest into `backup\snapshots\`, verified against a file-and-byte manifest, with `snapshot-cli.ts` to list, create, and restore from the command line.

The edition refuses the writes an installer would normally make: no protocol registration, no `PATH` edit for the `dsh` command, no crash reporter that talks to Windows Error Reporting, and no shortcut or file association.

## Build the portable edition

```powershell
node scripts/build.ts --scope artifacts
node node_modules\pnpm\bin\pnpm.cjs --filter @deepseek-ai/dsh-desktop exec tsx scripts/package-target.ts win-x64 --unsigned --dir
node node_modules\pnpm\bin\pnpm.cjs --filter @deepseek-ai/dsh-desktop exec tsx scripts/package-portable.ts --unpacked C:\path\to\apps\desktop\.desktop-build\targets\win-x64\unsigned-artifacts\win-unpacked
```

The third command writes `DeepSeek-Harness-<version>-portable\` and its archive under `apps/desktop/.desktop-build/targets/win-x64/portable`. Packaging needs an elevated shell or Developer Mode, because pnpm creates a store symlink. The full prerequisites, checksums, and release steps are in the [release checklist](docs/release/portable-release-checklist.md).

## Use it

Unzip the archive onto the drive and run `app\DeepSeek Harness.exe`. The first start creates the directories in the table above and imports an existing `~\.dsh` when it finds one. [The portable guide](docs/user/guide/desktop-portable.md) covers the manifest fields, the relocation rules, update transactions, backups, and the limits of the edition.

## Upstream project

DeepSeek Harness is built on an **everything-is-a-plugin** architecture and powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://arxiv.org/abs/2608.25512). Upstream documentation lives at [https://deepseek-harness.github.io/deepseek-harness/](https://deepseek-harness.github.io/deepseek-harness/).

Upstream is in _developer preview_ and iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.** Review the [safety notice](SAFETY.md) before running the project.

### Run upstream from `npm`

<a id="run"></a>

Install `Node.js`, then run:

```sh
npx @deepseek-ai/dsh web
```

The command starts the Web UI at `http://127.0.0.1:3080` by default and opens it in the default browser for a local launch. An SSH launch only prints the host URL because the SSH client or editor owns the local forwarded address. Pass `--no-open` to run the server without opening a browser. See [Web UI guide](docs/user/guide/index.md).

### Run this checkout from source

<a id="run-from-source"></a>

```sh
git clone https://github.com/2171872836ling/deepseek-harness-portable.git
cd deepseek-harness-portable
pnpm install
pnpm run build
pnpm dsh web
```

`pnpm run build` prepares the repository artifacts. `pnpm dsh web` uses those built artifacts without rebuilding.

## Community and support

- Upstream feedback and bug reports go to the [DeepSeek Harness Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions).
- Portable edition issues belong in this repository's [issues](https://github.com/2171872836ling/deepseek-harness-portable/issues).
- Add the [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic to your plugin repository for discoverability.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). For the portable edition specifically, [`apps/desktop/AGENTS.md`](apps/desktop/AGENTS.md) records the rules its modules follow: redirect before the first path lookup, derive paths from the executable, treat content rather than directory existence as state, and keep the pure modules pure.

## Development

Start with the [development guide](docs/development.md) and [architecture documentation](docs/architecture.md).

`pnpm run dev:web` builds, serves, and rebuilds client bundles on source edits in one terminal, and `make help` lists the matching Make targets for Web and Desktop; the guide's application commands section owns the full table.

For agents, follow [AGENTS.md](AGENTS.md).

## Citation

```bibtex
@misc{deepseek-harness2026,
  title={DeepSeek Harness: Everything is a Plugin},
  author={DeepSeek-AI},
  year={2026},
  publisher={GitHub},
  howpublished={\url{https://github.com/deepseek-ai/deepseek-harness}},
}
```

## License

[MIT](LICENSE)

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
