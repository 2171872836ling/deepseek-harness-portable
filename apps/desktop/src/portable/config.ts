/**
 * `portable.json` contract for the portable edition.
 * The manifest stores only relative directories, so copying the drive to a new
 * letter keeps every path valid. Parsing never repairs: callers must know
 * whether the on-disk manifest was accepted, so a damaged or forward-versioned
 * file is reported instead of being silently rewritten.
 * @module
 */

import { posix, win32 } from 'node:path'
import { z } from 'zod'
import { PORTABLE_MARKER_FILE } from './root.ts'

/** Manifest file name, re-exported for callers that only need the name. */
export const PORTABLE_CONFIG_FILE = PORTABLE_MARKER_FILE

/** Layout revision this build understands. */
export const PORTABLE_PATH_VERSION = 1

/** Fields accepted in `portable.json`; every directory is relative to the portable root. */
export interface PortableConfig {
  /** Portable mode switch; only `true` enables redirection. */
  readonly portableMode: boolean
  /** Layout revision; a newer revision is refused rather than guessed. */
  readonly pathVersion: number
  /** Root of the harness home (`DSH_HOME`). */
  readonly dataDirectory: string
  /** Root of application caches that do not belong to the harness home. */
  readonly cacheDirectory: string
  /** Temporary files, including the process `TEMP`/`TMP`. */
  readonly tempDirectory: string
  /** Logs root; the Electron log directory and portable diagnostics live here. */
  readonly logDirectory: string
  /** Update downloads, staging, and the pending-update transaction record. */
  readonly updateDirectory: string
  /** Configuration backups, previous application versions, and quarantined files. */
  readonly backupDirectory: string
  /**
   * Roots this installation has run from, oldest first.
   * Relocation compares them with the running root to find state written under
   * an earlier drive letter; the list is bounded and pruned by the bootstrap.
   */
  readonly rootHistory?: readonly string[]
  /** Optional generic update feed override consumed by the packaged updater. */
  readonly updateFeed?: string
}

/** Directory names written when no manifest exists. */
export const DEFAULT_PORTABLE_CONFIG: PortableConfig = {
  portableMode: true,
  pathVersion: PORTABLE_PATH_VERSION,
  dataDirectory: 'data',
  cacheDirectory: 'cache',
  tempDirectory: 'cache/temporary',
  logDirectory: 'logs',
  updateDirectory: 'updates',
  backupDirectory: 'backup',
}

/** Why a relative directory is unacceptable. */
export type PortableDirectoryProblem = 'empty' | 'absolute' | 'drive' | 'unc' | 'traversal'

/** Rejection reason for a manifest. */
export type PortableConfigProblem =
  | { readonly kind: 'invalid-json'; readonly detail: string }
  | { readonly kind: 'invalid-structure'; readonly detail: string }
  | { readonly kind: 'unsafe-directory'; readonly field: PortableDirectoryField; readonly value: string; readonly reason: PortableDirectoryProblem }
  | { readonly kind: 'unsupported-version'; readonly pathVersion: number }

/** Names of the manifest fields that hold directories. */
export type PortableDirectoryField =
  | 'dataDirectory'
  | 'cacheDirectory'
  | 'tempDirectory'
  | 'logDirectory'
  | 'updateDirectory'
  | 'backupDirectory'

const DIRECTORY_FIELDS = [
  'dataDirectory',
  'cacheDirectory',
  'tempDirectory',
  'logDirectory',
  'updateDirectory',
  'backupDirectory',
] as const satisfies readonly PortableDirectoryField[]

const recordSchema = z.looseObject({
  portableMode: z.boolean(),
  pathVersion: z.number().int(),
  dataDirectory: z.string(),
  cacheDirectory: z.string(),
  tempDirectory: z.string(),
  logDirectory: z.string(),
  updateDirectory: z.string(),
  backupDirectory: z.string(),
  rootHistory: z.array(z.string().min(1)).optional(),
  updateFeed: z.string().min(1).optional(),
})

/** Parse outcome; `ok: false` carries the exact rejection so startup can explain it. */
export type PortableConfigParse =
  | { readonly ok: true; readonly config: PortableConfig }
  | { readonly ok: false; readonly problem: PortableConfigProblem }

