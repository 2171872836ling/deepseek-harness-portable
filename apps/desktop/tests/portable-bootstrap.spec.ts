import { describe, expect, it } from 'vitest'
import { DEFAULT_PORTABLE_CONFIG, serializePortableConfig } from '../src/portable/config.ts'
import { initializePortableDesktop } from '../src/portable/bootstrap.ts'
import { recordPortableRoot } from '../src/portable/relocation.ts'
import type { PortableFileSystem } from '../src/portable/store.ts'

/** In-memory filesystem recording the paths the bootstrap creates and writes. */
function memoryFileSystem(files: Record<string, string> = {}) {
  const written: string[] = []
  const directories: string[] = []
  const fileSystem: PortableFileSystem = {
    exists: path => path in files,
    readText: path => files[path] ?? '',
    writeText: (path, content) => { files[path] = content; written.push(path) },
    appendText: (path, content) => { files[path] = (files[path] ?? '') + content },
    makeDirectory: (path) => { directories.push(path) },
    copyFile: (from, to) => { files[to] = files[from] ?? '' },
  }
  return { fileSystem, files, written, directories }
}

/** Electron path port that records every redirect. */
function pathPort() {
  const set: [string, string][] = []
  return {
    set,
    app: {
      getPath: (name: 'userData' | 'logs' | 'temp'): string => `C:\\Users\\tester\\AppData\\${name}`,
      setPath: (name: string, path: string): void => { set.push([name, path]) },
    },
  }
}

const marker = 'E:\\DSH\\portable.json'

