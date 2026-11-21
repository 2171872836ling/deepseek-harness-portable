/**
 * Path flavour selection for portable paths.
 * Portable volumes are Windows drives, but the modules that compute them also
 * run under tests on macOS and Linux, so every operation picks Windows or POSIX
 * semantics from the path itself instead of from `process.platform`. Drive
 * letters, UNC prefixes, and backslash separators identify a Windows path.
 * @module
 */

import { posix, win32 } from 'node:path'

/** Path operations used by the portable modules. */
export type PathFlavor = typeof win32

/**
 * Choose the path semantics a path is written in.
 * @param value - Any path; a bare relative name means POSIX.
 * @returns Windows semantics for drive-letter, UNC, or backslash paths, otherwise POSIX.
 */
export function pathFlavor(value: string): PathFlavor {
  if (/^[A-Za-z]:/u.test(value)) return win32
  if (value.startsWith('\\\\') || value.includes('\\')) return win32
  return posix
}
