/**
 * Portable relocation: rewrite state that still names an earlier drive letter.
 * Every derived path is computed from the running executable, but data written
 * while the volume was mounted as `E:` keeps that letter inside configuration
 * files and Session headers. This pass rewrites those records to the current
 * root before the harness host opens them, and records the root history in the
 * manifest so the next launch knows which letters to look for.
 *
 * The pass is conservative: it only edits text files of known configuration
 * formats and session header frames, copies every file it edits into the backup
 * directory first, and reports anything it decided to skip.
 * @module
 */

import { copyFile, mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import type { PortableConfig } from './config.ts'
import { joinPortable, portableDiagnosticLogs, portableVersionBackups, type PortableLayout } from './layout.ts'
import { projectSessionDirectory, readSessionHeaderLine, rewriteSessionHeader } from './session-log.ts'

/** Old roots remembered in the manifest; enough to survive a few drive letters. */
export const PORTABLE_ROOT_HISTORY_LIMIT = 5

/** Text formats this pass is willing to rewrite. */
const RELOCATABLE_EXTENSIONS = new Set(['.json', '.jsonc', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.txt'])

/** Directories never scanned: dependencies, history, and session artifacts. */
const SKIPPED_DIRECTORIES = new Set(['node_modules', '.git', 'sessions'])

/** Largest file this pass reads into memory. */
const MAX_RELOCATABLE_BYTES = 2 * 1024 * 1024

/** Session artifact suffixes produced by the JSONL backend. */
const SESSION_ARTIFACTS = ['.jsonl', '.jsonl.zstd'] as const

/**
 * Add the running root to the manifest's root history.
 * @param config - Accepted manifest.
 * @param root - Root derived from the running executable.
 * @returns The manifest to persist and whether it changed.
 */
export function recordPortableRoot(config: PortableConfig, root: string): { config: PortableConfig; changed: boolean } {
  const history = [...(config.rootHistory ?? [])]
  const known = history.some(entry => entry.toLowerCase() === root.toLowerCase())
  if (known && history[history.length - 1]?.toLowerCase() === root.toLowerCase()) return { config, changed: false }
  const next = [...history.filter(entry => entry.toLowerCase() !== root.toLowerCase()), root]
  return { config: { ...config, rootHistory: next.slice(-PORTABLE_ROOT_HISTORY_LIMIT) }, changed: true }
}

/**
 * Roots this installation ran from before, longest first.
 * @param config - Accepted manifest.
 * @param root - Root derived from the running executable.
 * @returns Earlier roots that still name a different drive or path.
 */
export function stalePortableRoots(config: PortableConfig, root: string): readonly string[] {
  const seen = new Set<string>()
  const roots: string[] = []
  for (const entry of config.rootHistory ?? []) {
    if (entry.toLowerCase() === root.toLowerCase()) continue
    const key = entry.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    roots.push(entry)
  }
  return roots.sort((left, right) => right.length - left.length)
}

/**
 * Replace every earlier root inside one text value.
 * Both separators and the JSON-escaped spelling are handled because the same
 * path appears raw in YAML/TOML and doubly escaped in JSON.
 * @param text - File content.
 * @param roots - Earlier roots, longest first.
 * @param root - Current root.
 * @returns The rewritten content, or `undefined` when nothing matched.
 */
export function replacePortableRoots(
  text: string,
  roots: readonly string[],
  root: string,
): string | undefined {
  let rewritten = text
  let matched = false
  for (const stale of roots) {
    const spellings = new Set([
      stale,
      stale.replaceAll('\\', '/'),
      stale.replaceAll('\\', '\\\\'),
      stale.replaceAll('\\', '\\\\').replaceAll('/', '\\/'),
    ])
    for (const spelling of spellings) {
      if (spelling === '' || !rewritten.includes(spelling)) continue
      const replacement = spelling === stale
        ? root
        : spelling.includes('\\\\')
          ? root.replaceAll('\\', '\\\\')
          : root.replaceAll('\\', '/')
      rewritten = rewritten.split(spelling).join(replacement)
      matched = true
    }
  }
  return matched ? rewritten : undefined
}

/** One Session group moved to a directory the backend derives from the new root. */
export interface SessionGroupRelocation {
  /** Current absolute group directory. */
  readonly directory: string
  /** Group directory name after relocation. */
  readonly name: string
  /** Recorded directory before relocation. */
  readonly cwd: string
  /** Recorded directory after relocation. */
  readonly nextCwd: string
  /** Artifacts rewritten in the group. */
  readonly rewritten: readonly string[]
}

/** Outcome of the relocation pass. */
export interface PortableRelocation {
  /** `untouched` when no earlier root applied to this volume. */
  readonly kind: 'untouched' | 'relocated'
  /** Earlier roots that were looked for. */
  readonly roots: readonly string[]
  /** Rewritten configuration files. */
  readonly files: readonly string[]
  /** Relocated Session groups. */
  readonly groups: readonly SessionGroupRelocation[]
  /** Diagnostic log written when anything changed. */
  readonly logFile?: string
  /** Paths the pass refused to touch, with the reason. */
  readonly skipped: readonly { readonly path: string; readonly reason: string }[]
}

/**
 * Whether a file name has a format this pass may rewrite.
 * @param name - File name without its directory.
 * @returns `true` for configuration text formats.
 */
function relocatableFileName(name: string): boolean {
  const lower = name.toLowerCase()
  for (const extension of RELOCATABLE_EXTENSIONS) {
    if (lower.endsWith(extension)) return true
  }
  return false
}

/**
 * Recursively collect configuration files that may name an earlier root.
 * @param directory - Directory to walk.
 * @param skip - Directories to skip by name.
 * @returns Absolute file paths in walk order.
 */
async function collectConfigFiles(directory: string, skip: ReadonlySet<string>): Promise<string[]> {
  const found: string[] = []
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return found
    throw error
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      if (skip.has(entry.name)) continue
      found.push(...await collectConfigFiles(path, skip))
      continue
    }
    if (entry.isFile() && relocatableFileName(entry.name)) found.push(path)
  }
  return found
}

/**
 * Relocate Session groups whose recorded directory names an earlier root.
 * The group name must match the name the backend derives from the recorded
 * directory; otherwise the group is skipped, because moving it would hide the
 * Session from the backend instead of repairing it.
 * @param options - Session root, earlier roots, current root, and the backup directory.
 * @returns Relocated groups and skipped paths.
 */
async function relocateSessionGroups(options: {
  readonly sessionsRoot: string
  readonly roots: readonly string[]
  readonly root: string
  readonly backupDirectory: string
  readonly stamp: string
}): Promise<{ groups: SessionGroupRelocation[]; skipped: { path: string; reason: string }[] }> {
  const { sessionsRoot, roots, root, backupDirectory, stamp } = options
  const groups: SessionGroupRelocation[] = []
  const skipped: { path: string; reason: string }[] = []
  let entries
  try {
    entries = await readdir(sessionsRoot, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { groups, skipped }
    throw error
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('--')) continue
    const directory = join(sessionsRoot, entry.name)
    const sessions = (await readdir(directory, { withFileTypes: true })).filter(item => item.isDirectory())
    const artifacts = await findSessionArtifacts(directory, sessions.map(item => item.name))
    if (artifacts.length === 0) continue
    const first = artifacts[0]
    if (first === undefined) continue
    const bytes = await readFile(first)
    const compressed = first.endsWith('.zstd')
    const cwd = recordedCwd(await readSessionHeaderLine(bytes, compressed))
    if (cwd === undefined) continue
    const nextCwd = relocatedPath(cwd, roots, root)
    if (nextCwd === undefined) continue
    if (projectSessionDirectory(cwd) !== entry.name) {
      skipped.push({ path: directory, reason: 'group directory does not match its recorded directory' })
      continue
    }
    const name = projectSessionDirectory(nextCwd)
    const target = join(sessionsRoot, name)
    if (target.toLowerCase() !== directory.toLowerCase()) {
      try {
        await stat(target)
        skipped.push({ path: directory, reason: `target group ${target} already exists` })
        continue
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
    const rewritten: string[] = []
    for (const artifact of artifacts) {
      const original = await readFile(artifact)
      const next = await rewriteSessionHeader(original, artifact.endsWith('.zstd'), cwd, nextCwd)
      if (next === undefined) continue
      const backup = join(backupDirectory, 'sessions', stamp, relative(sessionsRoot, artifact))
      await mkdir(dirname(backup), { recursive: true })
      await copyFile(artifact, backup)
      await writeFile(artifact, next)
      rewritten.push(artifact)
    }
    if (target.toLowerCase() !== directory.toLowerCase()) {
      await mkdir(dirname(target), { recursive: true })
      await rename(directory, target)
    }
    groups.push({ directory, name, cwd, nextCwd, rewritten })
  }
  return { groups, skipped }
}

/**
 * List the header artifacts of one Session group.
 * @param directory - Group directory.
 * @param sessions - Session directory names inside the group.
 * @returns Absolute artifact paths.
 */
async function findSessionArtifacts(directory: string, sessions: readonly string[]): Promise<string[]> {
  const artifacts: string[] = []
  for (const session of sessions) {
    const entries = await readdir(join(directory, session), { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile()) continue
      if (!SESSION_ARTIFACTS.some(suffix => entry.name.endsWith(suffix))) continue
      artifacts.push(join(directory, session, entry.name))
    }
  }
  return artifacts
}

/**
 * Read the recorded directory from a Session header line.
 * @param line - Header JSON text.
 * @returns The recorded directory, or `undefined` when the header has none.
 */
function recordedCwd(line: string): string | undefined {
  try {
    const header: unknown = JSON.parse(line)
    if (typeof header !== 'object' || header === null) return undefined
    const cwd = (header as { cwd?: unknown }).cwd
    return typeof cwd === 'string' && cwd.length > 0 ? cwd : undefined
  } catch {
    return undefined
  }
}

/**
 * Rewrite one recorded directory onto the current root.
 * @param cwd - Recorded directory.
 * @param roots - Earlier roots, longest first.
 * @param root - Current root.
 * @returns The relocated directory, or `undefined` when no earlier root matches.
 */
function relocatedPath(cwd: string, roots: readonly string[], root: string): string | undefined {
  const lower = cwd.toLowerCase()
  for (const stale of roots) {
    const staleLower = stale.toLowerCase()
    if (!lower.startsWith(staleLower)) continue
    if (lower.length !== staleLower.length && !/[\\/]/u.test(cwd.charAt(stale.length))) continue
    return root + cwd.slice(stale.length)
  }
  return undefined
}

/**
 * Rewrite state that still names an earlier drive letter.
 * @param options - Layout, manifest, current root, and clock.
 * @returns What was rewritten, or `untouched` when no earlier root applies.
 */
export async function relocatePortableState(options: {
  readonly layout: PortableLayout
  readonly config: PortableConfig
  readonly root: string
  readonly now?: () => Date
}): Promise<PortableRelocation> {
  const { layout, config, root } = options
  const now = options.now ?? (() => new Date())
  const roots = stalePortableRoots(config, root)
  if (roots.length === 0) return { kind: 'untouched', roots, files: [], groups: [], skipped: [] }

  const stamp = now().toISOString().replace(/[:.]/gu, '-')
  const backupDirectory = join(portableVersionBackups(layout), '..', 'relocation')
  const files: string[] = []
  const skipped: { path: string; reason: string }[] = []
  for (const file of await collectConfigFiles(layout.data, SKIPPED_DIRECTORIES)) {
    const info = await stat(file)
    if (info.size > MAX_RELOCATABLE_BYTES) {
      skipped.push({ path: file, reason: 'file is larger than the relocation limit' })
      continue
    }
    const text = await readFile(file, 'utf8')
    const rewritten = replacePortableRoots(text, roots, root)
    if (rewritten === undefined) continue
    const backup = join(backupDirectory, stamp, relative(layout.data, file))
    await mkdir(dirname(backup), { recursive: true })
    await copyFile(file, backup)
    await writeFile(file, rewritten, 'utf8')
    files.push(file)
  }

  const sessions = await relocateSessionGroups({
    sessionsRoot: joinPortable(layout.data, 'sessions'),
    roots,
    root,
    backupDirectory,
    stamp,
  })
  skipped.push(...sessions.skipped)

  if (files.length === 0 && sessions.groups.length === 0) {
    return { kind: 'relocated', roots, files, groups: [], skipped }
  }

  const logDirectory = portableDiagnosticLogs(layout)
  await mkdir(logDirectory, { recursive: true })
  const logFile = joinPortable(logDirectory, `relocation-${stamp}.log`)
  const lines = [
    `portable relocation ${now().toISOString()}`,
    `current root: ${root}`,
    ...roots.map(stale => `earlier root: ${stale}`),
    ...files.map(file => `rewrote ${file}`),
    ...sessions.groups.map(group => `moved session group ${group.directory} -> ${group.name} (${group.rewritten.length} artifact(s))`),
    ...skipped.map(entry => `skipped ${entry.path}: ${entry.reason}`),
  ]
  await writeFile(logFile, `${lines.join('\n')}\n`, 'utf8')
  return { kind: 'relocated', roots, files, groups: sessions.groups, logFile, skipped }
}