describe('portable startup', () => {
  it('does nothing when no manifest sits beside the executable', () => {
    const { fileSystem } = memoryFileSystem()
    const paths = pathPort()
    const startup = initializePortableDesktop({
      app: paths.app,
      execPath: 'E:\\DSH\\DSH.exe',
      env: {},
      fileSystem,
    })
    expect(startup).toEqual({ kind: 'absent' })
    expect(paths.set).toEqual([])
  })

  it('redirects Electron paths and the environment onto the volume', () => {
    const { fileSystem, directories } = memoryFileSystem({ [marker]: serializePortableConfig(DEFAULT_PORTABLE_CONFIG) })
    const paths = pathPort()
    const environment: NodeJS.ProcessEnv = { PATH: 'C:\\Windows' }
    const switches: [string, string | undefined][] = []
    const startup = initializePortableDesktop({
      app: paths.app,
      commandLine: { appendSwitch: (name, value) => { switches.push([name, value]) } },
      execPath: 'E:\\DSH\\DSH.exe',
      env: environment,
      fileSystem,
    })
    expect(startup.kind).toBe('active')
    expect(switches).toEqual([['disk-cache-dir', 'E:\\DSH\\cache\\electron\\http']])
    expect(paths.set).toEqual([
      ['userData', 'E:\\DSH\\data\\user-data'],
      ['sessionData', 'E:\\DSH\\data\\user-data'],
      ['logs', 'E:\\DSH\\logs\\application'],
      ['crashDumps', 'E:\\DSH\\cache\\electron\\crash-dumps'],
      ['temp', 'E:\\DSH\\cache\\temporary'],
      ['downloads', 'E:\\DSH\\data\\downloads'],
    ])
    expect(environment.DSH_HOME).toBe('E:\\DSH\\data')
    expect(environment.TEMP).toBe('E:\\DSH\\cache\\temporary')
    expect(directories).toContain('E:\\DSH\\updates\\staging')
  })

  it('stops startup when the volume cannot provide the directories', () => {
    const { fileSystem } = memoryFileSystem({ [marker]: serializePortableConfig(DEFAULT_PORTABLE_CONFIG) })
    const failing: PortableFileSystem = {
      ...fileSystem,
      makeDirectory: (path) => { throw new Error(`denied: ${path}`) },
    }
    const paths = pathPort()
    const startup = initializePortableDesktop({
      app: paths.app,
      execPath: 'E:\\DSH\\DSH.exe',
      env: {},
      fileSystem: failing,
    })
    expect(startup.kind).toBe('failed')
    if (startup.kind !== 'failed') return
    expect(startup.problem.kind).toBe('unusable-directory')
    expect(startup.problem.kind === 'unusable-directory' ? startup.problem.directory : '').toBe('E:\\DSH\\app')
    expect(startup.message).toContain('denied:')
    expect(paths.set).toEqual([])
  })

  it('repairs a damaged manifest and warns', () => {
    const { fileSystem, files } = memoryFileSystem({ [marker]: '{ broken' })
    const startup = initializePortableDesktop({
      app: pathPort().app,
      execPath: 'E:\\DSH\\DSH.exe',
      env: {},
      fileSystem,
      now: () => new Date('2026-01-02T03:04:05.000Z'),
    })
    expect(startup.kind).toBe('active')
    if (startup.kind !== 'active') return
    expect(startup.warnings).toHaveLength(1)
    expect(files['E:\\DSH\\backup\\portable.json.corrupt-2026-01-02T03-04-05-000Z']).toBe('{ broken')
    expect(files[marker]).toBe(serializePortableConfig(recordPortableRoot(DEFAULT_PORTABLE_CONFIG, 'E:\\DSH').config))
    expect(files['E:\\DSH\\logs\\portable\\portable.log']).toContain('replaced unusable portable.json')
  })

  it('refuses a manifest written by a newer layout', () => {
    const { fileSystem } = memoryFileSystem({ [marker]: JSON.stringify({ ...DEFAULT_PORTABLE_CONFIG, pathVersion: 99 }) })
    const startup = initializePortableDesktop({
      app: pathPort().app,
      execPath: 'E:\\DSH\\DSH.exe',
      env: {},
      fileSystem,
    })
    expect(startup.kind).toBe('failed')
    if (startup.kind !== 'failed') return
    expect(startup.problem).toMatchObject({ kind: 'unsupported-version', pathVersion: 99 })
  })

  it('keeps the conventional layout when the manifest opts out', () => {
    const { fileSystem } = memoryFileSystem({
      [marker]: serializePortableConfig({ ...DEFAULT_PORTABLE_CONFIG, portableMode: false }),
    })
    const paths = pathPort()
    const startup = initializePortableDesktop({
      app: paths.app,
      execPath: 'E:\\DSH\\DSH.exe',
      env: {},
      fileSystem,
    })
    expect(startup).toEqual({ kind: 'absent' })
    expect(paths.set).toEqual([])
  })

  it('honours a root override from the environment', () => {
    const other = 'F:\\Portable\\portable.json'
    const { fileSystem } = memoryFileSystem({ [other]: serializePortableConfig(DEFAULT_PORTABLE_CONFIG) })
    const startup = initializePortableDesktop({
      app: pathPort().app,
      execPath: 'E:\\DSH\\DSH.exe',
      env: { DSH_PORTABLE_ROOT: 'F:\\Portable' },
      fileSystem,
    })
    expect(startup.kind).toBe('active')
    if (startup.kind !== 'active') return
    expect(startup.layout.root).toBe('F:\\Portable')
  })

  it('fails loudly for a relative root override', () => {
    const { fileSystem } = memoryFileSystem()
    const startup = initializePortableDesktop({
      app: pathPort().app,
      execPath: 'E:\\DSH\\DSH.exe',
      env: { DSH_PORTABLE_ROOT: 'DSH' },
      fileSystem,
    })
    expect(startup.kind).toBe('failed')
    if (startup.kind !== 'failed') return
    expect(startup.problem.kind).toBe('relative-override')
  })

  it('reports a missing manifest under an explicit override', () => {
    const { fileSystem } = memoryFileSystem()
    const paths = pathPort()
    const startup = initializePortableDesktop({
      app: paths.app,
      execPath: 'E:\\DSH\\DSH.exe',
      env: { DSH_PORTABLE_ROOT: 'F:\\Portable' },
      fileSystem,
    })
    expect(startup.kind).toBe('failed')
    if (startup.kind !== 'failed') return
    expect(startup.problem).toMatchObject({ kind: 'missing-marker', root: 'F:\\Portable' })
    expect(paths.set).toEqual([])
  })

  it('warns when the volume is nearly full but still starts', () => {
    const { fileSystem, files } = memoryFileSystem({ [marker]: serializePortableConfig(DEFAULT_PORTABLE_CONFIG) })
    const startup = initializePortableDesktop({
      app: pathPort().app,
      execPath: 'E:\\DSH\\DSH.exe',
      env: {},
      fileSystem,
      availableBytes: () => 1024,
    })
    expect(startup.kind).toBe('active')
    if (startup.kind !== 'active') return
    expect(startup.warnings).toHaveLength(1)
    expect(startup.warnings[0]).toContain('free bytes')
    expect(files['E:\\DSH\\logs\\portable\\portable.log']).toContain('free bytes')
  })

  it('stays quiet when the volume reports enough space', () => {
    const { fileSystem } = memoryFileSystem({ [marker]: serializePortableConfig(DEFAULT_PORTABLE_CONFIG) })
    const startup = initializePortableDesktop({
      app: pathPort().app,
      execPath: 'E:\\DSH\\DSH.exe',
      env: {},
      fileSystem,
      availableBytes: () => 64 * 1024 ** 3,
    })
    expect(startup.kind).toBe('active')
    if (startup.kind !== 'active') return
    expect(startup.warnings).toEqual([])
  })
})

describe('portable startup without Electron', () => {
  it('tolerates a missing command-line port', () => {
    const { fileSystem } = memoryFileSystem({ [marker]: serializePortableConfig(DEFAULT_PORTABLE_CONFIG) })
    const startup = initializePortableDesktop({
      app: pathPort().app,
      execPath: 'E:\\DSH\\DSH.exe',
      env: {},
      fileSystem,
    })
    expect(startup.kind).toBe('active')
  })
})
