/**
 * Synchronous `portable.json` storage.
 * The manifest is read before Electron's `ready` event, so this module keeps a
 * synchronous filesystem port: an asynchronous read could not influence paths
 * Electron has already derived from `userData`. A damaged manifest is moved
 * aside and replaced with defaults; an unreadable manifest fails startup
 * instead of silently falling back to the per-user home.
 * @module
 */

import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { HarnessError } from '@deepseek-ai/dsh-error'
import {
  DEFAULT_PORTABLE_CONFIG,
  PORTABLE_PATH_VERSION,
  parsePortableConfig,
  portableDirectoryProblem,
  serializePortableConfig,
  type PortableConfig,
  type PortableConfigProblem,
  type PortableDirectoryField,
} from './config.ts'

/** Synchronous filesystem operations used before Electron is ready. */
export interface PortableFileSystem {
  /** Whether a path exists. */
  exists: (path: string) => boolean
  /** Read UTF-8 text. */
  readText: (path: string) => string
  /** Write UTF-8 text, replacing the file. */
  writeText: (path: string, content: string) => void
  /** Append UTF-8 text. */
  appendText: (path: string, content: string) => void
  /** Create a directory recursively. */
  makeDirectory: (path: string) => void
  /** Copy a file, replacing the target. */
  copyFile: (from: string, to: string) => void
}

/** Node's synchronous filesystem bound to the {@link PortableFileSystem} port. */
export const NODE_PORTABLE_FILE_SYSTEM: PortableFileSystem = {
  exists: path => existsSync(path),
  readText: path => readFileSync(path, 'utf8'),
  writeText: (path, content) => {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content, { encoding: 'utf8', flag: 'w' })
  },
  appendText: (path, content) => {
    mkdirSync(dirname(path), { recursive: true })
    appendFileSync(path, content, { encoding: 'utf8', flag: 'a' })
  },
  makeDirectory: path => mkdirSync(path, { recursive: true }),
  copyFile: (from, to) => { copyFileSync(from, to) },
}

/** A manifest that could not be read, preserved, or written. */
export class PortableConfigError extends HarnessError {
  /**
   * @param message - Actionable description naming the offending path.
   * @param code - Stable failure class.
   * @param cause - Underlying filesystem failure.
   */
  constructor(message: string, code: string, cause?: unknown) {
    super(message, code, cause === undefined ? undefined : { cause })
  }
}

/** Outcome of loading the manifest. */
export type PortableConfigLoad =
  | {
    /** An accepted manifest is available. */
    readonly kind: 'loaded'
    /** Accepted manifest. */
    readonly config: PortableConfig
    /** Quarantined manifest path when the on-disk file had to be replaced. */
    readonly quarantine?: string
    /** Reason the on-disk file was replaced. */
    readonly replaced?: PortableConfigProblem
  }
  | {
    /** The manifest cannot be used and startup must stop. */
    readonly kind: 'failed'
    /** Why the manifest cannot be used. */
    readonly problem: PortableConfigProblem
  }

/** Filesystem-safe timestamp suffix for quarantined manifests. */
function quarantineStamp(now: Date): string {
  return now.toISOString().replace(/[:.]/gu, '-')
}

/**
 * Quarantine a damaged manifest and write defaults in its place.
 * @param configFile - Absolute manifest path.
 * @param quarantineDirectory - Directory receiving the damaged copy.
 * @param fileSystem - Filesystem port.
 * @param now - Clock used for the quarantine name.
 * @returns Absolute quarantine path.
 */
function replaceWithDefaults(
  configFile: string,
  quarantineDirectory: string,
  fileSystem: PortableFileSystem,
  now: Date,
): string {
  fileSystem.makeDirectory(quarantineDirectory)
  const quarantine = join(quarantineDirectory, `portable.json.corrupt-${quarantineStamp(now)}`)
  try {
    fileSystem.copyFile(configFile, quarantine)
    fileSystem.writeText(configFile, serializePortableConfig(DEFAULT_PORTABLE_CONFIG))
  } catch (error) {
    throw new PortableConfigError(`portable: cannot repair ${configFile}`, 'PORTABLE_CONFIG_UNWRITABLE', error)
  }
  return quarantine
}

