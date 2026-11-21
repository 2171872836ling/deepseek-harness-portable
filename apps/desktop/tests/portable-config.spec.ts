import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PORTABLE_CONFIG,
  parsePortableConfig,
  parsePortableConfigValue,
  PORTABLE_PATH_VERSION,
  portableDirectoryProblem,
  serializePortableConfig,
} from '../src/portable/config.ts'

describe('portable manifest directories', () => {
  it('accepts a plain relative segment', () => {
    expect(portableDirectoryProblem('data')).toBeUndefined()
    expect(portableDirectoryProblem('cache\\temporary')).toBeUndefined()
  })

  it('rejects empty, absolute, drive-relative, UNC, and traversal values', () => {
    expect(portableDirectoryProblem('')).toBe('empty')
    expect(portableDirectoryProblem('   ')).toBe('empty')
    expect(portableDirectoryProblem('C:\\dsh\\data')).toBe('absolute')
    expect(portableDirectoryProblem('/var/dsh')).toBe('absolute')
    expect(portableDirectoryProblem('C:data')).toBe('drive')
    expect(portableDirectoryProblem('\\\\server\\share\\data')).toBe('absolute')
    expect(portableDirectoryProblem('data\\..\\..\\Windows')).toBe('traversal')
  })
})

describe('portable manifest parsing', () => {
  it('round-trips the default manifest with a trailing newline', () => {
    const text = serializePortableConfig(DEFAULT_PORTABLE_CONFIG)
    expect(text.endsWith('\n')).toBe(true)
    const parsed = parsePortableConfig(text)
    expect(parsed).toEqual({ ok: true, config: DEFAULT_PORTABLE_CONFIG })
  })

  it('reports invalid JSON without echoing the document', () => {
    const parsed = parsePortableConfig('{ not json')
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.problem.kind).toBe('invalid-json')
  })

  it('reports a value that is not an object', () => {
    const parsed = parsePortableConfigValue(['data'])
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.problem.kind).toBe('invalid-structure')
  })

  it('names the field of an unsafe directory', () => {
    const parsed = parsePortableConfigValue({ ...DEFAULT_PORTABLE_CONFIG, cacheDirectory: 'D:\\cache' })
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.problem).toEqual({
      kind: 'unsafe-directory',
      field: 'cacheDirectory',
      value: 'D:\\cache',
      reason: 'absolute',
    })
  })

  it('rejects a newer pathVersion instead of guessing its layout', () => {
    const parsed = parsePortableConfigValue({ ...DEFAULT_PORTABLE_CONFIG, pathVersion: PORTABLE_PATH_VERSION + 1 })
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.problem).toEqual({ kind: 'unsupported-version', pathVersion: PORTABLE_PATH_VERSION + 1 })
  })

  it('treats portableMode false as a manifest, not portable mode', () => {
    const parsed = parsePortableConfigValue({ ...DEFAULT_PORTABLE_CONFIG, portableMode: false })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.config.portableMode).toBe(false)
  })

  it('keeps unknown fields so a newer build can add them', () => {
    const parsed = parsePortableConfigValue({ ...DEFAULT_PORTABLE_CONFIG, futureField: 'kept' })
    expect(parsed.ok).toBe(true)
  })
})
