/** Assemble the Windows portable edition from an unpacked Desktop build. */

import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { DEFAULT_PORTABLE_CONFIG, serializePortableConfig, type PortableConfig } from '../src/portable/config.ts'
import { PORTABLE_MARKER_FILE } from '../src/portable/root.ts'
import { portableDirectories, resolvePortableLayout } from '../src/portable/layout.ts'

/** Directory electron-builder wrote for an unpacked Windows build. */
export const UNPACKED_DIRECTORY_NAME = 'win-unpacked'

/**
 * Name the archive a portable release ships as.
 * @param {string} version - Product version the payload reports.
 * @param {string} target - Desktop build target name, such as `win-x64`.
 * @returns {string} Archive filename without its directory.
 */
export function portableArtifactName(version: string, target: 'win-x64'): string {
  return `deepseek-harness-${version}-${target}-portable.zip`
}

/**
 * Describe the portable tree one assembly produces.
 * @param {object} input - Assembly inputs.
 * @param {string} input.unpackedDirectory - electron-builder unpacked output directory.
 * @param {string} input.destination - Directory that becomes the portable edition root.
 * @param {string | undefined} input.updateFeed - Optional update feed URL written into the manifest.
 * @returns Planned layout, manifest, data directories, and the payload directory to copy.
 */
export function portableAssemblyPlan(input: {
  unpackedDirectory: string
  destination: string
  updateFeed?: string
}): {
  root: string
  app: string
  configFile: string
  manifest: PortableConfig
  directories: readonly string[]
  payload: string
} {
  const root = resolve(input.destination)
  const manifest: PortableConfig = {
    ...DEFAULT_PORTABLE_CONFIG,
    ...(input.updateFeed === undefined ? {} : { updateFeed: input.updateFeed }),
  }
  const layout = resolvePortableLayout(root, manifest)
  return {
    root,
    app: layout.app,
    configFile: layout.configFile,
    manifest,
    directories: portableDirectories(layout),
    payload: resolve(input.unpackedDirectory),
  }
}

/**
 * Read the packaged `package.json` version out of an asar archive image.
 * @param {Buffer} image - Whole asar file contents.
 * @returns {string | undefined} Declared version, or undefined when the archive holds no manifest.
 */
export function asarPackageVersion(image: Buffer): string | undefined {
  if (image.length < 16) return undefined
  const headerSize = image.readUInt32LE(4)
  const payloadStart = 8 + headerSize
  if (headerSize <= 16 || payloadStart > image.length) return undefined
  const header = image.subarray(8, payloadStart)
  // The header is a pickle: [payload size][json length][json]. Older writers stored the JSON directly.
  const jsonStart = header[0] === 0x7b ? 0 : 8
  const jsonSize = jsonStart === 0 ? header.length : header.readUInt32LE(4)
  if (jsonSize <= 0 || jsonStart + jsonSize > header.length) return undefined
  const parsed: unknown = JSON.parse(header.subarray(jsonStart, jsonStart + jsonSize).toString('utf8'))
  if (typeof parsed !== 'object' || parsed === null || !('files' in parsed)) return undefined
  const files = parsed.files
  if (typeof files !== 'object' || files === null || !('package.json' in files)) return undefined
  const entry = files['package.json' as keyof typeof files]
  if (typeof entry !== 'object' || entry === null || !('size' in entry) || !('offset' in entry)) return undefined
  const size = Number(entry.size)
  const offset = Number(entry.offset)
  if (!Number.isFinite(size) || !Number.isFinite(offset) || size <= 0 || offset < 0) return undefined
  const start = payloadStart + offset
  if (start + size > image.length) return undefined
  const manifest: unknown = JSON.parse(image.subarray(start, start + size).toString('utf8'))
  if (typeof manifest !== 'object' || manifest === null || !('version' in manifest) || typeof manifest.version !== 'string') return undefined
  return manifest.version
}

/**
 * Read the product version an unpacked build reports.
 * @param {string} unpackedDirectory - electron-builder unpacked output directory.
 * @returns {Promise<string>} Version from the packaged `package.json`.
 */
export async function readUnpackedVersion(unpackedDirectory: string): Promise<string> {
  const resources = join(unpackedDirectory, 'resources')
  const manifestPath = join(resources, 'app', 'package.json')
  try {
    const manifest: unknown = JSON.parse(await readFile(manifestPath, 'utf8'))
    if (typeof manifest === 'object' && manifest !== null && 'version' in manifest && typeof manifest.version === 'string') return manifest.version
    throw new Error(`portable assemble: ${manifestPath} declares no version`)
  } catch (error) {
    if ((error as { code?: string }).code !== 'ENOENT') throw error
  }
  const archivePath = join(resources, 'app.asar')
  const version = asarPackageVersion(await readFile(archivePath))
  if (version === undefined) throw new Error(`portable assemble: ${archivePath} declares no version`)
  return version
}

/**
 * Copy one directory tree, preserving the executable bit of every entry.
 * @param {string} source - Directory to copy from.
 * @param {string} destination - Directory to copy into.
 * @returns {Promise<void>}
 */
async function copyTree(source: string, destination: string): Promise<void> {
  await mkdir(destination, { recursive: true })
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = join(source, entry.name)
    const to = join(destination, entry.name)
    if (entry.isDirectory()) {
      await copyTree(from, to)
      continue
    }
    if (entry.isFile()) {
      await copyFile(from, to)
      continue
    }
    if (entry.isSymbolicLink()) {
      throw new Error(`portable assemble: refusing to copy the link ${from}`)
    }
  }
}

/**
 * Assemble a portable edition and the archive that ships it.
 * @param {object} input - Assembly inputs.
 * @param {string} input.unpackedDirectory - electron-builder unpacked output directory.
 * @param {string} input.destination - Directory that becomes the portable edition root.
 * @param {string} input.archive - Archive path to create.
 * @param {string | undefined} input.updateFeed - Optional update feed URL written into the manifest.
 * @param {(args: readonly string[]) => Promise<void>} input.archiveDirectory - Runs the archiver for `<archive> <directory>`.
 * @returns {Promise<ReturnType<typeof portableAssemblyPlan>>} The assembled plan.
 */
export async function assemblePortable(input: {
  unpackedDirectory: string
  destination: string
  archive: string
  updateFeed?: string
  archiveDirectory: (args: readonly string[]) => Promise<void>
}): Promise<ReturnType<typeof portableAssemblyPlan>> {
  const plan = portableAssemblyPlan(input)
  const unpacked = await stat(plan.payload).catch(() => undefined)
  if (unpacked?.isDirectory() !== true) {
    throw new Error(`portable assemble: ${plan.payload} is not a directory; run the directory package build first`)
  }
  for (const directory of plan.directories) await mkdir(directory, { recursive: true })
  await copyTree(plan.payload, plan.app)
  await writeFile(plan.configFile, serializePortableConfig(plan.manifest), { encoding: 'utf8', mode: 0o600 })
  await input.archiveDirectory([input.archive, plan.root])
  return plan
}

/** Marker file name the portable root discovery looks for. */
export { PORTABLE_MARKER_FILE }