/**
 * Load the manifest, creating or repairing it as needed.
 * @param options - Manifest path, quarantine directory, filesystem port, and clock.
 * @returns The accepted manifest and any repair that happened.
 */
export function loadPortableConfig(options: {
  readonly configFile: string
  readonly quarantineDirectory: string
  readonly fileSystem: PortableFileSystem
  readonly now?: () => Date
}): PortableConfigLoad {
  const { configFile, quarantineDirectory, fileSystem } = options
  const now = options.now ?? (() => new Date())
  if (!fileSystem.exists(configFile)) {
    try {
      fileSystem.writeText(configFile, serializePortableConfig(DEFAULT_PORTABLE_CONFIG))
    } catch (error) {
      throw new PortableConfigError(`portable: cannot create ${configFile}`, 'PORTABLE_CONFIG_UNWRITABLE', error)
    }
    return { kind: 'loaded', config: DEFAULT_PORTABLE_CONFIG }
  }
  let text: string
  try {
    text = fileSystem.readText(configFile)
  } catch (error) {
    throw new PortableConfigError(`portable: cannot read ${configFile}`, 'PORTABLE_CONFIG_UNREADABLE', error)
  }
  const parsed = parsePortableConfig(text)
  if (parsed.ok) return { kind: 'loaded', config: parsed.config }
  if (parsed.problem.kind === 'unsupported-version') return { kind: 'failed', problem: parsed.problem }
  const quarantine = replaceWithDefaults(configFile, quarantineDirectory, fileSystem, now())
  return { kind: 'loaded', config: DEFAULT_PORTABLE_CONFIG, quarantine, replaced: parsed.problem }
}

/** Outcome of a manifest write. */
export type PortableConfigWrite =
  | { readonly kind: 'written' }
  | { readonly kind: 'skipped'; readonly reason: 'portable-mode-off' }
  | { readonly kind: 'rejected'; readonly problem: PortableConfigProblem }

const DIRECTORY_FIELDS: readonly PortableDirectoryField[] = [
  'dataDirectory',
  'cacheDirectory',
  'tempDirectory',
  'logDirectory',
  'updateDirectory',
  'backupDirectory',
]

/**
 * Write a manifest supplied by an installer, migrator, or user.
 * Portable mode must stay on: a manifest that disables it is skipped, so
 * nothing in the update or repair path can move stored data back to a per-user
 * home.
 * @param options - Manifest path, candidate configuration, and filesystem port.
 * @returns Whether the manifest was written.
 */
export function writePortableConfig(options: {
  readonly configFile: string
  readonly config: PortableConfig
  readonly fileSystem: PortableFileSystem
}): PortableConfigWrite {
  const candidate = options.config
  if (!candidate.portableMode) return { kind: 'skipped', reason: 'portable-mode-off' }
  for (const field of DIRECTORY_FIELDS) {
    const problem = portableDirectoryProblem(candidate[field])
    if (problem !== undefined) return { kind: 'rejected', problem: { kind: 'unsafe-directory', field, value: candidate[field], reason: problem } }
  }
  if (candidate.pathVersion > PORTABLE_PATH_VERSION) {
    return { kind: 'rejected', problem: { kind: 'unsupported-version', pathVersion: candidate.pathVersion } }
  }
  options.fileSystem.writeText(options.configFile, serializePortableConfig(candidate))
  return { kind: 'written' }
}

/**
 * Append one portable diagnostic line.
 * @param logFile - Absolute log path.
 * @param message - Line to append.
 * @param fileSystem - Filesystem port.
 */
export function appendPortableLog(logFile: string, message: string, fileSystem: PortableFileSystem): void {
  fileSystem.appendText(logFile, `${new Date().toISOString()} ${message}\n`)
}
