import { describe, expect, it } from 'vitest'
import { DEFAULT_PORTABLE_CONFIG, serializePortableConfig } from '../src/portable/config.ts'
import { appendPortableLog, loadPortableConfig, PortableConfigError, writePortableConfig, type PortableFileSystem } from '../src/portable/store.ts'

/** In-memory filesystem recording writes and copies. */
function memoryFileSystem(files: Record<string, string> = {}) {
  const copies: [string, string][] = []
  const fileSystem: PortableFileSystem = {
    exists: path => path in files,
    readText: (path) => {
      const content = files[path]
      if (content === undefined) throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' })
      return content
    },
    writeText: (path, content) => { files[path] = content },
    appendText: (path, content) => { files[path] = (files[path] ?? '') + content },
    makeDirectory: () => undefined,
    copyFile: (from, to) => { copies.push([from, to]); files[to] = files[from] ?? '' },
  }
  return { fileSystem, files, copies }
}

const configFile = 'E:\\DSH\\portable.json'
const quarantineDirectory = 'E:\\DSH\\backup'

describe('portable manifest storage', () => {
  it('creates the default manifest on first launch', () => {
    const { fileSystem, files } = memoryFileSystem()
    const loaded = loadPortableConfig({ configFile, quarantineDirectory, fileSystem })
    expect(loaded).toEqual({ kind: 'loaded', config: DEFAULT_PORTABLE_CONFIG })
    expect(files[configFile]).toBe(serializePortableConfig(DEFAULT_PORTABLE_CONFIG))
  })

  it('keeps a damaged manifest as evidence and writes defaults', () => {
    const { fileSystem, files, copies } = memoryFileSystem({ [configFile]: '{"portableMode":' })
    const loaded = loadPortableConfig({
      configFile,
      quarantineDirectory,
      fileSystem,
      now: () => new Date('2026-01-02T03:04:05.000Z'),
    })
    expect(loaded.kind).toBe('loaded')
    if (loaded.kind !== 'loaded') return
    expect(loaded.quarantine).toBe('E:\\DSH\\backup\\portable.json.corrupt-2026-01-02T03-04-05-000Z')
    expect(loaded.replaced?.kind).toBe('invalid-json')
    expect(copies).toHaveLength(1)
    expect(files[configFile]).toBe(serializePortableConfig(DEFAULT_PORTABLE_CONFIG))
  })

  it('never rewrites a manifest from a newer layout', () => {
    const broken = JSON.stringify({ ...DEFAULT_PORTABLE_CONFIG, pathVersion: 7 })
    const { fileSystem, files } = memoryFileSystem({ [configFile]: broken })
    const loaded = loadPortableConfig({ configFile, quarantineDirectory, fileSystem })
    expect(loaded).toEqual({ kind: 'failed', problem: { kind: 'unsupported-version', pathVersion: 7 } })
    expect(files[configFile]).toBe(broken)
  })

  it('reports an unreadable manifest instead of replacing it', () => {
    const fileSystem: PortableFileSystem = {
      ...memoryFileSystem().fileSystem,
      exists: () => true,
      readText: () => { throw Object.assign(new Error('EACCES'), { code: 'EACCES' }) },
    }
    expect(() => loadPortableConfig({ configFile, quarantineDirectory, fileSystem }))
      .toThrow(PortableConfigError)
  })

  it('refuses to write a manifest that turns portable mode off', () => {
    const { fileSystem, files } = memoryFileSystem()
    const written = writePortableConfig({ configFile, config: { ...DEFAULT_PORTABLE_CONFIG, portableMode: false }, fileSystem })
    expect(written).toEqual({ kind: 'skipped', reason: 'portable-mode-off' })
    expect(files[configFile]).toBeUndefined()
  })

  it('refuses to write unsafe directories', () => {
    const { fileSystem, files } = memoryFileSystem()
    const written = writePortableConfig({
      configFile,
      config: { ...DEFAULT_PORTABLE_CONFIG, dataDirectory: '..\\Users' },
      fileSystem,
    })
    expect(written.kind).toBe('rejected')
    expect(files[configFile]).toBeUndefined()
  })

  it('writes an accepted manifest with a trailing newline', () => {
    const { fileSystem, files } = memoryFileSystem()
    const written = writePortableConfig({ configFile, config: { ...DEFAULT_PORTABLE_CONFIG, dataDirectory: 'harness' }, fileSystem })
    expect(written).toEqual({ kind: 'written' })
    expect(files[configFile]?.endsWith('\n')).toBe(true)
    expect(files[configFile]).toContain('"dataDirectory": "harness"')
  })

  it('appends timestamped diagnostic lines without a trailing separator', () => {
    const { fileSystem, files } = memoryFileSystem()
    appendPortableLog('E:\\DSH\\logs\\portable\\portable.log', 'first', fileSystem)
    appendPortableLog('E:\\DSH\\logs\\portable\\portable.log', 'second', fileSystem)
    const lines = (files['E:\\DSH\\logs\\portable\\portable.log'] ?? '').split('\n')
    expect(lines).toHaveLength(3)
    expect(lines[2]).toBe('')
    expect(lines[0]).toMatch(/^\S+Z first$/u)
    expect(lines[1]).toMatch(/^\S+Z second$/u)
  })
})
