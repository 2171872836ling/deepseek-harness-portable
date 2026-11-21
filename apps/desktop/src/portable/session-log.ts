/**
 * Session log surgery for portable relocation.
 * A Session records the absolute directory it ran in, and the JSONL backend
 * groups sessions under a directory name derived from that path. Moving the
 * volume to a different drive letter therefore leaves both the header and the
 * grouping directory pointing at the old letter. This module reads the header
 * frame of a session artifact, rewrites the recorded directory, and reports the
 * directory name the backend would derive, so relocation can move the group and
 * the header together.
 *
 * The frame and key rules are reimplemented here instead of imported: the
 * desktop shell must run these rewrites before the harness host starts, and the
 * persistence package is a host-side dependency. `projectSessionDirectory`
 * refuses to act unless its output matches the directory on disk, so a future
 * change to the backend's key rule makes relocation skip the group rather than
 * move it somewhere the backend will not look.
 * @module
 */

import { promisify } from 'node:util'
import { constants, zstdCompress, zstdDecompress, type ZstdOptions } from 'node:zlib'

const ZSTD_MAGIC = 0xFD2FB528
const CHECKSUM_OPTIONS: ZstdOptions = { params: { [constants.ZSTD_c_checksumFlag]: 1 } }
const zstdCompressAsync = promisify(zstdCompress)
const zstdDecompressAsync = promisify(zstdDecompress)

/** Byte range occupied by one structurally complete Zstandard frame. */
export interface SessionFrameRange {
  /** Inclusive frame start. */
  readonly start: number
  /** Exclusive frame end. */
  readonly end: number
}

/**
 * Locate the first complete Zstandard frame.
 * @param buffer - Session artifact bytes.
 * @returns The first frame range, or `undefined` when no complete frame is present.
 */
export function firstSessionFrame(buffer: Buffer): SessionFrameRange | undefined {
  let offset = 0
  const start = 0
  if (buffer.length < 5) return undefined
  if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) {
    throw new Error('session log: invalid Zstandard frame magic')
  }
  offset += 4
  const descriptor = buffer.readUInt8(offset)
  offset += 1
  if ((descriptor & 0x18) !== 0) throw new Error('session log: reserved Zstandard frame-header bit')
  const contentSizeFlag = descriptor >>> 6
  const singleSegment = (descriptor & 0x20) !== 0
  const checksum = (descriptor & 0x04) !== 0
  const dictionaryFlag = descriptor & 0x03
  const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
  const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
  offset += (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
  for (;;) {
    if (buffer.length - offset < 3) return undefined
    const blockHeader = buffer.readUIntLE(offset, 3)
    offset += 3
    const lastBlock = (blockHeader & 1) !== 0
    const blockType = (blockHeader >>> 1) & 0x03
    const blockSize = blockHeader >>> 3
    if (blockType === 0x03) throw new Error('session log: reserved Zstandard block type')
    const payloadBytes = blockType === 0x01 ? 1 : blockSize
    if (buffer.length - offset < payloadBytes) return undefined
    offset += payloadBytes
    if (lastBlock) break
  }
  if (checksum) {
    if (buffer.length - offset < 4) return undefined
    offset += 4
  }
  return { start, end: offset }
}

/**
 * Read the first header line of a session artifact.
 * @param bytes - Artifact bytes.
 * @param compressed - Whether the artifact is a concatenated Zstandard stream.
 * @returns The header text without its newline.
 */
export async function readSessionHeaderLine(bytes: Buffer, compressed: boolean): Promise<string> {
  if (!compressed) {
    const newline = bytes.indexOf(0x0a)
    return bytes.subarray(0, newline === -1 ? bytes.length : newline).toString('utf8')
  }
  const frame = firstSessionFrame(bytes)
  if (frame === undefined) throw new Error('session log: no complete header frame')
  const text = (await zstdDecompressAsync(bytes.subarray(frame.start, frame.end))).toString('utf8')
  const newline = text.indexOf('\n')
  return newline === -1 ? text : text.slice(0, newline)
}

/**
 * Build the readable project directory name for a session directory.
 * Mirrors the JSONL backend's rule: separators collapse to `-`, unsafe code
 * units escape as `~XXXX`, and the result is bounded and wrapped in `--`.
 * @param cwd - Absolute session directory.
 * @returns The directory name the backend derives for sessions created there.
 */
export function projectSessionDirectory(cwd: string): string {
  let readable = ''
  let separatorRun = false
  for (let index = 0; index < cwd.length; index++) {
    const code = cwd.charCodeAt(index)
    const character = String.fromCharCode(code)
    if (character === '/' || character === '\\' || character === ':') {
      if (!separatorRun) readable += '-'
      separatorRun = true
    } else if (character !== '~' && /^[A-Za-z0-9._-]$/u.test(character)) {
      readable += character
      separatorRun = false
    } else {
      readable += `~${code.toString(16).toUpperCase().padStart(4, '0')}`
      separatorRun = false
    }
  }
  const slug = readable.replace(/^-+/u, '') || 'root'
  return `--${slug.slice(0, 251)}--`
}

/**
 * Replace one recorded directory in JSON text.
 * The header embeds the path as a JSON string, so the backslashes appear escaped
 * twice over; both spellings are replaced to keep the document valid JSON.
 * @param text - Header text.
 * @param from - Recorded directory.
 * @param to - Replacement directory.
 * @returns The rewritten text, or `undefined` when the directory is absent.
 */
function replaceRecordedPath(text: string, from: string, to: string): string | undefined {
  const escapedFrom = from.replaceAll('\\', '\\\\')
  const escapedTo = to.replaceAll('\\', '\\\\')
  let next = text
  if (escapedFrom !== from && next.includes(escapedFrom)) next = next.split(escapedFrom).join(escapedTo)
  if (next.includes(from)) next = next.split(from).join(to)
  return next === text ? undefined : next
}

/**
 * Rewrite the recorded directory inside a session header frame.
 * The header occupies its own frame, so only that frame is recompressed and the
 * remaining event frames stay byte-identical.
 * @param bytes - Artifact bytes.
 * @param compressed - Whether the artifact is a concatenated Zstandard stream.
 * @param from - Recorded directory to replace.
 * @param to - Directory to record instead.
 * @returns The rewritten artifact, or `undefined` when the frame does not mention `from`.
 */
export async function rewriteSessionHeader(
  bytes: Buffer,
  compressed: boolean,
  from: string,
  to: string,
): Promise<Buffer | undefined> {
  const header = await readSessionHeaderLine(bytes, compressed)
  const rewritten = replaceRecordedPath(header, from, to)
  if (rewritten === undefined) return undefined
  if (!compressed) {
    const newline = bytes.indexOf(0x0a)
    const body = newline === -1 ? Buffer.alloc(0) : bytes.subarray(newline)
    return Buffer.concat([Buffer.from(rewritten, 'utf8'), body])
  }
  const frame = firstSessionFrame(bytes)
  if (frame === undefined) return undefined
  const frameText = (await zstdDecompressAsync(bytes.subarray(frame.start, frame.end))).toString('utf8')
  const newline = frameText.indexOf('\n')
  const head = newline === -1 ? frameText : frameText.slice(0, newline)
  const tail = newline === -1 ? '' : frameText.slice(newline)
  const nextHead = replaceRecordedPath(head, from, to) ?? head
  const encoded = await zstdCompressAsync(Buffer.from(`${nextHead}${tail}`, 'utf8'), CHECKSUM_OPTIONS)
  return Buffer.concat([encoded, bytes.subarray(frame.end)])
}
