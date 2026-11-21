/**
 * Portable startup: redirect every path Electron and the harness derive, before
 * the shell module body reads them.
 * The whole sequence is synchronous on purpose. Electron fixes `userData`,
 * `logs`, and `temp` during module evaluation, so an asynchronous bootstrap
 * would leave the first locale cache read and the fatal-recovery journal on the
 * host disk. Nothing here may fall back to the per-user home: an unusable
 * portable volume is reported and startup stops.
 * @module
 */

import { statfsSync } from 'node:fs'
import type { PortableConfig, PortableConfigProblem } from './config.ts'
import { applyPortableEnvironment } from './environment.ts'
import {
  joinPortable,
  portableApplicationLogs,
  portableDiagnosticLogs,
  portableDirectories,
  portableDownloads,
  portableUserData,
  resolvePortableLayout,
  type PortableLayout,
} from './layout.ts'
import { findPortableRoot, PORTABLE_MARKER_FILE } from './root.ts'
import { recordPortableRoot } from './relocation.ts'
import {
  appendPortableLog,
  loadPortableConfig,
  NODE_PORTABLE_FILE_SYSTEM,
  writePortableConfig,
  type PortableFileSystem,
} from './store.ts'

/** Electron application paths the portable bootstrap owns. */
export interface PortableAppPort {
  /** Read one of Electron's derived paths. */
  getPath: (name: 'userData' | 'logs' | 'temp') => string
  /** Replace one of Electron's derived paths. */
  setPath: (name: 'userData' | 'sessionData' | 'logs' | 'crashDumps' | 'temp' | 'downloads', path: string) => void
}

/** Free space below which the volume is reported as nearly full. */
export const PORTABLE_LOW_SPACE_BYTES = 512 * 1024 * 1024

/** Chromium switch set before Electron initializes its caches. */
export interface PortableCommandLinePort {
  /** Append a Chromium switch. */
  appendSwitch: (name: string, value?: string) => void
}

/** Why portable startup cannot continue. */
export type PortableStartupProblem =
  | { readonly kind: 'missing-marker'; readonly root: string }
  | { readonly kind: 'relative-override'; readonly root: string }
  | { readonly kind: 'unsupported-version'; readonly pathVersion: number }
  | { readonly kind: 'escaped-directory'; readonly field: string; readonly resolved: string }
  | { readonly kind: 'unusable-directory'; readonly directory: string; readonly reason: string }
  | { readonly kind: 'manifest'; readonly problem: PortableConfigProblem; readonly reason: string }

/** Outcome of the portable bootstrap. */
export type PortableStartup =
  | { readonly kind: 'absent' }
  | { readonly kind: 'failed'; readonly problem: PortableStartupProblem; readonly message: string }
  | {
    /** Portable mode is active and every derived path is redirected. */
    readonly kind: 'active'
    /** Absolute layout in use. */
    readonly layout: PortableLayout
    /** Accepted manifest. */
    readonly config: PortableConfig
    /** Human-readable repairs that happened during startup. */
    readonly warnings: readonly string[]
  }

/** Inputs of the portable bootstrap. */
export interface PortableBootstrapOptions {
  /** Electron application port. */
  readonly app: PortableAppPort
  /** Electron command-line port, absent when running outside Electron. */
  readonly commandLine?: PortableCommandLinePort
  /** Path of the running executable. */
  readonly execPath: string
  /** Live environment, mutated with the portable overrides. */
  readonly env: NodeJS.ProcessEnv
  /** Synchronous filesystem port; defaults to Node's own. */
  readonly fileSystem?: PortableFileSystem
  /**
   * Free bytes left on the volume holding a directory.
   * Defaults to a `statfs` read; the preflight only warns, because a volume can
   * be full of unrelated files and blocking startup there would strand the user.
   */
  readonly availableBytes?: (directory: string) => number | undefined
  /** Clock used for quarantined manifests and diagnostic names. */
  readonly now?: () => Date
}

/**
 * Read free space on the volume holding a directory.
 * @param directory - Absolute directory.
 * @returns Free bytes, or `undefined` when the volume cannot report them.
 */
function nodeAvailableBytes(directory: string): number | undefined {
  try {
    const stats = statfsSync(directory)
    return stats.bavail * stats.bsize
  } catch {
    // Some filesystems refuse statfs; a missing warning is better than a refused startup.
    return undefined
  }
}

/**
 * Render a startup rejection for the fatal error dialog.
 * @param problem - Typed rejection.
 * @returns Operator-readable text naming the offending path.
 */
export function describePortableStartupProblem(problem: PortableStartupProblem): string {
  switch (problem.kind) {
    case 'missing-marker':
      return `Portable mode is configured for ${problem.root}, but ${PORTABLE_MARKER_FILE} is missing there.`
    case 'relative-override':
      return `Portable mode requires an absolute root, but DSH_PORTABLE_ROOT is "${problem.root}".`
    case 'unsupported-version':
      return `This portable layout uses pathVersion ${problem.pathVersion}, which this build does not understand. Update the application files; stored data stays untouched.`
    case 'escaped-directory':
      return `portable.json field ${problem.field} resolves outside the portable root: ${problem.resolved}.`
    case 'unusable-directory':
      return `Portable mode cannot use ${problem.directory}: ${problem.reason}`
    case 'manifest':
      return `Portable mode cannot read ${PORTABLE_MARKER_FILE}: ${problem.reason}`
  }
}

