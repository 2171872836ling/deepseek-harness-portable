/**
 * One-time import of an existing per-user installation into the portable volume.
 * Migration copies rather than moves: the original installation keeps working,
 * and an interrupted copy leaves the source intact. Each import is described
 * before it starts, verified afterwards, and rolled back to an empty destination
 * when the copy does not match what was described. The import runs only when the
 * portable harness home holds no sessions yet, so a second launch never
 * overwrites state the portable copy has since accumulated.
 * @module
 */

import { appendFile, cp, mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { joinPortable } from './layout.ts'
import type { PortableLayout } from './layout.ts'
import { portableDiagnosticLogs, portableVersionBackups } from './layout.ts'

/** A per-user location whose contents can be imported. */
export interface PortableMigrationSource {
  /** What the location holds, for the report and the log. */
  readonly kind: 'harness-home' | 'desktop-user-data'
  /** Absolute source path. */
  readonly path: string
  /** Destination inside the portable volume. */
  readonly destination: string
}

/** What one source held when the import started. */
export interface PortableMigrationSnapshot {
  /** Source location. */
  readonly source: PortableMigrationSource
  /** Files found in the source. */
  readonly files: number
  /** Total bytes found in the source. */
  readonly bytes: number
}

/** Result of the import attempt. */
export type PortableMigration =
  | { readonly kind: 'skipped'; readonly reason: 'data-present' | 'no-source' }
  | {
    /** At least one source was imported and verified. */
    readonly kind: 'migrated'
    /** Imported sources. */
    readonly imported: readonly PortableMigrationSource[]
    /** Diagnostic log path. */
    readonly logFile: string
    /** Record of what was copied, kept beside the log. */
    readonly manifestFile: string
    /** Sources that could not be imported, with their failure text. */
    readonly failures: readonly { readonly source: PortableMigrationSource; readonly reason: string }[]
  }
  | {
    /** No source survived verification; every destination is empty again. */
    readonly kind: 'rolled-back'
    /** Diagnostic log path. */
    readonly logFile: string
    /** Record of what was attempted. */
    readonly manifestFile: string
    /** Why the import was abandoned. */
    readonly failures: readonly { readonly source: PortableMigrationSource; readonly reason: string }[]
  }

/**
 * Candidate per-user locations for one host.
 * Only state worth keeping is listed: the harness home with sessions and
 * configuration, and the Electron user-data directory with shell settings.
 * Downloaded installers are omitted because the update feed reproduces them.
 * @param options - Home directory, roaming application-data directory, product name, layout, and portable user-data directory.
 * @returns Sources in priority order; absent directories are filtered by the caller.
 */
export function migrationCandidates(options: {
  readonly home: string
  readonly appData?: string
  readonly productName?: string
  readonly layout: PortableLayout
  readonly userData: string
}): readonly PortableMigrationSource[] {
  const sources: PortableMigrationSource[] = [
    { kind: 'harness-home', path: join(options.home, '.dsh'), destination: options.layout.data },
  ]
  if (options.appData !== undefined && options.productName !== undefined) {
    sources.push({
      kind: 'desktop-user-data',
      path: join(options.appData, options.productName),
      destination: options.userData,
    })
  }
  return sources
}

/**
 * Whether a directory holds at least one entry.
 * @param directory - Absolute directory path.
 * @returns `true` when the directory exists and is not empty.
 */
async function hasEntries(directory: string): Promise<boolean> {
  try {
    const entries = await readdir(directory)
    return entries.length > 0
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

/**
 * Count the files and bytes below a directory.
 * @param root - Directory to measure.
 * @returns File count and total size, or `undefined` when the directory is absent.
 */
async function measureTree(root: string): Promise<{ files: number; bytes: number } | undefined> {
  try {
    const entries = await readdir(root, { recursive: true, withFileTypes: true })
    let files = 0
    let bytes = 0
    for (const entry of entries) {
      if (!entry.isFile()) continue
      const info = await stat(join(entry.parentPath, entry.name))
      files += 1
      bytes += info.size
    }
    return { files, bytes }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

/**
 * Import an existing installation when the portable copy is still empty.
 * Every source is measured before the copy, verified afterwards, and moved aside
 * on a mismatch so the destination is empty again for the next launch.
 * @param options - Layout, candidate sources, and the portable user-data directory.
 * @returns Whether anything was imported, rolled back, or skipped.
 */
export async function migrateIntoPortable(options: {
  readonly layout: PortableLayout
  readonly sources: readonly PortableMigrationSource[]
  readonly userData: string
  readonly now?: () => Date
}): Promise<PortableMigration> {
  const { layout, sources, userData } = options
  const now = options.now ?? (() => new Date())
  if (await hasEntries(layout.data) || await hasEntries(userData)) {
    return { kind: 'skipped', reason: 'data-present' }
  }
  const usable: PortableMigrationSource[] = []
  for (const source of sources) {
    try {
      const info = await stat(source.path)
      if (info.isDirectory()) usable.push(source)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
  }
  if (usable.length === 0) return { kind: 'skipped', reason: 'no-source' }

  const stamp = now().toISOString().replace(/[:.]/gu, '-')
  const logDirectory = portableDiagnosticLogs(layout)
  await mkdir(logDirectory, { recursive: true })
  const logFile = joinPortable(logDirectory, `migration-${stamp}.log`)
  const manifestFile = joinPortable(logDirectory, `migration-${stamp}.json`)
  const discardDirectory = joinPortable(portableVersionBackups(layout), '..', 'migration', stamp)

  const snapshots: PortableMigrationSnapshot[] = []
  const imported: PortableMigrationSource[] = []
  const failures: { source: PortableMigrationSource; reason: string }[] = []
  const lines: string[] = [`portable migration ${now().toISOString()}`]

  for (const source of usable) {
    // Describe first: the copy is verified against what the source held, so a
    // truncated or partially failed copy cannot silently become the portable state.
    const before = await measureTree(source.path)
    if (before === undefined) continue
    snapshots.push({ source, files: before.files, bytes: before.bytes })
    lines.push(`described ${source.kind}: ${source.path} (${before.files} files, ${before.bytes} bytes)`)
    try {
      await mkdir(dirname(source.destination), { recursive: true })
      await cp(source.path, source.destination, { recursive: true, force: false, errorOnExist: false, preserveTimestamps: true })
      const after = await measureTree(source.destination)
      if (after === undefined || after.files !== before.files || after.bytes !== before.bytes) {
        throw new Error(`copied ${after?.files ?? 0} files / ${after?.bytes ?? 0} bytes, expected ${before.files} / ${before.bytes}`)
      }
      imported.push(source)
      lines.push(`imported ${source.kind}: ${source.path} -> ${source.destination}`)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      failures.push({ source, reason })
      lines.push(`failed ${source.kind}: ${source.path}: ${reason}`)
      // Return the destination to its empty state; keeping a partial copy would
      // make the next launch treat the volume as already holding user data.
      try {
        await mkdir(discardDirectory, { recursive: true })
        await rename(source.destination, joinPortable(discardDirectory, source.kind))
        lines.push(`moved incomplete copy aside: ${source.destination}`)
      } catch (discardError) {
        if ((discardError as NodeJS.ErrnoException).code !== 'ENOENT') {
          await rm(source.destination, { recursive: true, force: true })
          lines.push(`removed incomplete copy: ${source.destination}`)
        }
      }
    }
  }

  const manifest = { version: 1, startedAt: now().toISOString(), sources: snapshots }
  await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  await appendFile(logFile, `${lines.join('\n')}\n`, 'utf8')
  if (imported.length === 0) return { kind: 'rolled-back', logFile, manifestFile, failures }
  return { kind: 'migrated', imported, logFile, manifestFile, failures }
}
