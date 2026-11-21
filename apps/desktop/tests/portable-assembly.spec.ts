import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { onTestFinished, describe, expect, it } from 'vitest'
import { DEFAULT_PORTABLE_CONFIG, parsePortableConfig } from '../src/portable/config.ts'
import {
  assemblePortable,
  portableArtifactName,
  portableAssemblyPlan,
  readUnpackedVersion,
} from '../scripts/portable-assembly.ts'

/** Create a workspace directory that a test owns. */
async function temporaryRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  return root
}

/** Write a minimal electron-builder unpacked payload. */
async function writeUnpacked(directory: string, version: string): Promise<void> {
  await mkdir(join(directory, 'resources', 'app'), { recursive: true })
  await writeFile(join(directory, 'DSH.exe'), 'exe\n', 'utf8')
  await writeFile(join(directory, 'resources', 'app', 'package.json'), JSON.stringify({ name: 'dsh-desktop', version }), 'utf8')
}

describe('portable assembly plan', () => {
  it('places the payload under app and keeps every data directory inside the volume', () => {
    const plan = portableAssemblyPlan({ unpackedDirectory: 'E:\\build\\win-unpacked', destination: 'E:\\out\\portable' })
    expect(plan.root).toBe('E:\\out\\portable')
    expect(plan.app).toBe('E:\\out\\portable\\app')
    expect(plan.configFile).toBe('E:\\out\\portable\\portable.json')
    expect(plan.manifest).toEqual(DEFAULT_PORTABLE_CONFIG)
    expect(plan.directories.every(directory => directory.startsWith('E:\\out\\portable'))).toBe(true)
  })

  it('writes the update feed into the manifest when one is given', () => {
    const plan = portableAssemblyPlan({
      unpackedDirectory: 'E:\\build\\win-unpacked',
      destination: 'E:\\out\\portable',
      updateFeed: 'https://updates.example.com/desktop/win-x64',
    })
    expect(plan.manifest.updateFeed).toBe('https://updates.example.com/desktop/win-x64')
    expect(parsePortableConfig(JSON.stringify(plan.manifest)).ok).toBe(true)
  })

  it('names the archive after the version and target', () => {
    expect(portableArtifactName('0.2.2', 'win-x64')).toBe('deepseek-harness-0.2.2-win-x64-portable.zip')
  })
})

describe('portable assembly', () => {
  it('copies the unpacked build, writes the manifest, and creates the data directories', async () => {
    const workspace = await temporaryRoot('dsh-portable-assemble-')
    const unpacked = join(workspace, 'win-unpacked')
    await writeUnpacked(unpacked, '0.2.2')
    expect(await readUnpackedVersion(unpacked)).toBe('0.2.2')
    const archiveCalls: (readonly string[])[] = []
    const plan = await assemblePortable({
      unpackedDirectory: unpacked,
      destination: join(workspace, 'edition'),
      archive: join(workspace, 'edition.zip'),
      archiveDirectory: async (args) => { archiveCalls.push(args) },
    })
    expect(await readFile(join(plan.app, 'DSH.exe'), 'utf8')).toBe('exe\n')
    const manifest = parsePortableConfig(await readFile(plan.configFile, 'utf8'))
    expect(manifest.ok).toBe(true)
    expect((await readdir(plan.root)).sort()).toEqual(['app', 'backup', 'cache', 'data', 'logs', 'portable.json', 'updates'])
    expect(archiveCalls).toEqual([[join(workspace, 'edition.zip'), plan.root]])
  })

  it('refuses an unpacked directory that was never built', async () => {
    const workspace = await temporaryRoot('dsh-portable-assemble-missing-')
    await expect(assemblePortable({
      unpackedDirectory: join(workspace, 'absent'),
      destination: join(workspace, 'edition'),
      archive: join(workspace, 'edition.zip'),
      archiveDirectory: async () => undefined,
    })).rejects.toThrow(/not a directory/u)
  })
})