/**
 * Redirect Electron and the harness onto the portable volume.
 * @param options - Application, command line, executable path, environment, and ports.
 * @returns The startup outcome; `active` means all paths are redirected.
 */
export function initializePortableDesktop(options: PortableBootstrapOptions): PortableStartup {
  const fileSystem = options.fileSystem ?? NODE_PORTABLE_FILE_SYSTEM
  const discovery = findPortableRoot({
    execPath: options.execPath,
    env: options.env,
    exists: path => fileSystem.exists(path),
  })
  if (discovery.kind === 'absent') return { kind: 'absent' }
  if (discovery.kind === 'invalid') {
    const problem: PortableStartupProblem = discovery.problem === 'missing-marker'
      ? { kind: 'missing-marker', root: discovery.root }
      : { kind: 'relative-override', root: discovery.root }
    return { kind: 'failed', problem, message: describePortableStartupProblem(problem) }
  }

  let loaded: ReturnType<typeof loadPortableConfig>
  try {
    loaded = loadPortableConfig({
      configFile: discovery.marker,
      quarantineDirectory: joinPortable(discovery.root, 'backup'),
      fileSystem,
      ...(options.now === undefined ? {} : { now: options.now }),
    })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    const problem: PortableStartupProblem = { kind: 'manifest', problem: { kind: 'invalid-json', detail: reason }, reason }
    return { kind: 'failed', problem, message: describePortableStartupProblem(problem) }
  }
  if (loaded.kind === 'failed') {
    const problem: PortableStartupProblem = loaded.problem.kind === 'unsupported-version'
      ? { kind: 'unsupported-version', pathVersion: loaded.problem.pathVersion }
      : { kind: 'manifest', problem: loaded.problem, reason: JSON.stringify(loaded.problem) }
    return { kind: 'failed', problem, message: describePortableStartupProblem(problem) }
  }

  // An explicit opt-out keeps the conventional per-user layout: the marker stays in place,
  // but no path is redirected and nothing is created on the volume.
  if (!loaded.config.portableMode) return { kind: 'absent' }

  let layout: PortableLayout
  try {
    layout = resolvePortableLayout(discovery.root, loaded.config)
  } catch (error) {
    const escaped = error as { field?: string; resolved?: string }
    const problem: PortableStartupProblem = typeof escaped.field === 'string'
      ? { kind: 'escaped-directory', field: escaped.field, resolved: escaped.resolved ?? discovery.root }
      : { kind: 'manifest', problem: { kind: 'invalid-structure', detail: String(error) }, reason: String(error) }
    return { kind: 'failed', problem, message: describePortableStartupProblem(problem) }
  }

  // Remember which directory failed: a read-only or full volume reports the first one that
  // cannot be created, and that name is what the operator has to repair.
  let creating = layout.root
  try {
    for (const directory of portableDirectories(layout)) {
      creating = directory
      fileSystem.makeDirectory(directory)
    }
  } catch (error) {
    const problem: PortableStartupProblem = {
      kind: 'unusable-directory',
      directory: creating,
      reason: error instanceof Error ? error.message : String(error),
    }
    return { kind: 'failed', problem, message: describePortableStartupProblem(problem) }
  }

  const warnings: string[] = []
  const history = recordPortableRoot(loaded.config, discovery.root)
  if (history.changed) {
    try {
      writePortableConfig({ configFile: discovery.marker, config: history.config, fileSystem })
    } catch (error) {
      const warning = `portable: cannot record root ${discovery.root} in ${PORTABLE_MARKER_FILE}: ${error instanceof Error ? error.message : String(error)}`
      warnings.push(warning)
      appendPortableLog(joinPortable(portableDiagnosticLogs(layout), 'portable.log'), warning, fileSystem)
    }
  }

  applyPortableEnvironment(options.env, layout)
  options.app.setPath('userData', portableUserData(layout))
  options.app.setPath('sessionData', portableUserData(layout))
  options.app.setPath('logs', portableApplicationLogs(layout))
  options.app.setPath('crashDumps', joinPortable(layout.cache, 'electron', 'crash-dumps'))
  options.app.setPath('temp', layout.temp)
  options.app.setPath('downloads', portableDownloads(layout))
  options.commandLine?.appendSwitch('disk-cache-dir', joinPortable(layout.cache, 'electron', 'http'))

  // A full volume fails writes long after the operator could still act; report it at startup.
  const available = (options.availableBytes ?? nodeAvailableBytes)(layout.root)
  if (available !== undefined && available < PORTABLE_LOW_SPACE_BYTES) {
    const warning = `portable: ${layout.root} has ${available} free bytes; keep at least ${PORTABLE_LOW_SPACE_BYTES} for sessions and plugin installs`
    warnings.push(warning)
    appendPortableLog(joinPortable(portableDiagnosticLogs(layout), 'portable.log'), warning, fileSystem)
  }

  if (loaded.quarantine !== undefined) {
    const warning = `portable: replaced unusable ${PORTABLE_MARKER_FILE} with defaults; previous file kept at ${loaded.quarantine}`
    warnings.push(warning)
    appendPortableLog(joinPortable(portableDiagnosticLogs(layout), 'portable.log'), warning, fileSystem)
  }
  return { kind: 'active', layout, config: history.config, warnings }
}
