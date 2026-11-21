import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { onTestFinished, describe, expect, it } from 'vitest'
import {
  createPortableSnapshot,
  findPortableSnapshot,
  listPortableSnapshots,
  PORTABLE_SNAPSHOTS_RETAINED,
  PortableSnapshotError,
  prunePortableSnapshots,
  restorePortableSnapshot,
} from '../src/portable/backup.ts'
import { DEFAULT_PORTABLE_CONFIG, serializePortableConfig } from '../src/portable/config.ts'
import { portableSnapshotDirectory, portableVersionBackups, resolvePortableLayout } from '../src/portable/layout.ts'
import { parsePortableBackupArguments, runPortableBackupCommand } from '../src/portable/snapshot-cli.ts'

/** Create a layout rooted in a fresh temporary directory holding one harness-home file. */
async function seededLayout(prefix: string) {
  const root = await mkdtemp(join(tmpdir(), prefix))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const layout = resolvePortableLayout(root, DEFAULT_PORTABLE_CONFIG)
  await mkdir(join(layout.data, 'profiles', 'desktop'), { recursive: true })
  await writeFile(join(layout.data, 'profiles', 'desktop', 'settings.json'), '{"channel":"nightly"}\n', 'utf8')
  await writeFile(layout.configFile, serializePortableConfig(DEFAULT_PORTABLE_CONFIG), 'utf8')
  return layout
}

describe('portable snapshots', () => {
  it('copies the harness home and records what it held', async () => {
    const layout = await seededLayout('dsh-portable-snapshot-create-')
    const snapshot = await createPortableSnapshot({
      layout,
      reason: 'manual',
      now: () => new Date('2026-01-02T03:04:05.000Z'),
    })
    expect(snapshot.directory).toBe(portableSnapshotDirectory(layout, '2026-01-02T03:04:05.000Z'))
    expect(snapshot.files).toBe(1)
    expect(snapshot.bytes).toBe(Buffer.byteLength('{"channel":"nightly"}\n'))
    expect(await readFile(join(snapshot.directory, 'home', 'profiles', 'desktop', 'settings.json'), 'utf8'))
      .toBe('{"channel":"nightly"}\n')
    expect(await readFile(join(snapshot.directory, 'portable.json'), 'utf8')).toBe(serializePortableConfig(DEFAULT_PORTABLE_CONFIG))
    const manifest = JSON.parse(await readFile(snapshot.manifestFile, 'utf8')) as { reason: string; files: number }
    expect(manifest).toMatchObject({ reason: 'manual', files: 1 })
  })

  it('lists snapshots newest first and prunes beyond the retention limit', async () => {
    const layout = await seededLayout('dsh-portable-snapshot-prune-')
    for (const day of ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04']) {
      await createPortableSnapshot({ layout, reason: day, now: () => new Date(`${day}T00:00:00.000Z`) })
    }
    const listed = await listPortableSnapshots(layout)
    expect(listed).toHaveLength(PORTABLE_SNAPSHOTS_RETAINED)
    expect(listed[0]?.reason).toBe('2026-01-04')
    await prunePortableSnapshots(layout, 1)
    expect(await readdir(join(layout.backup, 'snapshots'))).toHaveLength(1)
  })

  it('reports an error instead of an empty snapshot when the harness home is absent', async () => {
    const layout = await seededLayout('dsh-portable-snapshot-empty-')
    await rm(layout.data, { recursive: true, force: true })
    await expect(createPortableSnapshot({ layout, reason: 'manual' })).rejects.toThrow(PortableSnapshotError)
  })

  it('restores a snapshot and keeps the replaced home beside it', async () => {
    const layout = await seededLayout('dsh-portable-snapshot-restore-')
    const snapshot = await createPortableSnapshot({ layout, reason: 'before change', now: () => new Date('2026-01-02T03:04:05.000Z') })
    await writeFile(join(layout.data, 'profiles', 'desktop', 'settings.json'), '{"channel":"stable"}\n', 'utf8')
    await restorePortableSnapshot({ layout, snapshot, now: () => new Date('2026-01-03T00:00:00.000Z') })
    expect(await readFile(join(layout.data, 'profiles', 'desktop', 'settings.json'), 'utf8')).toBe('{"channel":"nightly"}\n')
    const superseded = join(portableVersionBackups(layout), '..', 'restore', '2026-01-03T00-00-00-000Z', 'home', 'profiles', 'desktop', 'settings.json')
    expect(await readFile(superseded, 'utf8')).toBe('{"channel":"stable"}\n')
  })

  it('puts the previous home back when the snapshot no longer matches its manifest', async () => {
    const layout = await seededLayout('dsh-portable-snapshot-mismatch-')
    const snapshot = await createPortableSnapshot({ layout, reason: 'before change', now: () => new Date('2026-01-02T03:04:05.000Z') })
    await writeFile(join(snapshot.directory, 'home', 'profiles', 'desktop', 'settings.json'), '{"channel":"tampered"}\n', 'utf8')
    await expect(restorePortableSnapshot({ layout, snapshot })).rejects.toThrow(PortableSnapshotError)
    expect(await readFile(join(layout.data, 'profiles', 'desktop', 'settings.json'), 'utf8')).toBe('{"channel":"nightly"}\n')
  })

  it('selects a snapshot by name or by the latest entry', async () => {
    const layout = await seededLayout('dsh-portable-snapshot-find-')
    await createPortableSnapshot({ layout, reason: 'first', now: () => new Date('2026-01-02T03:04:05.000Z') })
    await createPortableSnapshot({ layout, reason: 'second', now: () => new Date('2026-01-03T03:04:05.000Z') })
    expect((await findPortableSnapshot(layout, 'latest')).reason).toBe('second')
    expect((await findPortableSnapshot(layout, '2026-01-02T03-04-05-000Z')).reason).toBe('first')
    await expect(findPortableSnapshot(layout, 'missing')).rejects.toThrow(/no snapshot named missing/u)
  })

  it('reports no snapshots on a fresh volume', async () => {
    const layout = await seededLayout('dsh-portable-snapshot-none-')
    expect(await listPortableSnapshots(layout)).toEqual([])
    await expect(findPortableSnapshot(layout, 'latest')).rejects.toThrow(/holds no snapshots/u)
  })
})

describe('portable snapshot commands', () => {
  it('creates, lists, and restores through the command surface', async () => {
    const layout = await seededLayout('dsh-portable-snapshot-command-')
    expect(await runPortableBackupCommand([layout.root, 'list'])).toBe('no snapshots')
    expect(await runPortableBackupCommand([layout.root, 'create', 'before upgrade'])).toContain('(1 files)')
    const listed = await runPortableBackupCommand([layout.root, 'list'])
    expect(listed).toContain('before upgrade')
    expect(await runPortableBackupCommand([layout.root, 'restore', 'latest'])).toContain('restored')
  })

  it('rejects an unknown action and a restore without a snapshot', async () => {
    expect(() => parsePortableBackupArguments(['E:\\DSH', 'explode'])).toThrow(/unknown action/u)
    expect(() => parsePortableBackupArguments(['E:\\DSH', 'restore'])).toThrow(/needs a snapshot/u)
    expect(() => parsePortableBackupArguments([])).toThrow(/usage/u)
  })
})
