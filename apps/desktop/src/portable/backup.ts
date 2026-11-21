/**
 * Full-volume snapshots of the portable harness state.
 * The updater keeps only the previous application directory, and relocation keeps
 * copies of the files it rewrites; neither can undo a damaged session store, a
 * half-written configuration, or a plugin install that removed a profile. A
 * snapshot copies the harness home and its manifest beside it, so a restore is a
 * verified copy rather than a hope. Snapshots live under `backup/snapshots`,
 * newest first, and only a bounded number are retained.
 * @module
 */

import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { HarnessError } from '@deepseek-ai/dsh-error'
import { joinPortable } from './layout.ts'
import type { PortableLayout } from './layout.ts'
import { portableSnapshotDirectory, portableSnapshotsRoot, portableVersionBackups } from './layout.ts'

/** Snapshot manifest version. */
export const PORTABLE_SNAPSHOT_VERSION = 1

/** Number of snapshots retained on the volume. */
export const PORTABLE_SNAPSHOTS_RETAINED = 3

/** One snapshot on disk. */
export interface PortableSnapshot {
  /** Directory holding the copied harness home and the manifest. */
  readonly directory: string
  /** Manifest path. */
  readonly manifestFile: string
  /** Reason recorded when the snapshot was taken. */
  readonly reason: string
  /** Creation time, ISO 8601. */
  readonly createdAt: string
  /** Files copied. */
  readonly files: number
  /** Bytes copied. */
  readonly bytes: number
}

/** Snapshot manifest as written next to the copied home. */
interface PortableSnapshotManifest {
  readonly version: number
  readonly createdAt: string
  readonly reason: string
  readonly root: string
  readonly files: number
  readonly bytes: number
}

/** A snapshot operation that could not be completed. */
export class PortableSnapshotError extends HarnessError {
  /**
   * @param message - What failed, in operator terms.
   * @param code - Stable failure code for tests and logs.
   * @param options - Optional cause.
   */
  constructor(message: string, code: string, options?: ErrorOptions) {
    super(message, code, options)
    this.name = 'PortableSnapshotError'
  }
}

/**
 * Count files and bytes below a directory.
 * @param root - Directory to measure.
 * @returns Counts, or `undefined` when the directory does not exist yet.
 */
