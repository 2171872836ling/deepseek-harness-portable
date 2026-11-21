/**
 * Absolute layout derived from a portable root and `portable.json`.
 * Every derived directory is proved to sit inside the root before use, so a
 * manifest that passes relative-path validation still cannot point the harness
 * home outside the removable volume.
 * @module
 */

import { HarnessError } from '@deepseek-ai/dsh-error'
import { pathFlavor } from './paths.ts'
import type { PortableConfig } from './config.ts'

/** Absolute directories of the portable edition. */
export interface PortableLayout {
  /** Removable-volume root that holds the executable and manifest. */
  readonly root: string
  /** Installed application directory (`<root>\app`). */
  readonly app: string
  /** Harness home (`DSH_HOME`) — sessions, configuration, and profiles. */
  readonly data: string
  /** Application caches outside the harness home. */
  readonly cache: string
  /** Process temporary directory. */
  readonly temp: string
  /** Logs root. */
  readonly logs: string
  /** Update downloads, staging, and transaction records. */
  readonly updates: string
  /** Configuration backups and previous application versions. */
  readonly backup: string
  /** Absolute path of `portable.json`. */
  readonly configFile: string
}

/** A manifest directory resolved outside the portable root. */
export class PortableLayoutError extends HarnessError {
  /**
   * @param field - Manifest field that escaped the root.
   * @param resolved - Absolute path it resolved to.
   * @param root - Portable root it should have stayed within.
   */
  constructor(field: string, resolved: string, root: string) {
    super(`portable.json ${field} resolves outside the portable root: ${resolved} (root ${root})`, 'PORTABLE_PATH_ESCAPE')
    this.field = field
    this.resolved = resolved
    this.root = root
  }

  /** Manifest field that escaped the root. */
  readonly field: string

  /** Absolute path the field resolved to. */
  readonly resolved: string

  /** Portable root the field had to stay within. */
  readonly root: string
}

/** Compare two absolute paths without assuming the filesystem's case sensitivity. */
function normalizeForComparison(path: string): string {
  return path.replace(/[\\/]+$/u, '').toLowerCase()
}

/**
 * Prove that a path stays inside a container.
 * @param container - Absolute container path.
 * @param candidate - Absolute path to test.
 * @returns Whether the candidate is the container or one of its descendants.
 */
export function isInside(container: string, candidate: string): boolean {
  const flavor = pathFlavor(container)
  const base = normalizeForComparison(flavor.resolve(container))
  const target = normalizeForComparison(flavor.resolve(candidate))
  if (base === target) return true
  const suffix = flavor.relative(base, target)
  return suffix !== '' && !suffix.startsWith('..') && !flavor.isAbsolute(suffix)
}

/**
 * Join path segments with the semantics of the root they extend.
 * @param base - Absolute path whose flavour governs the result.
 * @param segments - Segments to append.
 * @returns The joined absolute path.
 */
export function joinPortable(base: string, ...segments: readonly string[]): string {
  return pathFlavor(base).join(base, ...segments)
}

/**
 * Resolve one manifest directory inside the root.
 * @param root - Portable root.
 * @param field - Manifest field being resolved, for diagnostics.
 * @param directory - Relative directory from the manifest.
 * @returns The absolute directory.
 */
function resolveDirectory(root: string, field: string, directory: string): string {
  const resolved = pathFlavor(root).resolve(root, directory)
  if (!isInside(root, resolved)) throw new PortableLayoutError(field, resolved, root)
  return resolved
}

/**
 * Derive every portable directory from the manifest.
 * @param root - Portable root discovered beside the executable.
 * @param config - Accepted manifest.
 * @returns Absolute layout.
 */
export function resolvePortableLayout(root: string, config: PortableConfig): PortableLayout {
  const absoluteRoot = pathFlavor(root).resolve(root)
  return {
    root: absoluteRoot,
    app: joinPortable(absoluteRoot, 'app'),
    data: resolveDirectory(absoluteRoot, 'dataDirectory', config.dataDirectory),
    cache: resolveDirectory(absoluteRoot, 'cacheDirectory', config.cacheDirectory),
    temp: resolveDirectory(absoluteRoot, 'tempDirectory', config.tempDirectory),
    logs: resolveDirectory(absoluteRoot, 'logDirectory', config.logDirectory),
    updates: resolveDirectory(absoluteRoot, 'updateDirectory', config.updateDirectory),
    backup: resolveDirectory(absoluteRoot, 'backupDirectory', config.backupDirectory),
    configFile: joinPortable(absoluteRoot, 'portable.json'),
  }
}

