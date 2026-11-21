import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdCompressSync } from 'node:zlib'
import { onTestFinished, describe, expect, it } from 'vitest'
import { DEFAULT_PORTABLE_CONFIG, type PortableConfig } from '../src/portable/config.ts'
import { resolvePortableLayout, portableVersionBackups } from '../src/portable/layout.ts'
import {
  PORTABLE_ROOT_HISTORY_LIMIT,
  recordPortableRoot,
  relocatePortableState,
  replacePortableRoots,
  stalePortableRoots,
} from '../src/portable/relocation.ts'
import { projectSessionDirectory } from '../src/portable/session-log.ts'

/** Create a layout rooted in a fresh temporary directory. */
async function temporaryLayout(prefix: string) {
  const root = await mkdtemp(join(tmpdir(), prefix))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  return resolvePortableLayout(root, DEFAULT_PORTABLE_CONFIG)
}

/** Manifest that ran from the E: volume before the drive letter changed. */
const movedConfig: PortableConfig = { ...DEFAULT_PORTABLE_CONFIG, rootHistory: ['E:\\DSH'] }

describe('portable root history', () => {
  it('appends the running root and reports the change', () => {
    const first = recordPortableRoot(DEFAULT_PORTABLE_CONFIG, 'E:\\DSH')
    expect(first.changed).toBe(true)
    expect(first.config.rootHistory).toEqual(['E:\\DSH'])
  })

  it('leaves the manifest alone when the root is already the newest entry', () => {
    const recorded = recordPortableRoot(DEFAULT_PORTABLE_CONFIG, 'E:\\DSH').config
    const again = recordPortableRoot(recorded, 'e:\\dsh')
    expect(again.changed).toBe(false)
    expect(again.config.rootHistory).toEqual(['E:\\DSH'])
  })

  it('keeps the history bounded, newest last', () => {
    let config: PortableConfig = DEFAULT_PORTABLE_CONFIG
    for (const root of ['E:\\DSH', 'F:\\DSH', 'G:\\DSH', 'H:\\DSH', 'I:\\DSH', 'J:\\DSH']) {
      config = recordPortableRoot(config, root).config
    }
    expect(config.rootHistory).toHaveLength(PORTABLE_ROOT_HISTORY_LIMIT)
    expect(config.rootHistory?.at(-1)).toBe('J:\\DSH')
    expect(config.rootHistory).not.toContain('E:\\DSH')
  })

  it('lists earlier roots longest first and skips the running one', () => {
    const config: PortableConfig = { ...DEFAULT_PORTABLE_CONFIG, rootHistory: ['E:\\DSH', 'E:\\DSH\\nested', 'F:\\DSH'] }
    expect(stalePortableRoots(config, 'F:\\DSH')).toEqual(['E:\\DSH\\nested', 'E:\\DSH'])
  })

  it('rewrites raw, forward-slash, and JSON-escaped spellings', () => {
    const roots = ['E:\\DSH']
    expect(replacePortableRoots('cwd: E:\\DSH\\data', roots, 'F:\\DSH')).toBe('cwd: F:\\DSH\\data')
    expect(replacePortableRoots('path: E:/DSH/data', roots, 'F:\\DSH')).toBe('path: F:/DSH/data')
    expect(replacePortableRoots('{"cwd":"E:\\\\DSH\\\\data"}', roots, 'F:\\DSH')).toBe('{"cwd":"F:\\\\DSH\\\\data"}')
  })

  it('reports nothing to rewrite for unrelated text', () => {
    expect(replacePortableRoots('cwd: C:\\work', ['E:\\DSH'], 'F:\\DSH')).toBeUndefined()
  })
})

