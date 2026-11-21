import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { onTestFinished, describe, expect, it } from 'vitest'
import { parsePortableConfig, DEFAULT_PORTABLE_CONFIG } from '../src/portable/config.ts'
import {
  checkPortableInstallTarget,
  installPortableEdition,
  measurePortablePayload,
  PORTABLE_INSTALL_SPACE_MARGIN,
  readInstalledManifest,
  type PortableVolume,
} from '../src/portable/install.ts'
import { describePortableVolume, parsePortableInstallArguments, parseVolumeList, volumeKind } from '../src/portable/install-cli.ts'

/** Temporary directory holding a payload shaped like the packaged directory build. */
async function temporaryPayload(prefix: string) {
  const root = await mkdtemp(join(tmpdir(), prefix))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const payload = join(root, 'win-unpacked')
  await mkdir(join(payload, 'resources', 'app'), { recursive: true })
  await writeFile(join(payload, 'DeepSeek Harness.exe'), 'binary\n', 'utf8')
  await writeFile(join(payload, 'resources', 'app', 'package.json'), '{"version":"0.2.2"}\n', 'utf8')
  const facts = await measurePortablePayload(payload)
  if (facts === undefined) throw new Error('payload not created')
  return { root, payload, facts }
}

/** A removable volume that can hold the payload. */
function removableVolume(root: string, freeBytes = 8 * 1024 ** 3): PortableVolume {
  return { root, label: 'USB', freeBytes, kind: 'removable' }
}

describe('portable installer checks', () => {
  it('measures the payload it is about to copy', async () => {
    const { facts } = await temporaryPayload('dsh-portable-install-measure-')
    expect(facts.files).toBe(2)
    expect(facts.bytes).toBe(Buffer.byteLength('binary\n') + Buffer.byteLength('{"version":"0.2.2"}\n'))
  })

  it('accepts an empty directory on a removable volume', async () => {
    const { root, payload, facts } = await temporaryPayload('dsh-portable-install-ok-')
    const destination = join(root, 'E', 'DSH')
    await mkdir(destination, { recursive: true })
    const problems = await checkPortableInstallTarget({
      source: payload,
      destination,
      payload: facts,
      volumes: [removableVolume(join(root, 'E') + '\\')],
    })
    expect(problems).toEqual([])
  })

  it('refuses a fixed drive, an unknown volume, a full volume, and an occupied target', async () => {
    const { root, payload, facts } = await temporaryPayload('dsh-portable-install-refuse-')
    const destination = join(root, 'C', 'DSH')
    await mkdir(destination, { recursive: true })
    await writeFile(join(destination, 'leftover.txt'), 'x\n', 'utf8')
    const fixed = await checkPortableInstallTarget({
      source: payload,
      destination,
      payload: facts,
      volumes: [{ root: join(root, 'C') + '\\', label: '', freeBytes: 8 * 1024 ** 3, kind: 'fixed' }],
    })
    expect(fixed.map(problem => problem.kind)).toEqual(['fixed-volume', 'occupied-target'])
    const unknown = await checkPortableInstallTarget({ source: payload, destination, payload: facts, volumes: [] })
    expect(unknown.map(problem => problem.kind)).toContain('unknown-volume')
    const full = await checkPortableInstallTarget({
      source: payload,
      destination,
      payload: facts,
      volumes: [removableVolume(join(root, 'C') + '\\', PORTABLE_INSTALL_SPACE_MARGIN - 1)],
    })
    expect(full.map(problem => problem.kind)).toContain('insufficient-space')
  })

  it('installs the payload and writes a manifest last', async () => {
    const { root, payload, facts } = await temporaryPayload('dsh-portable-install-run-')
    const volumeRoot = join(root, 'E') + '\\'
    const destination = join(root, 'E', 'DSH')
    await mkdir(join(root, 'E', 'DSH'), { recursive: true })
    expect(await readInstalledManifest(destination)).toBeUndefined()
    const result = await installPortableEdition({
      source: payload,
      destination,
      payload: facts,
      volumes: [removableVolume(volumeRoot)],
      updateFeed: 'https://updates.example.invalid/channel',
    })
    expect(result.files).toBe(2)
    expect(await readFile(join(destination, 'app', 'DeepSeek Harness.exe'), 'utf8')).toBe('binary\n')
    const config = parsePortableConfig(await readFile(result.configFile, 'utf8'))
    expect(config.ok).toBe(true)
    if (!config.ok) return
    expect(config.config.portableMode).toBe(true)
    expect(config.config.updateFeed).toBe('https://updates.example.invalid/channel')
  })

  it('names the reasons when it refuses a destination', async () => {
    const { root, payload, facts } = await temporaryPayload('dsh-portable-install-error-')
    const destination = join(root, 'C', 'DSH')
    await mkdir(destination, { recursive: true })
    await expect(installPortableEdition({
      source: payload,
      destination,
      payload: facts,
      volumes: [{ root: join(root, 'C') + '\\', label: '', freeBytes: 8 * 1024 ** 3, kind: 'fixed' }],
    })).rejects.toThrow(/fixed drive/u)
  })
})

describe('portable installer arguments and volumes', () => {
  it('parses the documented options', () => {
    expect(parsePortableInstallArguments(['--payload', 'p', '--target', 't', '--feed', 'f', '--yes']))
      .toEqual({ payload: 'p', target: 't', feed: 'f', yes: true })
    expect(parsePortableInstallArguments([])).toEqual({ yes: false })
    expect(() => parsePortableInstallArguments(['--nope'])).toThrow(/unknown argument/u)
  })

  it('classifies drive types and normalizes roots', () => {
    expect(volumeKind(2)).toBe('removable')
    expect(volumeKind(3)).toBe('fixed')
    expect(volumeKind(4)).toBe('network')
    expect(volumeKind(1)).toBe('unknown')
    expect(parseVolumeList(JSON.stringify({ DeviceID: 'E:', VolumeName: 'USB', FreeSpace: 1024, DriveType: 2 })))
      .toEqual([{ root: 'E:\\', label: 'USB', freeBytes: 1024, kind: 'removable' }])
    expect(parseVolumeList('')).toEqual([])
  })

  it('describes a volume for the prompt', () => {
    expect(describePortableVolume(removableVolume('E:\\', 8 * 1024 ** 3))).toBe('E:\\  USB  8.0 GiB free  removable')
    expect(describePortableVolume({ root: 'F:\\', label: '', freeBytes: 0, kind: 'unknown' })).toContain('(no label)')
  })

  it('measures nothing for a missing payload directory', async () => {
    expect(await measurePortablePayload(join(tmpdir(), 'dsh-portable-install-absent-'))).toBeUndefined()
  })
})

describe('portable manifest defaults', () => {
  it('keeps the documented default directories', () => {
    expect(DEFAULT_PORTABLE_CONFIG.dataDirectory).toBe('data')
    expect(DEFAULT_PORTABLE_CONFIG.backupDirectory).toBe('backup')
  })
})
