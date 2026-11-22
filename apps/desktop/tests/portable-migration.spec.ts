import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { onTestFinished, describe, expect, it } from 'vitest'
import { DEFAULT_PORTABLE_CONFIG } from '../src/portable/config.ts'
import { resolvePortableLayout, portableUserData } from '../src/portable/layout.ts'
import { migrateIntoPortable, migrationCandidates } from '../src/portable/migration.ts'

/** Create a layout rooted in a fresh temporary directory. */
async function temporaryLayout(prefix: string) {
  const root = await mkdtemp(join(tmpdir(), prefix))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  return resolvePortableLayout(root, DEFAULT_PORTABLE_CONFIG)
}

describe('portable migration', () => {
  it('lists the harness home before the desktop user-data directory', async () => {
    const layout = await temporaryLayout('dsh-portable-migration-candidates-')
    const sources = migrationCandidates({
      home: join(layout.root, 'home'),
      appData: join(layout.root, 'roaming'),
      productName: 'DeepSeek Harness',
      layout,
      userData: portableUserData(layout),
    })
    expect(sources.map(source => source.kind)).toEqual(['harness-home', 'desktop-user-data'])
    expect(sources[0]?.path).toBe(join(layout.root, 'home', '.dsh'))
    expect(sources[1]?.path).toBe(join(layout.root, 'roaming', 'DeepSeek Harness'))
  })

  it('imports an existing harness home and logs the copy', async () => {
    const layout = await temporaryLayout('dsh-portable-migration-import-')
    const home = join(layout.root, 'home')
    await mkdir(join(home, '.dsh', 'config'), { recursive: true })
    await writeFile(join(home, '.dsh', 'config', 'settings.json'), '{"a":1}\n', 'utf8')
    const migration = await migrateIntoPortable({
      layout,
      userData: portableUserData(layout),
      sources: migrationCandidates({ home, layout, userData: portableUserData(layout) }),
      now: () => new Date('2026-01-02T03:04:05.000Z'),
    })
    expect(migration.kind).toBe('migrated')
    if (migration.kind !== 'migrated') return
    expect(migration.imported).toHaveLength(1)
    expect(migration.failures).toEqual([])
    expect(await readFile(join(layout.data, 'config', 'settings.json'), 'utf8')).toBe('{"a":1}\n')
    const log = await readFile(migration.logFile, 'utf8')
    expect(log).toContain('imported harness-home')
    expect(migration.logFile).toContain('migration-2026-01-02T03-04-05-000Z.log')
  })

  it('leaves a source in place so the original installation keeps working', async () => {
    const layout = await temporaryLayout('dsh-portable-migration-copy-')
    const home = join(layout.root, 'home')
    await mkdir(join(home, '.dsh'), { recursive: true })
    await writeFile(join(home, '.dsh', 'marker.txt'), 'kept\n', 'utf8')
    await migrateIntoPortable({
      layout,
      userData: portableUserData(layout),
      sources: migrationCandidates({ home, layout, userData: portableUserData(layout) }),
    })
    expect(await readFile(join(home, '.dsh', 'marker.txt'), 'utf8')).toBe('kept\n')
    expect(await readFile(join(layout.data, 'marker.txt'), 'utf8')).toBe('kept\n')
  })

  it('skips the import once the portable home holds data', async () => {
    const layout = await temporaryLayout('dsh-portable-migration-present-')
    const home = join(layout.root, 'home')
    await mkdir(join(home, '.dsh'), { recursive: true })
    await writeFile(join(home, '.dsh', 'marker.txt'), 'source\n', 'utf8')
    await mkdir(layout.data, { recursive: true })
    await writeFile(join(layout.data, 'session.sqlite'), 'portable\n', 'utf8')
    const migration = await migrateIntoPortable({
      layout,
      userData: portableUserData(layout),
      sources: migrationCandidates({ home, layout, userData: portableUserData(layout) }),
    })
    expect(migration).toEqual({ kind: 'skipped', reason: 'data-present' })
    expect(await readFile(join(layout.data, 'session.sqlite'), 'utf8')).toBe('portable\n')
  })

  it('reports no source when no per-user installation exists', async () => {
    const layout = await temporaryLayout('dsh-portable-migration-none-')
    await mkdir(layout.data, { recursive: true })
    const migration = await migrateIntoPortable({
      layout,
      userData: portableUserData(layout),
      sources: migrationCandidates({
        home: join(layout.root, 'absent-home'),
        layout,
        userData: portableUserData(layout),
      }),
    })
    expect(migration).toEqual({ kind: 'skipped', reason: 'no-source' })
  })

  it('records what the source held before copying', async () => {
    const layout = await temporaryLayout('dsh-portable-migration-manifest-')
    const home = join(layout.root, 'home')
    await mkdir(join(home, '.dsh'), { recursive: true })
    await writeFile(join(home, '.dsh', 'settings.json'), '{"a":1}\n', 'utf8')
    const migration = await migrateIntoPortable({
      layout,
      userData: portableUserData(layout),
      sources: migrationCandidates({ home, layout, userData: portableUserData(layout) }),
      now: () => new Date('2026-01-02T03:04:05.000Z'),
    })
    expect(migration.kind).toBe('migrated')
    if (migration.kind !== 'migrated') return
    expect(migration.manifestFile).toContain('migration-2026-01-02T03-04-05-000Z.json')
    const manifest = JSON.parse(await readFile(migration.manifestFile, 'utf8')) as {
      version: number
      sources: { files: number; bytes: number }[]
    }
    expect(manifest.version).toBe(1)
    expect(manifest.sources[0]?.files).toBe(1)
    expect(manifest.sources[0]?.bytes).toBe(Buffer.byteLength('{"a":1}\n'))
  })

  it('moves an unverified copy aside so the next launch starts clean', async () => {
    const layout = await temporaryLayout('dsh-portable-migration-rollback-')
    const home = join(layout.root, 'home')
    await mkdir(join(home, '.dsh'), { recursive: true })
    // A file named like the second destination blocks that import at the copy step.
    await writeFile(join(home, '.dsh', 'user-data'), 'blocker\n', 'utf8')
    const roaming = join(layout.root, 'roaming', 'DeepSeek Harness')
    await mkdir(roaming, { recursive: true })
    await writeFile(join(roaming, 'note.txt'), 'desktop\n', 'utf8')
    const migration = await migrateIntoPortable({
      layout,
      userData: portableUserData(layout),
      sources: migrationCandidates({
        home,
        appData: join(layout.root, 'roaming'),
        productName: 'DeepSeek Harness',
        layout,
        userData: portableUserData(layout),
      }),
      now: () => new Date('2026-01-02T03:04:05.000Z'),
    })
    expect(migration.kind).toBe('migrated')
    if (migration.kind !== 'migrated') return
    expect(migration.failures).toHaveLength(1)
    const log = await readFile(migration.logFile, 'utf8')
    expect(log).toContain('moved incomplete copy aside')
    const discarded = join(layout.backup, 'migration', '2026-01-02T03-04-05-000Z', 'desktop-user-data')
    expect(await readFile(discarded, 'utf8')).toBe('blocker\n')
  })

  it('imports over the directories the bootstrap pre-creates', async () => {
    const layout = await temporaryLayout('dsh-portable-migration-bootstrap-')
    const home = join(layout.root, 'home')
    await mkdir(join(home, '.dsh', 'storages'), { recursive: true })
    await writeFile(join(home, '.dsh', 'storages', 'workspace.json'), '{"workspaces":[]}\n', 'utf8')
    // What initializePortableDesktop leaves behind before the import runs.
    await mkdir(portableUserData(layout), { recursive: true })
    await mkdir(join(layout.data, 'downloads'), { recursive: true })
    const migration = await migrateIntoPortable({
      layout,
      userData: portableUserData(layout),
      sources: migrationCandidates({ home, layout, userData: portableUserData(layout) }),
      now: () => new Date('2026-01-02T03:04:05.000Z'),
    })
    expect(migration.kind).toBe('migrated')
    if (migration.kind !== 'migrated') return
    expect(migration.imported.map(source => source.kind)).toEqual(['harness-home'])
    expect(await readFile(join(layout.data, 'storages', 'workspace.json'), 'utf8')).toBe('{"workspaces":[]}\n')
  })

  it('keeps a pre-created user-data directory empty until the desktop source fills it', async () => {
    const layout = await temporaryLayout('dsh-portable-migration-userdata-')
    const home = join(layout.root, 'home')
    await mkdir(join(home, '.dsh'), { recursive: true })
    await writeFile(join(home, '.dsh', 'marker.txt'), 'harness\n', 'utf8')
    await mkdir(portableUserData(layout), { recursive: true })
    const migration = await migrateIntoPortable({
      layout,
      userData: portableUserData(layout),
      sources: migrationCandidates({ home, layout, userData: portableUserData(layout) }),
    })
    expect(migration.kind).toBe('migrated')
    // The harness source must not write into data\ root twice, and the empty
    // user-data directory must survive as a directory, not become a file.
    expect(await readdir(portableUserData(layout))).toEqual([])
    expect(await readdir(layout.data)).toEqual(expect.arrayContaining(['marker.txt', 'user-data']))
  })

  it('still skips when the portable home already holds a session', async () => {
    const layout = await temporaryLayout('dsh-portable-migration-session-')
    const home = join(layout.root, 'home')
    await mkdir(join(home, '.dsh'), { recursive: true })
    await writeFile(join(home, '.dsh', 'marker.txt'), 'source\n', 'utf8')
    await mkdir(join(layout.data, 'sessions', '--group--'), { recursive: true })
    await writeFile(join(layout.data, 'sessions', '--group--', 'session.v4.jsonl.zstd'), '', 'utf8')
    const migration = await migrateIntoPortable({
      layout,
      userData: portableUserData(layout),
      sources: migrationCandidates({ home, layout, userData: portableUserData(layout) }),
    })
    expect(migration).toEqual({ kind: 'skipped', reason: 'data-present' })
  })

  it.skipIf(process.platform === 'win32')('rolls back when no source can be imported', async () => {
    const layout = await temporaryLayout('dsh-portable-migration-failed-')
    const home = join(layout.root, 'home')
    await mkdir(join(home, '.dsh'), { recursive: true })
    const unreadable = join(home, '.dsh', 'secret.json')
    await writeFile(unreadable, '{"a":1}\n', 'utf8')
    await chmod(unreadable, 0o000)
    onTestFinished(() => chmod(unreadable, 0o600).catch(() => undefined))
    const migration = await migrateIntoPortable({
      layout,
      userData: portableUserData(layout),
      sources: migrationCandidates({ home, layout, userData: portableUserData(layout) }),
      now: () => new Date('2026-01-02T03:04:05.000Z'),
    })
    expect(migration.kind).toBe('rolled-back')
    if (migration.kind !== 'rolled-back') return
    expect(migration.failures).toHaveLength(1)
    const log = await readFile(migration.logFile, 'utf8')
    expect(log).toContain('failed harness-home')
    await expect(readdir(layout.data)).resolves.toEqual([])
  })
})