describe('portable relocation pass', () => {
  it('does nothing when no earlier root is recorded', async () => {
    const layout = await temporaryLayout('dsh-portable-relocation-none-')
    const result = await relocatePortableState({ layout, config: DEFAULT_PORTABLE_CONFIG, root: layout.root })
    expect(result).toEqual({ kind: 'untouched', roots: [], files: [], groups: [], skipped: [] })
  })

  it('rewrites configuration files that name the earlier root', async () => {
    const layout = await temporaryLayout('dsh-portable-relocation-config-')
    await mkdir(join(layout.data, 'profiles', 'desktop'), { recursive: true })
    const settings = join(layout.data, 'profiles', 'desktop', 'settings.json')
    await writeFile(settings, `${JSON.stringify({ cwd: 'E:\\DSH\\data\\profiles\\desktop' }, null, 2)}\n`, 'utf8')
    const untouched = join(layout.data, 'profiles', 'desktop', 'notes.txt')
    await writeFile(untouched, 'nothing to relocate\n', 'utf8')

    const result = await relocatePortableState({
      layout,
      config: movedConfig,
      root: 'F:\\DSH',
      now: () => new Date('2026-01-02T03:04:05.000Z'),
    })
    expect(result.kind).toBe('relocated')
    expect(result.files).toEqual([settings])
    const rewritten = JSON.parse(await readFile(settings, 'utf8')) as { cwd: string }
    expect(rewritten.cwd).toBe('F:\\DSH\\data\\profiles\\desktop')
    expect(await readFile(untouched, 'utf8')).toBe('nothing to relocate\n')
    expect(result.logFile).toBeDefined()
    if (result.logFile === undefined) return
    expect(await readFile(result.logFile, 'utf8')).toContain(`rewrote ${settings}`)
    const backups = await readdir(join(portableVersionBackups(layout), '..', 'relocation', '2026-01-02T03-04-05-000Z', 'profiles', 'desktop'))
    expect(backups).toEqual(['settings.json'])
  })

  it('moves a session group and rewrites its header', async () => {
    const layout = await temporaryLayout('dsh-portable-relocation-sessions-')
    const cwd = 'E:\\DSH\\data\\profiles\\desktop'
    const nextCwd = 'F:\\DSH\\data\\profiles\\desktop'
    const sessionsRoot = join(layout.data, 'sessions')
    const group = join(sessionsRoot, projectSessionDirectory(cwd))
    await mkdir(join(group, 'session-1'), { recursive: true })
    const header = `${JSON.stringify({ type: 'session', version: 4, id: 'session-1', createdAt: 1, cwd })}\n`
    const event = zstdCompressSync(Buffer.from('{"type":"user/message","seq":1}\n'))
    await writeFile(join(group, 'session-1', 'session-4.jsonl.zstd'), Buffer.concat([zstdCompressSync(Buffer.from(header)), event]))

    const result = await relocatePortableState({
      layout,
      config: movedConfig,
      root: 'F:\\DSH',
      now: () => new Date('2026-01-02T03:04:05.000Z'),
    })
    expect(result.groups).toHaveLength(1)
    const [relocated] = result.groups
    expect(relocated?.name).toBe(projectSessionDirectory(nextCwd))
    const entries = await readdir(sessionsRoot)
    expect(entries).toEqual([projectSessionDirectory(nextCwd)])
    const artifact = join(sessionsRoot, projectSessionDirectory(nextCwd), 'session-1', 'session-4.jsonl.zstd')
    const { readSessionHeaderLine } = await import('../src/portable/session-log.ts')
    const recorded = JSON.parse(await readSessionHeaderLine(await readFile(artifact), true)) as { cwd: string }
    expect(recorded.cwd).toBe(nextCwd)
  })

  it('skips a group whose directory does not match its recorded directory', async () => {
    const layout = await temporaryLayout('dsh-portable-relocation-mismatch-')
    const cwd = 'E:\\DSH\\data\\profiles\\desktop'
    const group = join(layout.data, 'sessions', '--unexpected--')
    await mkdir(join(group, 'session-1'), { recursive: true })
    const header = `${JSON.stringify({ type: 'session', version: 4, id: 'session-1', createdAt: 1, cwd })}\n`
    await writeFile(join(group, 'session-1', 'session-4.jsonl'), header)
    const result = await relocatePortableState({ layout, config: movedConfig, root: 'F:\\DSH' })
    expect(result.groups).toEqual([])
    expect(result.skipped).toEqual([
      { path: group, reason: 'group directory does not match its recorded directory' },
    ])
  })

  it('skips a group whose relocated directory already exists', async () => {
    const layout = await temporaryLayout('dsh-portable-relocation-conflict-')
    const cwd = 'E:\\DSH\\data\\profiles\\desktop'
    const nextCwd = 'F:\\DSH\\data\\profiles\\desktop'
    const sessionsRoot = join(layout.data, 'sessions')
    const group = join(sessionsRoot, projectSessionDirectory(cwd))
    await mkdir(join(group, 'session-1'), { recursive: true })
    const header = `${JSON.stringify({ type: 'session', version: 4, id: 'session-1', createdAt: 1, cwd })}\n`
    await writeFile(join(group, 'session-1', 'session-4.jsonl'), header)
    await mkdir(join(sessionsRoot, projectSessionDirectory(nextCwd)), { recursive: true })
    const result = await relocatePortableState({ layout, config: movedConfig, root: 'F:\\DSH' })
    expect(result.groups).toEqual([])
    expect(result.skipped[0]?.reason).toContain('already exists')
  })
})
