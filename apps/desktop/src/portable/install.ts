/**
 * Installer for the portable edition.
 * There is no operating-system installer: a portable edition is a directory that
 * runs in place, and an MSI or NSIS wizard would register an uninstall entry,
 * install locations, and protocol handlers that the portable edition must never
 * write. This module performs the equivalent work — pick a volume, refuse an
 * unusable target, copy, verify — without touching the registry, and the
 * `scripts/portable-install.ts` wrapper supplies the volume list and the prompt.
 * @module
 */

import { cp, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DEFAULT_PORTABLE_CONFIG, serializePortableConfig } from './config.ts'
import { isInside } from './layout.ts'
import { PORTABLE_MARKER_FILE } from './root.ts'

/** Minimum free space kept after the copy, for the harness home and caches. */
export const PORTABLE_INSTALL_SPACE_MARGIN = 512 * 1024 * 1024

/** One volume the installer can offer. */
export interface PortableVolume {
  /** Root such as `E:\`. */
  readonly root: string
  /** Volume label reported by the platform, empty when it has none. */
  readonly label: string
  /** Free bytes reported by the platform. */
  readonly freeBytes: number
  /** How the platform classifies the volume. */
  readonly kind: 'removable' | 'fixed' | 'network' | 'unknown'
}

/** Why a destination cannot receive the portable edition. */
export type PortableInstallProblem =
  | { readonly kind: 'source-inside-target'; readonly source: string; readonly destination: string }
  | { readonly kind: 'unknown-volume'; readonly destination: string }
  | { readonly kind: 'fixed-volume'; readonly destination: string }
  | { readonly kind: 'occupied-target'; readonly destination: string }
  | { readonly kind: 'insufficient-space'; readonly destination: string; readonly required: number; readonly available: number }

/** Payload measurements. */
export interface PortablePayloadFacts {
  /** Files in the payload directory. */
  readonly files: number
  /** Bytes in the payload directory. */
  readonly bytes: number
}

/**
 * Count files and bytes below a directory.
 * @param root - Directory to measure.
 * @returns Counts, or `undefined` when the directory does not exist.
 */
export async function measurePortablePayload(root: string): Promise<PortablePayloadFacts | undefined> {
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
 * Report why a destination cannot receive the portable edition.
 * @param options - Payload directory, target directory, payload facts, and visible volumes.
 * @returns Problems in the order the operator should fix them; empty when the target is usable.
 */
export async function checkPortableInstallTarget(options: {
  readonly source: string
  readonly destination: string
  readonly payload: PortablePayloadFacts
  readonly volumes: readonly PortableVolume[]
}): Promise<readonly PortableInstallProblem[]> {
  const { source, destination, payload, volumes } = options
  const problems: PortableInstallProblem[] = []
  if (isInside(destination, source)) problems.push({ kind: 'source-inside-target', source, destination })
  const volume = volumes.find(candidate => isInside(candidate.root, destination))
  if (volume === undefined) problems.push({ kind: 'unknown-volume', destination })
  else if (volume.kind === 'fixed') problems.push({ kind: 'fixed-volume', destination })
  else {
    const required = payload.bytes + PORTABLE_INSTALL_SPACE_MARGIN
    if (volume.freeBytes < required) problems.push({ kind: 'insufficient-space', destination, required, available: volume.freeBytes })
  }
  const occupied = await readdir(destination).catch(() => [] as string[])
  if (occupied.length > 0) problems.push({ kind: 'occupied-target', destination })
  return problems
}

/** Result of an installation. */
export interface PortableInstallResult {
  /** Directory the portable edition now runs from. */
  readonly destination: string
  /** Files copied. */
  readonly files: number
  /** Bytes copied. */
  readonly bytes: number
  /** Manifest written into the destination. */
  readonly configFile: string
}

/**
 * Copy the payload into a checked destination and write the manifest.
 * The manifest is written last, so an interrupted copy leaves a directory the
 * next launch reports as incomplete instead of a half-installed edition.
 * @param options - Payload directory, target directory, payload facts, and visible volumes.
 * @returns What was installed.
 * @throws Error naming the problems when the destination is unusable.
 */
export async function installPortableEdition(options: {
  readonly source: string
  readonly destination: string
  readonly payload: PortablePayloadFacts
  readonly volumes: readonly PortableVolume[]
  readonly updateFeed?: string
}): Promise<PortableInstallResult> {
  const { source, destination, payload, updateFeed } = options
  const problems = await checkPortableInstallTarget(options)
  if (problems.length > 0) {
    const described = problems.map((problem) => {
      switch (problem.kind) {
        case 'source-inside-target': return `the payload ${problem.source} is inside the target ${problem.destination}`
        case 'unknown-volume': return `${problem.destination} is not on a volume this machine reports`
        case 'fixed-volume': return `${problem.destination} is on a fixed drive; a portable edition runs from removable media`
        case 'occupied-target': return `${problem.destination} already holds files`
        case 'insufficient-space': return `${problem.destination} needs ${problem.required} free bytes and has ${problem.available}`
        default: return 'the destination is not usable'
      }
    })
    throw new Error(`portable install: ${described.join('; ')}`)
  }
  const app = join(destination, 'app')
  await mkdir(app, { recursive: true })
  await cp(source, app, { recursive: true, force: false, errorOnExist: false, preserveTimestamps: true })
  const copied = await measurePortablePayload(app)
  if (copied === undefined || copied.files !== payload.files || copied.bytes !== payload.bytes) {
    throw new Error(`portable install: copied ${copied?.files ?? 0} files / ${copied?.bytes ?? 0} bytes, expected ${payload.files} / ${payload.bytes}`)
  }
  const configFile = join(destination, PORTABLE_MARKER_FILE)
  await writeFile(configFile, serializePortableConfig({
    ...DEFAULT_PORTABLE_CONFIG,
    ...(updateFeed === undefined ? {} : { updateFeed }),
  }), 'utf8')
  return { destination, files: copied.files, bytes: copied.bytes, configFile }
}

/**
 * Read a manifest the installer previously wrote.
 * @param destination - Installed directory.
 * @returns The manifest text, or `undefined` when the directory holds no manifest.
 */
export async function readInstalledManifest(destination: string): Promise<string | undefined> {
  try {
    return await readFile(join(destination, PORTABLE_MARKER_FILE), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}
