/**
 * Update transaction for the portable application directory.
 * The NSIS install renames and replaces files while the process is exiting, so
 * the only durable evidence of "an update was in flight" is a record written
 * before the application quits. On the next launch the record decides between
 * archiving the previous version, restoring it because the replacement never
 * landed, and reporting an inconclusive outcome that needs a manual reinstall.
 * @module
 */

import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { joinPortable } from './layout.ts'
import { z } from 'zod'
import { HarnessError } from '@deepseek-ai/dsh-error'
import { isInside, portableVersionBackups, portableUpdateRecord, type PortableLayout } from './layout.ts'

/** How many previous application versions are kept. */
export const PORTABLE_VERSION_BACKUPS_RETAINED = 3

/** Layout revision of the update record. */
export const PORTABLE_UPDATE_RECORD_VERSION = 1

const recordSchema = z.looseObject({
  recordVersion: z.number().int(),
  fromVersion: z.string().min(1),
  toVersion: z.string().min(1),
  startedAt: z.string().min(1),
  stagedApp: z.string().min(1),
  backupApp: z.string().min(1),
})

/** Durable record of an update that was applied between two launches. */
export interface PortableUpdateRecord {
  /** Record revision. */
  readonly recordVersion: number
  /** Version installed before the update. */
  readonly fromVersion: string
  /** Version the update installs. */
  readonly toVersion: string
  /** ISO timestamp the record was written. */
  readonly startedAt: string
  /** Staged application directory, relative to the portable root. */
  readonly stagedApp: string
  /** Copy of the replaced application directory, relative to the portable root. */
  readonly backupApp: string
}

/** Outcome of inspecting a pending record against the running version. */
export type PortableUpdateOutcome =
  | { readonly kind: 'none' }
  | { readonly kind: 'inconclusive'; readonly record: PortableUpdateRecord; readonly reason: string }
  | { readonly kind: 'installed'; readonly record: PortableUpdateRecord; readonly previousVersion: string }
  | { readonly kind: 'rolled-back'; readonly record: PortableUpdateRecord }

/** An update record that cannot be interpreted. */
export class PortableUpdateError extends HarnessError {
  /**
   * @param message - Actionable description naming the record.
   * @param code - Stable failure class.
   * @param cause - Underlying filesystem failure.
   */
  constructor(message: string, code: string, cause?: unknown) {
    super(message, code, cause === undefined ? undefined : { cause })
  }
}

/**
 * Read the pending update record.
 * @param layout - Absolute portable layout.
 * @returns The record, or `undefined` when no update is pending.
 */