async function measure(root: string): Promise<{ files: number; bytes: number } | undefined> {
  try {
    const entries = await readdir(root, { recursive: true, withFileTypes: true })
    let files = 0
    let bytes = 0
    for (const entry of entries) {
      if (!entry.isFile()) continue
      files += 1
      bytes += (await stat(join(entry.parentPath, entry.name))).size
    }
    return { files, bytes }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

/**
 * Read and validate one snapshot manifest.
 * @param directory - Snapshot directory.
 * @returns The recorded snapshot.
 * @throws PortableSnapshotError when the manifest is missing or unreadable.
 */
async function readManifest(directory: string): Promise<PortableSnapshot> {
  const manifestFile = joinPortable(directory, 'manifest.json')
  let text: string
  try {
    text = await readFile(manifestFile, 'utf8')
  } catch (error) {
    throw new PortableSnapshotError(`portable snapshot: cannot read ${manifestFile}`, 'PORTABLE_SNAPSHOT_UNREADABLE', { cause: error })
  }
  let manifest: PortableSnapshotManifest
  try {
    manifest = JSON.parse(text) as PortableSnapshotManifest
  } catch (error) {
    throw new PortableSnapshotError(`portable snapshot: ${manifestFile} is not JSON`, 'PORTABLE_SNAPSHOT_INVALID', { cause: error })
  }
  if (manifest.version !== PORTABLE_SNAPSHOT_VERSION || typeof manifest.files !== 'number' || typeof manifest.bytes !== 'number') {
    throw new PortableSnapshotError(`portable snapshot: ${manifestFile} has an unsupported format`, 'PORTABLE_SNAPSHOT_INVALID')
  }
  return {
    directory,
    manifestFile,
    reason: manifest.reason,
    createdAt: manifest.createdAt,
    files: manifest.files,
    bytes: manifest.bytes,
  }
}

/**
 * List the snapshots on the volume, newest first.
 * @param layout - Portable layout.
 * @returns Snapshots that carry a readable manifest; unreadable directories are skipped.
 */
export async function listPortableSnapshots(layout: PortableLayout): Promise<readonly PortableSnapshot[]> {
  let entries: string[]
  try {
    entries = await readdir(portableSnapshotsRoot(layout))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const snapshots: PortableSnapshot[] = []
  for (const name of entries.sort().reverse()) {
    const directory = joinPortable(portableSnapshotsRoot(layout), name)
    try {
      snapshots.push(await readManifest(directory))
    } catch (error) {
      if (!(error instanceof PortableSnapshotError)) throw error
    }
  }
  return snapshots
}

/**
 * Delete all but the newest snapshots.
 * @param layout - Portable layout.
 * @param retained - Snapshots to keep.
 */
export async function prunePortableSnapshots(layout: PortableLayout, retained: number = PORTABLE_SNAPSHOTS_RETAINED): Promise<void> {
  const snapshots = await listPortableSnapshots(layout)
  for (const snapshot of snapshots.slice(retained)) {
    await rm(snapshot.directory, { recursive: true, force: true })
  }
}

/**
 * Copy the harness home and the manifest into a new snapshot.
 * @param options - Layout, reason for the snapshot, and clock.
 * @returns The snapshot as recorded, including verified file and byte counts.
 * @throws PortableSnapshotError when the copy does not match what the source held.
 */
export async function createPortableSnapshot(options: {
  readonly layout: PortableLayout
  readonly reason: string
  readonly now?: () => Date
}): Promise<PortableSnapshot> {
  const { layout, reason } = options
  const now = options.now ?? (() => new Date())
  const createdAt = now().toISOString()
  const directory = portableSnapshotDirectory(layout, createdAt)
  const home = joinPortable(directory, 'home')
  const before = await measure(layout.data)
  if (before === undefined) {
    throw new PortableSnapshotError(`portable snapshot: ${layout.data} does not exist`, 'PORTABLE_SNAPSHOT_EMPTY')
  }
  await mkdir(directory, { recursive: true })
  try {
    await cp(layout.data, home, { recursive: true, force: false, errorOnExist: false, preserveTimestamps: true })
    await cp(layout.configFile, joinPortable(directory, 'portable.json'), { force: false, errorOnExist: false })
  } catch (error) {
    await rm(directory, { recursive: true, force: true })
    throw new PortableSnapshotError(`portable snapshot: cannot copy ${layout.data}`, 'PORTABLE_SNAPSHOT_COPY_FAILED', { cause: error })
  }
  const after = await measure(home)
  if (after === undefined || after.files !== before.files || after.bytes !== before.bytes) {
    await rm(directory, { recursive: true, force: true })
    throw new PortableSnapshotError(
      `portable snapshot: copied ${after?.files ?? 0} files / ${after?.bytes ?? 0} bytes, expected ${before.files} / ${before.bytes}`,
      'PORTABLE_SNAPSHOT_MISMATCH',
    )
  }
  const manifest: PortableSnapshotManifest = {
    version: PORTABLE_SNAPSHOT_VERSION,
    createdAt,
    reason,
    root: layout.root,
    files: after.files,
    bytes: after.bytes,
  }
  const manifestFile = joinPortable(directory, 'manifest.json')
  await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  await prunePortableSnapshots(layout)
  return { directory, manifestFile, reason, createdAt, files: after.files, bytes: after.bytes }
}

/**
 * Replace the harness home with a snapshot.
 * The current home is moved aside first, so a restore that fails to verify puts
 * the previous state back instead of leaving an empty volume.
 * @param options - Layout and snapshot to restore.
 * @returns The snapshot that was restored.
 * @throws PortableSnapshotError when the copy cannot be verified.
 */
export async function restorePortableSnapshot(options: {
  readonly layout: PortableLayout
  readonly snapshot: PortableSnapshot
  readonly now?: () => Date
}): Promise<PortableSnapshot> {
  const { layout, snapshot } = options
  const now = options.now ?? (() => new Date())
  const superseded = joinPortable(portableVersionBackups(layout), '..', 'restore', now().toISOString().replace(/[:.]/gu, '-'))
  const home = join(snapshot.directory, 'home')
  const recorded = await measure(home)
  if (recorded === undefined || recorded.files !== snapshot.files || recorded.bytes !== snapshot.bytes) {
    throw new PortableSnapshotError(
      `portable snapshot: ${snapshot.directory} no longer matches its manifest`,
      'PORTABLE_SNAPSHOT_MISMATCH',
    )
  }
  await mkdir(superseded, { recursive: true })
  await rename(layout.data, joinPortable(superseded, 'home'))
  try {
    await cp(home, layout.data, { recursive: true, force: false, errorOnExist: false, preserveTimestamps: true })
    const restored = await measure(layout.data)
    if (restored === undefined || restored.files !== snapshot.files || restored.bytes !== snapshot.bytes) {
      throw new PortableSnapshotError(
        `portable snapshot: restored ${restored?.files ?? 0} files / ${restored?.bytes ?? 0} bytes, expected ${snapshot.files} / ${snapshot.bytes}`,
        'PORTABLE_SNAPSHOT_MISMATCH',
      )
    }
    await cp(joinPortable(snapshot.directory, 'portable.json'), layout.configFile, { force: true })
  } catch (error) {
    await rm(layout.data, { recursive: true, force: true })
    await rename(joinPortable(superseded, 'home'), layout.data)
    throw error
  }
  return snapshot
}

/**
 * Resolve a snapshot by name or by its position in the listing.
 * @param layout - Portable layout.
 * @param selector - Snapshot directory name, or `latest`.
 * @returns The snapshot to restore.
 */
export async function findPortableSnapshot(layout: PortableLayout, selector: string): Promise<PortableSnapshot> {
  const snapshots = await listPortableSnapshots(layout)
  if (snapshots.length === 0) {
    throw new PortableSnapshotError('portable snapshot: the volume holds no snapshots', 'PORTABLE_SNAPSHOT_MISSING')
  }
  if (selector === 'latest') return snapshots[0] as PortableSnapshot
  const match = snapshots.find(snapshot => snapshot.directory.endsWith(selector))
  if (match === undefined) {
    throw new PortableSnapshotError(`portable snapshot: no snapshot named ${selector}`, 'PORTABLE_SNAPSHOT_MISSING')
  }
  return match
}
