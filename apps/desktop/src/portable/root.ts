/**
 * Portable-root discovery for the Windows portable edition.
 * A `portable.json` marker beside the executable (or one directory above it,
 * for installs whose executable sits in `app\`) switches the desktop shell into
 * portable mode; every derived directory then hangs off that root, so the drive
 * letter may change between runs without invalidating stored state.
 * @module
 */

import { isAbsolute } from 'node:path'
import { pathFlavor } from './paths.ts'

/** Marker file whose presence switches the desktop shell into portable mode. */
export const PORTABLE_MARKER_FILE = 'portable.json'

/** Environment variable that overrides marker discovery for automation. */
export const PORTABLE_ROOT_ENV = 'DSH_PORTABLE_ROOT'

/** Why a configured portable root was rejected. */
export type PortableRootProblem = 'missing-marker' | 'relative-override'

/** Outcome of looking for a portable marker. */
export type PortableRootDiscovery =
  | { readonly kind: 'absent' }
  | { readonly kind: 'found'; readonly root: string; readonly marker: string }
  | { readonly kind: 'invalid'; readonly root: string; readonly problem: PortableRootProblem }

/** Inputs of marker discovery. */
export interface PortableRootSources {
  /** Path of the running executable (`process.execPath`). */
  readonly execPath: string
  /** Environment holding the optional {@link PORTABLE_ROOT_ENV} override. */
  readonly env: Readonly<Record<string, string | undefined>>
  /** Filesystem existence probe, injected so discovery stays Electron-free. */
  readonly exists: (path: string) => boolean
}

/**
 * Locate the portable root that governs this process.
 * The override wins over proximity, because an operator who names a root means
 * it; a missing marker under an explicit override is an error rather than a
 * silent fallback to the conventional per-user home.
 * @param sources - Executable path, environment, and existence probe.
 * @returns The discovered root, or `absent` for a conventionally installed app.
 */
export function findPortableRoot(sources: PortableRootSources): PortableRootDiscovery {
  const override = sources.env[PORTABLE_ROOT_ENV]?.trim()
  if (override !== undefined && override !== '') {
    const flavor = pathFlavor(override)
    if (!flavor.isAbsolute(override) && !isAbsolute(override)) {
      return { kind: 'invalid', root: override, problem: 'relative-override' }
    }
    const root = flavor.resolve(override)
    const marker = flavor.join(root, PORTABLE_MARKER_FILE)
    return sources.exists(marker) ? { kind: 'found', root, marker } : { kind: 'invalid', root, problem: 'missing-marker' }
  }
  const flavor = pathFlavor(sources.execPath)
  const executableDirectory = flavor.dirname(sources.execPath)
  for (const candidate of [executableDirectory, flavor.dirname(executableDirectory)]) {
    const marker = flavor.join(candidate, PORTABLE_MARKER_FILE)
    if (sources.exists(marker)) return { kind: 'found', root: candidate, marker }
  }
  return { kind: 'absent' }
}
