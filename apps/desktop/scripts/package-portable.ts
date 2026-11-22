/** Build the Windows portable edition from an unpacked Desktop package build. */

import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { desktopTargetBuildPaths } from './desktop-build-paths.mjs'
import {
  assemblePortable,
  portableArtifactName,
  readUnpackedVersion,
  UNPACKED_DIRECTORY_NAME,
} from './portable-assembly.ts'


/** Target whose unpacked payload a portable edition ships. */
const PORTABLE_TARGET = 'win-x64' as const

/** Repository root, the base for the documents a portable edition ships. */
const REPOSITORY_ROOT = resolve(import.meta.dirname, '..', '..', '..')

/** Documents the assembled edition carries at its root, relative to the repository root. */
const PORTABLE_DOCUMENTS: readonly string[] = [
  'docs/user/guide/desktop-portable.md',
  'docs/user/guide/desktop-portable.zh.md',
  'docs/user/guide/desktop-portable-manual.md',
  'docs/user/guide/desktop-portable-manual.zh.md',
  'apps/desktop/README.md',
  'apps/desktop/README.zh.md',
  'apps/desktop/AGENTS.md',
  'LICENSE',
  'NOTICE.md',
  'THIRD_PARTY_NOTICES.md',
]

/**
 * Resolve the documents an assembly carries, honouring an explicit override.
 * @param {string | undefined} override - Comma-separated repository-relative paths; an empty value ships none.
 * @returns {readonly string[]} Absolute document paths.
 */
function resolveDocuments(override: string | undefined): readonly string[] {
  if (override === undefined) return PORTABLE_DOCUMENTS.map(document => join(REPOSITORY_ROOT, document))
  const listed = override.split(',').map(entry => entry.trim()).filter(entry => entry.length > 0)
  return listed.map(document => resolve(REPOSITORY_ROOT, document))
}

/**
 * Run the PowerShell archiver for one directory.
 * @param {readonly string[]} args - Archive path followed by the directory to compress.
 * @returns {Promise<void>} Resolves after the archiver exits successfully.
 */
function archiveDirectory(args: readonly string[]): Promise<void> {
  const [archive, directory] = args
  if (archive === undefined || directory === undefined) throw new Error('portable package: archive arguments are missing')
  const script = `Compress-Archive -Path '${directory}\\*' -DestinationPath '${archive}' -Force`
  return new Promise((fulfil, reject) => {
    const child = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: 'inherit' })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) fulfil()
      else reject(new Error(`portable package: Compress-Archive exited with ${String(code)}`))
    })
  })
}

const { values } = parseArgs({
  options: {
    'unpacked': { type: 'string' },
    'output': { type: 'string' },
    'feed': { type: 'string' },
    'documents': { type: 'string' },
  },
})

const buildPaths = desktopTargetBuildPaths(PORTABLE_TARGET)
const unpackedDirectory = resolve(values.unpacked ?? join(buildPaths.artifacts, UNPACKED_DIRECTORY_NAME))
const outputRoot = resolve(values.output ?? join(buildPaths.root, 'portable'))
const version = await readUnpackedVersion(unpackedDirectory)
const destination = join(outputRoot, `DeepSeek-Harness-${version}-portable`)
const archive = join(outputRoot, portableArtifactName(version, PORTABLE_TARGET))
await mkdir(outputRoot, { recursive: true })
const plan = await assemblePortable({
  unpackedDirectory,
  destination,
  archive,
  ...(values.feed === undefined ? {} : { updateFeed: values.feed }),
  documents: resolveDocuments(values.documents),
  archiveDirectory,
})
process.stdout.write(`portable edition: ${plan.root}\nportable archive: ${archive}\n`)