/**
 * Electron user-data directory inside the harness home.
 * @param layout - Absolute portable layout.
 * @returns Absolute user-data directory.
 */
export function portableUserData(layout: PortableLayout): string {
  return joinPortable(layout.data, 'user-data')
}

/**
 * Directory that receives downloaded files chosen in the desktop shell.
 * Electron would otherwise use the per-user Downloads folder on the host disk.
 * @param layout - Absolute portable layout.
 * @returns Absolute downloads directory.
 */
export function portableDownloads(layout: PortableLayout): string {
  return joinPortable(layout.data, 'downloads')
}

/**
 * Electron log directory inside the portable logs root.
 * @param layout - Absolute portable layout.
 * @returns Absolute log directory.
 */
export function portableApplicationLogs(layout: PortableLayout): string {
  return joinPortable(layout.logs, 'application')
}

/**
 * Diagnostic log directory owned by the portable bootstrap.
 * @param layout - Absolute portable layout.
 * @returns Absolute diagnostic log directory.
 */
export function portableDiagnosticLogs(layout: PortableLayout): string {
  return joinPortable(layout.logs, 'portable')
}

/**
 * Update download cache consumed by the portable updater.
 * @param layout - Absolute portable layout.
 * @returns Absolute download directory.
 */
export function portableUpdateDownloads(layout: PortableLayout): string {
  return joinPortable(layout.updates, 'downloads')
}

/**
 * Extraction directory for a downloaded update.
 * @param layout - Absolute portable layout.
 * @returns Absolute staging directory.
 */
export function portableUpdateStaging(layout: PortableLayout): string {
  return joinPortable(layout.updates, 'staging')
}

/**
 * Transaction record written before an application directory is replaced.
 * @param layout - Absolute portable layout.
 * @returns Absolute record path.
 */
export function portableUpdateRecord(layout: PortableLayout): string {
  return joinPortable(layout.updates, 'apply.json')
}

/**
 * Location that holds the replaced application directory while an update applies.
 * The update record names it so a crash between the two renames is recoverable.
 * @param layout - Absolute portable layout.
 * @returns Absolute pending-backup directory.
 */
export function portableUpdateBackup(layout: PortableLayout): string {
  return joinPortable(layout.updates, 'pending-backup')
}

/**
 * Directory holding previous application versions.
 * @param layout - Absolute portable layout.
 * @returns Absolute versions directory.
 */
export function portableVersionBackups(layout: PortableLayout): string {
  return joinPortable(layout.backup, 'versions')
}

/**
 * Directory holding full harness-home snapshots.
 * @param layout - Absolute portable layout.
 * @returns Absolute snapshots directory.
 */
export function portableSnapshotsRoot(layout: PortableLayout): string {
  return joinPortable(layout.backup, 'snapshots')
}

/**
 * Directory of one harness-home snapshot.
 * @param layout - Absolute portable layout.
 * @param createdAt - ISO 8601 creation time; `:` and `.` are replaced for file-name safety.
 * @returns Absolute snapshot directory.
 */
export function portableSnapshotDirectory(layout: PortableLayout, createdAt: string): string {
  return joinPortable(portableSnapshotsRoot(layout), `snapshot-${createdAt.replace(/[:.]/gu, '-')}`)
}

/**
 * Directories created before the Electron shell runs.
 * Creating them up front turns a read-only or removed volume into a startup
 * failure instead of a late, silent write failure.
 * @param layout - Absolute portable layout.
 * @returns Directories to create, parents before children.
 */
export function portableDirectories(layout: PortableLayout): readonly string[] {
  const cache = layout.cache
  const python = joinPortable(cache, 'python')
  return [
    layout.app,
    layout.data,
    portableUserData(layout),
    portableDownloads(layout),
    cache,
    joinPortable(cache, 'electron'),
    joinPortable(cache, 'electron', 'http'),
    joinPortable(cache, 'electron', 'crash-dumps'),
    joinPortable(cache, 'npm'),
    joinPortable(cache, 'pnpm-store'),
    python,
    joinPortable(python, 'pycache'),
    joinPortable(python, 'pip'),
    joinPortable(python, 'uv'),
    layout.temp,
    layout.logs,
    portableApplicationLogs(layout),
    portableDiagnosticLogs(layout),
    layout.updates,
    portableUpdateDownloads(layout),
    portableUpdateStaging(layout),
    layout.backup,
    portableVersionBackups(layout),
    portableSnapshotsRoot(layout),
  ]
}
