/**
 * Replacement of the portable application directory by a downloaded update.
 * The running Electron process cannot rename its own application directory, so
 * an update is handed to a detached Node process that waits for the shell to
 * exit, installs the payload into `updates\staging`, and swaps the two
 * directories. The transaction record written before that process starts is what
 * lets the next launch decide between archiving the previous version and
 * restoring it after an interrupted update.
 * @module
 */

import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { pathFlavor } from './paths.ts'
import { joinPortable } from './layout.ts'
import { PortableUpdateError } from './update.ts'
import {
  PortableLayoutError,
  portableDiagnosticLogs,
  portableUpdateBackup,
  portableUpdateStaging,
  type PortableLayout,
} from './layout.ts'
import { writePortableUpdateRecord, type PortableUpdateRecord } from './update.ts'

/** Command that installs the update payload into the staging directory. */
export interface PortableInstallerPlan {
  /** Executable to run. */
  readonly command: string
  /** Arguments, including the staged installation directory. */
  readonly args: readonly string[]
}

/** Starts a detached helper process. */
export type PortableApplySpawn = (command: string, args: readonly string[], environment: Readonly<Record<string, string>>) => void

/**
 * Build the silent install invocation for a downloaded installer.
 * electron-builder's NSIS installer accepts `/S` for silent mode and requires
 * `/D=` to be the final, unquoted argument.
 * @param installerPath - Downloaded installer executable.
 * @param stagingDirectory - Absolute directory the payload installs into.
 * @returns Command and arguments.
 */
export function portableInstallerPlan(installerPath: string, stagingDirectory: string): PortableInstallerPlan {
  return { command: installerPath, args: ['/S', `/D=${stagingDirectory}`] }
}

/**
 * Absolute path of the update helper process.
 * @param layout - Absolute portable layout.
 * @param stamp - Timestamp used in the file name.
 * @returns Absolute script path.
 */
export function portableApplyScriptPath(layout: PortableLayout, stamp: string): string {
  return joinPortable(layout.updates, `apply-${stamp}.cjs`)
}

/**
 * Source of the detached helper process.
 * It runs under `ELECTRON_RUN_AS_NODE`, so it may only use Node built-ins: the
 * application directory it replaces is the one that would otherwise supply them.
 * Arguments: `root`, `installerPath`, `staging`, `backup`, `app`, `relaunch`, `log`.
 * @returns CommonJS source text.
 */
export function portableApplyScript(): string {
  return `'use strict'
const { spawn, spawnSync } = require('node:child_process')
const { appendFileSync, existsSync, renameSync, rmSync } = require('node:fs')

const [root, installer, staging, backup, app, relaunch, log] = process.argv.slice(2)
const write = (line) => {
  try { appendFileSync(log, line + '\\n') } catch (error) { console.error(error) }
}
const waitForExit = (pid, timeoutMs) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try { process.kill(pid, 0) } catch (error) {
      if (error.code === 'ESRCH') return true
      return false
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250)
  }
  return false
}

const parent = Number(process.env.DSH_PORTABLE_APPLY_PARENT ?? '0')
write(\`apply: waiting for \${parent} to exit (\${root})\`)
if (parent > 0 && !waitForExit(parent, 180000)) {
  write('apply: the application did not exit in time; nothing was replaced')
  process.exitCode = 2
} else if (!existsSync(installer)) {
  write(\`apply: installer is missing: \${installer}\`)
  process.exitCode = 3
} else {
  rmSync(staging, { recursive: true, force: true })
  const install = spawnSync(installer, ['/S', \`/D=\${staging}\`], { stdio: 'ignore' })
  if (install.status !== 0 || !existsSync(staging)) {
    write(\`apply: install failed (status \${install.status}); the record stays for recovery\`)
    process.exitCode = 4
  } else {
    try {
      rmSync(backup, { recursive: true, force: true })
      renameSync(app, backup)
      renameSync(staging, app)
      write('apply: replaced the application directory')
      spawn(relaunch, [], { detached: true, stdio: 'ignore' }).unref()
    } catch (error) {
      write(\`apply: replacement failed: \${error && error.message ? error.message : error}\`)
      process.exitCode = 5
    }
  }
}
`
}

