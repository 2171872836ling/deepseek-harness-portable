/**
 * Interactive installer for the portable edition.
 * The script lists the volumes Windows reports, asks for a target on removable
 * media, checks space and emptiness, then copies the packaged payload. It never
 * writes the registry, never creates shortcuts, and never installs a service.
 *
 * Usage:
 *   tsx scripts/portable-install.ts [--payload <win-unpacked>] [--target <dir>] [--feed <url>] [--yes]
 * @module
 */

import { createInterface } from 'node:readline/promises'
import { join } from 'node:path'
import {
  checkPortableInstallTarget,
  installPortableEdition,
  measurePortablePayload,
} from '../src/portable/install.ts'
import {
  describePortableVolume,
  listPortableVolumes,
  parsePortableInstallArguments,
} from '../src/portable/install-cli.ts'

/** Ask for a target when the command line did not provide one. */
async function chooseTarget(suggestion: string, acceptSuggestion: boolean): Promise<string> {
  if (acceptSuggestion) return suggestion
  const prompt = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = await prompt.question(`install to [${suggestion}]: `)
    return answer.trim() === '' ? suggestion : answer.trim()
  } finally {
    prompt.close()
  }
}

/** Install the payload, asking for a target when none was given. */
async function main(): Promise<void> {
  const args = parsePortableInstallArguments(process.argv.slice(2))
  const payload = args.payload ?? join(process.cwd(), 'apps', 'desktop', 'dist', 'win-unpacked')
  const facts = await measurePortablePayload(payload)
  if (facts === undefined) throw new Error(`portable install: ${payload} does not exist; package the directory build first`)
  const volumes = await listPortableVolumes()
  const removable = volumes.filter(volume => volume.kind === 'removable')
  if (removable.length === 0) throw new Error('portable install: no removable volume is attached')
  const suggestion = join(removable[0]?.root ?? '', 'DSH')
  if (args.target === undefined) {
    console.log('volumes:')
    for (const volume of volumes) console.log(`  ${describePortableVolume(volume)}`)
  }
  const target = args.target ?? await chooseTarget(suggestion, args.yes)

  const problems = await checkPortableInstallTarget({ source: payload, destination: target, payload: facts, volumes })
  if (problems.length > 0) {
    for (const problem of problems) console.error(`portable install: ${problem.kind}`)
    console.error(`portable install: refusing ${target}. Remove the files, pick another volume, or free space.`)
    process.exitCode = 1
    return
  }
  const result = await installPortableEdition({
    source: payload,
    destination: target,
    payload: facts,
    volumes,
    ...(args.feed === undefined ? {} : { updateFeed: args.feed }),
  })
  console.log(`installed ${result.files} files (${result.bytes} bytes) into ${result.destination}`)
  console.log(`start ${join(result.destination, 'app', 'DeepSeek Harness.exe')}`)
}

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
