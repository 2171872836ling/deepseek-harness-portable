import { describe, expect, it } from 'vitest'
import { DEFAULT_PORTABLE_CONFIG, PORTABLE_PATH_VERSION } from '../src/portable/config.ts'
import {
  isInside,
  PortableLayoutError,
  portableApplicationLogs,
  portableDiagnosticLogs,
  portableDirectories,
  portableUpdateBackup,
  portableUpdateDownloads,
  portableUpdateRecord,
  portableUpdateStaging,
  portableUserData,
  portableVersionBackups,
  resolvePortableLayout,
} from '../src/portable/layout.ts'
import { portableEnvironment } from '../src/portable/environment.ts'

const root = 'E:\\DSH'

describe('portable layout', () => {
  it('derives every directory from the manifest', () => {
    const layout = resolvePortableLayout(root, DEFAULT_PORTABLE_CONFIG)
    expect(layout.root).toBe('E:\\DSH')
    expect(layout.app).toBe('E:\\DSH\\app')
    expect(layout.data).toBe('E:\\DSH\\data')
    expect(layout.temp).toBe('E:\\DSH\\cache\\temporary')
    expect(layout.configFile).toBe('E:\\DSH\\portable.json')
    expect(portableUserData(layout)).toBe('E:\\DSH\\data\\user-data')
    expect(portableApplicationLogs(layout)).toBe('E:\\DSH\\logs\\application')
    expect(portableDiagnosticLogs(layout)).toBe('E:\\DSH\\logs\\portable')
    expect(portableUpdateDownloads(layout)).toBe('E:\\DSH\\updates\\downloads')
    expect(portableUpdateStaging(layout)).toBe('E:\\DSH\\updates\\staging')
    expect(portableUpdateBackup(layout)).toBe('E:\\DSH\\updates\\pending-backup')
    expect(portableUpdateRecord(layout)).toBe('E:\\DSH\\updates\\apply.json')
    expect(portableVersionBackups(layout)).toBe('E:\\DSH\\backup\\versions')
  })

  it('accepts an in-volume directory override', () => {
    const layout = resolvePortableLayout(root, { ...DEFAULT_PORTABLE_CONFIG, dataDirectory: 'harness' })
    expect(layout.data).toBe('E:\\DSH\\harness')
  })

  it('refuses a directory that resolves outside the volume', () => {
    let failure: unknown
    try {
      resolvePortableLayout(root, { ...DEFAULT_PORTABLE_CONFIG, dataDirectory: '..\\..\\Users' })
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(PortableLayoutError)
    expect((failure as PortableLayoutError).field).toBe('dataDirectory')
  })

  it('compares paths without relying on the host filesystem case', () => {
    expect(isInside('E:\\DSH', 'e:\\dsh\\data')).toBe(true)
    expect(isInside('E:\\DSH', 'E:\\DSH\\..\\Windows')).toBe(false)
    expect(isInside('E:\\DSH', 'E:\\DSH')).toBe(true)
  })

  it('creates parents before children', () => {
    const directories = portableDirectories(resolvePortableLayout(root, DEFAULT_PORTABLE_CONFIG))
    expect(directories).toContain('E:\\DSH\\data\\user-data')
    expect(directories).toContain('E:\\DSH\\cache\\pnpm-store')
    expect(directories.indexOf('E:\\DSH\\cache')).toBeLessThan(directories.indexOf('E:\\DSH\\cache\\electron'))
    expect(directories.indexOf('E:\\DSH\\updates')).toBeLessThan(directories.indexOf('E:\\DSH\\updates\\downloads'))
  })
})

describe('portable environment', () => {
  it('points the harness home and every cache at the volume', () => {
    const environment = portableEnvironment(resolvePortableLayout(root, DEFAULT_PORTABLE_CONFIG))
    expect(environment).toMatchObject({
      DSH_HOME: 'E:\\DSH\\data',
      DSH_PORTABLE_ROOT: 'E:\\DSH',
      TEMP: 'E:\\DSH\\cache\\temporary',
      TMP: 'E:\\DSH\\cache\\temporary',
      npm_config_cache: 'E:\\DSH\\cache\\npm',
      pnpm_config_store_dir: 'E:\\DSH\\cache\\pnpm-store',
      PIP_CACHE_DIR: 'E:\\DSH\\cache\\python\\pip',
      UV_CACHE_DIR: 'E:\\DSH\\cache\\python\\uv',
      PYTHONPYCACHEPREFIX: 'E:\\DSH\\cache\\python\\pycache',
    })
  })

  it('uses names that survive the plugin subprocess env scrub', () => {
    const environment = portableEnvironment(resolvePortableLayout(root, DEFAULT_PORTABLE_CONFIG))
    expect(Object.keys(environment).filter(key => key.startsWith('DSH_')).sort()).toEqual(['DSH_HOME', 'DSH_PORTABLE_ROOT'])
  })

  it('writes the overrides into the live environment', () => {
    const layout = resolvePortableLayout(root, { ...DEFAULT_PORTABLE_CONFIG, pathVersion: PORTABLE_PATH_VERSION })
    const environment: NodeJS.ProcessEnv = { PATH: 'C:\\Windows' }
    Object.assign(environment, portableEnvironment(layout))
    expect(environment.DSH_HOME).toBe('E:\\DSH\\data')
    expect(environment.PATH).toBe('C:\\Windows')
  })
})