/**
 * Classify one manifest directory.
 * Both separators are rejected on either platform because the manifest travels
 * between machines: a Windows drive-relative or UNC value must never resolve
 * outside the removable volume, and `..` must not climb above the root.
 * @param value - Raw directory text from the manifest.
 * @returns The rejection reason, or `undefined` when the directory is a safe relative path.
 */
export function portableDirectoryProblem(value: string): PortableDirectoryProblem | undefined {
  const trimmed = value.trim()
  if (trimmed === '') return 'empty'
  if (win32.isAbsolute(trimmed) || posix.isAbsolute(trimmed)) return 'absolute'
  if (/^[A-Za-z]:/.test(trimmed)) return 'drive'
  const segments = trimmed.split(/[\\/]+/u)
  if (segments.includes('..')) return 'traversal'
  return undefined
}

/**
 * Validate a decoded manifest value.
 * @param value - Decoded JSON value.
 * @returns The accepted configuration, or the rejection reason.
 */
export function parsePortableConfigValue(value: unknown): PortableConfigParse {
  const record = recordSchema.safeParse(value)
  if (!record.success) {
    return { ok: false, problem: { kind: 'invalid-structure', detail: record.error.issues.map(issue => `${issue.path.join('.') || '<root>'}: ${issue.message}`).join('; ') } }
  }
  if (record.data.pathVersion > PORTABLE_PATH_VERSION) {
    return { ok: false, problem: { kind: 'unsupported-version', pathVersion: record.data.pathVersion } }
  }
  if (record.data.pathVersion < 1) {
    return { ok: false, problem: { kind: 'invalid-structure', detail: 'pathVersion: must be at least 1' } }
  }
  for (const field of DIRECTORY_FIELDS) {
    const problem = portableDirectoryProblem(record.data[field])
    if (problem !== undefined) {
      return { ok: false, problem: { kind: 'unsafe-directory', field, value: record.data[field], reason: problem } }
    }
  }
  return {
    ok: true,
    config: {
      portableMode: record.data.portableMode,
      pathVersion: record.data.pathVersion,
      dataDirectory: record.data.dataDirectory,
      cacheDirectory: record.data.cacheDirectory,
      tempDirectory: record.data.tempDirectory,
      logDirectory: record.data.logDirectory,
      updateDirectory: record.data.updateDirectory,
      backupDirectory: record.data.backupDirectory,
      ...(record.data.rootHistory === undefined ? {} : { rootHistory: record.data.rootHistory }),
      ...(record.data.updateFeed === undefined ? {} : { updateFeed: record.data.updateFeed }),
    },
  }
}

/**
 * Validate manifest text.
 * @param text - Raw `portable.json` content.
 * @returns The accepted configuration, or the rejection reason.
 */
export function parsePortableConfig(text: string): PortableConfigParse {
  let decoded: unknown
  try {
    decoded = JSON.parse(text)
  } catch (error) {
    return { ok: false, problem: { kind: 'invalid-json', detail: error instanceof Error ? error.message : String(error) } }
  }
  return parsePortableConfigValue(decoded)
}

/**
 * Render a manifest for durable storage.
 * @param config - Configuration to write.
 * @returns JSON text with a trailing newline.
 */
export function serializePortableConfig(config: PortableConfig): string {
  const ordered: PortableConfig = {
    portableMode: config.portableMode,
    pathVersion: config.pathVersion,
    dataDirectory: config.dataDirectory,
    cacheDirectory: config.cacheDirectory,
    tempDirectory: config.tempDirectory,
    logDirectory: config.logDirectory,
    updateDirectory: config.updateDirectory,
    backupDirectory: config.backupDirectory,
    ...(config.rootHistory === undefined ? {} : { rootHistory: config.rootHistory }),
    ...(config.updateFeed === undefined ? {} : { updateFeed: config.updateFeed }),
  }
  return `${JSON.stringify(ordered, null, 2)}\n`
}

/**
 * Read an optional manifest field alongside its default.
 * @param config - Accepted configuration.
 * @param field - Directory field to read.
 * @returns The configured directory.
 */
export function configDirectory(config: PortableConfig, field: PortableDirectoryField): string {
  return config[field]
}