/**
 * Express a directory as a path relative to the portable root.
 * The update record stores relative paths so a changed drive letter stays valid.
 * @param layout - Absolute portable layout.
 * @param directory - Absolute directory inside the root.
 * @returns The relative path recorded in the update transaction.
 */
export function relativeToPortableRoot(layout: PortableLayout, directory: string): string {
  const flavor = pathFlavor(layout.root)
  const relative = flavor.relative(layout.root, directory)
  if (relative === '' || relative.startsWith('..') || flavor.isAbsolute(relative)) {
    throw new PortableLayoutError('update record', directory, layout.root)
  }
  return relative
}

/**
 * Locate the installer `electron-updater` downloaded for a version.
 * Only the newest match is used, so a leftover of an earlier attempt cannot be
 * installed by mistake.
 * @param downloadsDirectory - Portable download cache.
 * @param version - Version the installer must carry.
 * @returns Absolute installer path.
 */
export async function findPortableInstaller(downloadsDirectory: string, version: string): Promise<string> {
  let entries: string[]
  try {
    entries = (await readdir(downloadsDirectory, { withFileTypes: true }))
      .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.exe') && entry.name.includes(`-${version}-`))
      .map(entry => entry.name)
      .sort()
  } catch (error) {
    throw new PortableUpdateError(`portable update: cannot read ${downloadsDirectory}`, 'PORTABLE_UPDATE_INSTALLER_MISSING', error)
  }
  const found = entries.at(-1)
  if (found === undefined) {
    throw new PortableUpdateError(
      `portable update: no installer for ${version} in ${downloadsDirectory}`,
      'PORTABLE_UPDATE_INSTALLER_MISSING',
    )
  }
  return joinPortable(downloadsDirectory, found)
}

/**
 * Write the transaction record and start the detached replacement process.
 * The record is written first: a crash before the helper starts still leaves the
 * launch-time recovery path in charge.
 * @param options - Layout, versions, installer, and process launcher.
 * @returns The written record.
 */
export async function schedulePortableUpdate(options: {
  readonly layout: PortableLayout
  readonly fromVersion: string
  readonly toVersion: string
  readonly installerPath: string
  readonly relaunchExecutable: string
  readonly helperExecutable: string
  readonly spawn: PortableApplySpawn
  readonly now?: () => Date
}): Promise<PortableUpdateRecord> {
  const stamp = (options.now ?? (() => new Date()))().toISOString().replace(/[:.]/gu, '-')
  const staging = portableUpdateStaging(options.layout)
  const backup = portableUpdateBackup(options.layout)
  const script = portableApplyScriptPath(options.layout, stamp)
  const log = joinPortable(portableDiagnosticLogs(options.layout), `update-${stamp}.log`)
  const record = await writePortableUpdateRecord({
    layout: options.layout,
    fromVersion: options.fromVersion,
    toVersion: options.toVersion,
    stagedApp: relativeToPortableRoot(options.layout, staging),
    backupApp: relativeToPortableRoot(options.layout, backup),
    ...(options.now === undefined ? {} : { now: options.now }),
  })
  await writeFile(script, portableApplyScript(), { encoding: 'utf8', mode: 0o600 })
  await mkdir(portableDiagnosticLogs(options.layout), { recursive: true })
  options.spawn(
    options.helperExecutable,
    [script, options.layout.root, options.installerPath, staging, backup, options.layout.app, options.relaunchExecutable, log],
    { ELECTRON_RUN_AS_NODE: '1', DSH_PORTABLE_APPLY_PARENT: String(process.pid) },
  )
  return record
}
