# NOTICE

This repository, `deepseek-harness-portable`, is an unofficial fork of DeepSeek Harness.

## Upstream

- Project: DeepSeek Harness (`dsh`)
- Source: https://github.com/deepseek-ai/deepseek-harness
- Copyright: Copyright (c) 2026 DeepSeek
- License: MIT (see [LICENSE](LICENSE))

The fork point is upstream version `0.2.2-rc.5`. The MIT license text and the
upstream copyright notice are reproduced unchanged in [LICENSE](LICENSE). Third-party component
licenses are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), which is generated from the
dependency graph and must not be edited by hand.

## Changes in this fork

The fork adds one feature on top of upstream: a Windows portable edition for removable drives.
Its source lives in `apps/desktop/src/portable/`, its packaging scripts in `apps/desktop/scripts/`
(`portable-assembly.ts`, `package-portable.ts`, `portable-install.ts`, `portable-backup.ts`), and its
user guide in `docs/user/guide/desktop-portable.md`. The edition redirects the Electron paths,
`DSH_HOME`, and the package-manager and interpreter caches onto the drive that holds the application,
records that association in a `portable.json` manifest, and performs no Windows registry writes.

Everything else in this repository is upstream work. No upstream source file was renamed, and no
package name, publisher name, application identifier in the upstream tree, or upstream documentation
page was changed to present this fork as the upstream project.

## Trademarks and attribution

"DeepSeek", "DeepSeek Harness", and related marks belong to DeepSeek. They are used here
descriptively, to state what this fork is derived from. This fork is not published, endorsed,
sponsored, or supported by DeepSeek. Builds produced from this repository are unsigned and are not
official releases of the upstream project.

## No warranty

This software is provided under the MIT license, without warranty of any kind. The fork inherits
that disclaimer: anyone using a build from this repository does so at their own risk.
