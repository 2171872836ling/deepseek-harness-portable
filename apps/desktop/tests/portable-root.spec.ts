import { expect, it } from 'vitest'
import { findPortableRoot, PORTABLE_MARKER_FILE, PORTABLE_ROOT_ENV } from '../src/portable/root.ts'

const existsIn = (...paths: readonly string[]) => (candidate: string): boolean => paths.includes(candidate)

it('finds a marker beside the executable and one directory above it', () => {
  const besideExecutable = findPortableRoot({
    execPath: 'E:\\DSH\\DSH.exe',
    env: {},
    exists: existsIn('E:\\DSH\\portable.json'),
  })
  expect(besideExecutable).toEqual({ kind: 'found', root: 'E:\\DSH', marker: 'E:\\DSH\\portable.json' })

  const aboveExecutable = findPortableRoot({
    execPath: 'E:\\DSH\\app\\DSH.exe',
    env: {},
    exists: existsIn('E:\\DSH\\portable.json'),
  })
  expect(aboveExecutable).toEqual({ kind: 'found', root: 'E:\\DSH', marker: 'E:\\DSH\\portable.json' })
})

it('reports absence for a conventionally installed application', () => {
  expect(findPortableRoot({ execPath: 'C:\\Program Files\\DeepSeek Harness\\DSH.exe', env: {}, exists: () => false }))
    .toEqual({ kind: 'absent' })
})

it('prefers the configured root over proximity and rejects a missing or relative override', () => {
  const found = findPortableRoot({
    execPath: 'E:\\DSH\\DSH.exe',
    env: { [PORTABLE_ROOT_ENV]: 'G:\\portable' },
    exists: existsIn('G:\\portable\\portable.json', 'E:\\DSH\\portable.json'),
  })
  expect(found).toEqual({ kind: 'found', root: 'G:\\portable', marker: 'G:\\portable\\portable.json' })

  expect(findPortableRoot({
    execPath: 'E:\\DSH\\DSH.exe',
    env: { [PORTABLE_ROOT_ENV]: 'G:\\portable' },
    exists: () => false,
  })).toEqual({ kind: 'invalid', root: 'G:\\portable', problem: 'missing-marker' })

  expect(findPortableRoot({
    execPath: 'E:\\DSH\\DSH.exe',
    env: { [PORTABLE_ROOT_ENV]: 'portable' },
    exists: () => true,
  })).toEqual({ kind: 'invalid', root: 'portable', problem: 'relative-override' })
})

it('ignores a blank override so an empty variable keeps marker discovery', () => {
  expect(findPortableRoot({
    execPath: 'E:\\DSH\\DSH.exe',
    env: { [PORTABLE_ROOT_ENV]: '   ' },
    exists: existsIn('E:\\DSH\\portable.json'),
  })).toEqual({ kind: 'found', root: 'E:\\DSH', marker: `E:\\DSH\\${PORTABLE_MARKER_FILE}` })
})
