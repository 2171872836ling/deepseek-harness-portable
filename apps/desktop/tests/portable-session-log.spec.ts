import { zstdCompressSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import {
  firstSessionFrame,
  projectSessionDirectory,
  readSessionHeaderLine,
  rewriteSessionHeader,
} from '../src/portable/session-log.ts'

/** Header text recorded by the JSONL backend for a session created on the volume. */
const header = `${JSON.stringify({
  type: 'session',
  version: 4,
  id: 'session-1',
  createdAt: 1,
  cwd: 'E:\\DSH\\data\\profiles\\desktop',
  isSeeded: false,
  delegationDepth: 0,
})}\n`

/** One durable event batch appended after the header. */
const batch = '{"type":"user/message","seq":1}\n'

describe('portable session log', () => {
  it('derives the project directory name the backend would use', () => {
    expect(projectSessionDirectory('E:\\DSH\\data')).toBe('--E-DSH-data--')
    expect(projectSessionDirectory('/work')).toBe('--work--')
    expect(projectSessionDirectory('/a b')).toBe('--a~0020b--')
    expect(projectSessionDirectory('/a//b')).toBe('--a-b--')
  })

  it('locates the first frame of a concatenated stream', () => {
    const frame = zstdCompressSync(Buffer.from(header))
    const bytes = Buffer.concat([frame, zstdCompressSync(Buffer.from(batch))])
    expect(firstSessionFrame(bytes)).toEqual({ start: 0, end: frame.length })
  })

  it('reports an incomplete frame instead of guessing', () => {
    expect(firstSessionFrame(Buffer.from([1, 2, 3]))).toBeUndefined()
  })

  it('rejects a stream that does not start with a Zstandard frame', () => {
    expect(() => firstSessionFrame(Buffer.from('not-zstd-at-all'))).toThrow(/frame magic/u)
  })

  it('reads the header of a plain JSONL artifact', async () => {
    const bytes = Buffer.from(`${header}${batch}`)
    expect(JSON.parse(await readSessionHeaderLine(bytes, false))).toMatchObject({ cwd: 'E:\\DSH\\data\\profiles\\desktop' })
  })

  it('rewrites the header of a compressed artifact and leaves event frames byte-identical', async () => {
    const eventFrame = zstdCompressSync(Buffer.from(batch))
    const bytes = Buffer.concat([zstdCompressSync(Buffer.from(header)), eventFrame])
    const rewritten = await rewriteSessionHeader(bytes, true, 'E:\\DSH', 'F:\\DSH')
    expect(rewritten).toBeDefined()
    if (rewritten === undefined) return
    const frame = firstSessionFrame(rewritten)
    expect(frame).toBeDefined()
    if (frame === undefined) return
    expect(rewritten.subarray(frame.end)).toEqual(eventFrame)
    expect(JSON.parse(await readSessionHeaderLine(rewritten, true))).toMatchObject({ cwd: 'F:\\DSH\\data\\profiles\\desktop' })
  })

  it('rewrites a plain artifact header in place', async () => {
    const rewritten = await rewriteSessionHeader(Buffer.from(`${header}${batch}`), false, 'E:\\DSH', 'F:\\DSH')
    const text = rewritten?.toString('utf8') ?? ''
    expect(JSON.parse(text.split('\n')[0] ?? '')).toMatchObject({ cwd: 'F:\\DSH\\data\\profiles\\desktop' })
    expect(text.endsWith(batch)).toBe(true)
  })

  it('reports no rewrite when the header never names the earlier root', async () => {
    const bytes = Buffer.concat([zstdCompressSync(Buffer.from(header))])
    expect(await rewriteSessionHeader(bytes, true, 'G:\\USB', 'F:\\DSH')).toBeUndefined()
  })
})