export async function readPortableUpdateRecord(layout: PortableLayout): Promise<PortableUpdateRecord | undefined> {
  const recordFile = portableUpdateRecord(layout)
  let text: string
  try {
    text = await readFile(recordFile, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw new PortableUpdateError(`portable update: cannot read ${recordFile}`, 'PORTABLE_UPDATE_RECORD_UNREADABLE', error)
  }
  let decoded: unknown
  try {
    decoded = JSON.parse(text)
  } catch (error) {
    throw new PortableUpdateError(`portable update: ${recordFile} is not valid JSON`, 'PORTABLE_UPDATE_RECORD_INVALID', error)
  }
  const parsed = recordSchema.safeParse(decoded)
  if (!parsed.success) {
    throw new PortableUpdateError(
      `portable update: ${recordFile} has an unexpected structure (${parsed.error.issues.map(issue => issue.path.join('.') || '<root>').join(', ')})`,
      'PORTABLE_UPDATE_RECORD_INVALID',
    )
  }
  if (parsed.data.recordVersion > PORTABLE_UPDATE_RECORD_VERSION) {
    throw new PortableUpdateError(`portable update: record version ${parsed.data.recordVersion} is newer than this build`, 'PORTABLE_UPDATE_RECORD_UNSUPPORTED')
  }
  for (const field of ['stagedApp', 'backupApp'] as const) {
    const resolved = joinPortable(layout.root, parsed.data[field])
    if (!isInside(layout.root, resolved)) {
      throw new PortableUpdateError(`portable update: ${field} escapes the portable root: ${resolved}`, 'PORTABLE_UPDATE_RECORD_INVALID')
    }
  }
  return parsed.data
}

/**
 * Write the record before the application quits for an update.
 * @param options - Layout, source and target versions, staging and backup directories, and clock.
 */
export async function writePortableUpdateRecord(options: {
  readonly layout: PortableLayout
  readonly fromVersion: string
  readonly toVersion: string
  readonly stagedApp: string
  readonly backupApp: string
  readonly now?: () => Date
}): Promise<PortableUpdateRecord> {
  const record: PortableUpdateRecord = {
    recordVersion: PORTABLE_UPDATE_RECORD_VERSION,
    fromVersion: options.fromVersion,
    toVersion: options.toVersion,
    startedAt: (options.now ?? (() => new Date()))().toISOString(),
    stagedApp: options.stagedApp,
    backupApp: options.backupApp,
  }
  const recordFile = portableUpdateRecord(options.layout)
  await mkdir(options.layout.updates, { recursive: true })
  await writeFile(recordFile, `${JSON.stringify(record, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  return record
}

/**
 * Remove the pending record.
 * @param layout - Absolute portable layout.
 */
export async function clearPortableUpdateRecord(layout: PortableLayout): Promise<void> {
  await rm(portableUpdateRecord(layout), { force: true })
}

/**
 * Decide what an in-flight record means for the version that just started.
 * @param record - Pending record.
 * @param currentVersion - Version reported by the running application.
 * @returns What the previous launch completed.
 */
export function classifyPortableUpdate(record: PortableUpdateRecord, currentVersion: string): PortableUpdateOutcome {
  if (currentVersion === record.toVersion) return { kind: 'installed', record, previousVersion: record.fromVersion }
  if (currentVersion === record.fromVersion) return { kind: 'rolled-back', record }
  return {
    kind: 'inconclusive',
    record,
    reason: `running version ${currentVersion} matches neither ${record.fromVersion} nor ${record.toVersion}`,
  }
}

/** Whether a path exists. */
async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

/**
 * Keep only the newest previous-version copies.
 * @param versionsDirectory - Directory holding `version-<v>` copies.
 * @param retained - Copies to keep.
 */
export async function pruneVersionBackups(versionsDirectory: string, retained = PORTABLE_VERSION_BACKUPS_RETAINED): Promise<void> {
  let entries: string[]
  try {
    entries = (await readdir(versionsDirectory)).filter(entry => entry.startsWith('version-')).sort()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  for (const entry of entries.slice(0, Math.max(0, entries.length - retained))) {
    await rm(joinPortable(versionsDirectory, entry), { recursive: true, force: true })
  }
}

/**
 * Settle a pending update after the application started.
 * A successful install archives the replaced copy; a replacement that never
 * landed restores the backup when the application directory is gone, and keeps
 * the record when the state cannot be decided.
 * @param options - Layout, running version, and staging/backup locations.
 * @returns The outcome that was applied.
 */
export async function settlePortableUpdate(options: {
  readonly layout: PortableLayout
  readonly currentVersion: string
}): Promise<PortableUpdateOutcome> {
  const record = await readPortableUpdateRecord(options.layout)
  if (record === undefined) return { kind: 'none' }
  const outcome = classifyPortableUpdate(record, options.currentVersion)
  const backupPath = joinPortable(options.layout.root, record.backupApp)
  const versionsDirectory = portableVersionBackups(options.layout)
  if (outcome.kind === 'installed') {
    if (await pathExists(backupPath)) {
      await mkdir(versionsDirectory, { recursive: true })
      const destination = joinPortable(versionsDirectory, `version-${record.fromVersion}`)
      await rm(destination, { recursive: true, force: true })
      await rename(backupPath, destination)
      await pruneVersionBackups(versionsDirectory)
    }
    await rm(joinPortable(options.layout.root, record.stagedApp), { recursive: true, force: true })
    await clearPortableUpdateRecord(options.layout)
    return outcome
  }
  if (outcome.kind === 'rolled-back' || outcome.kind === 'inconclusive') {
    const appPresent = await pathExists(options.layout.app)
    if (!appPresent && await pathExists(backupPath)) {
      await rename(backupPath, options.layout.app)
      await clearPortableUpdateRecord(options.layout)
      return { kind: 'rolled-back', record }
    }
    if (outcome.kind === 'rolled-back') await clearPortableUpdateRecord(options.layout)
    return outcome
  }
  return outcome
}
