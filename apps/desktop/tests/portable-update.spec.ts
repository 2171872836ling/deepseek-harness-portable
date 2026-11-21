import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { onTestFinished, describe, expect, it } from 'vitest'
import { DEFAULT_PORTABLE_CONFIG } from '../src/portable/config.ts'
import { resolvePortableLayout, portableUpdateRecord, portableVersionBackups, portableUpdateBackup, portableUpdateStaging } from '../src/portable/layout.ts'
import {
  classifyPortableUpdate,
  clearPortableUpdateRecord,
  PortableUpdateError,
  pruneVersionBackups,
  readPortableUpdateRecord,
  settlePortableUpdate,
  writePortableUpdateRecord,
} from '../src/portable/update.ts'

/** Create a layout rooted in a fresh temporary directory. */
async function temporaryLayout(prefix: string) {
  const root = await mkdtemp(join(tmpdir(), prefix))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  return resolvePortableLayout(root, DEFAULT_PORTABLE_CONFIG)
}

describe('portable update record', () => {
  it('round-trips a transaction written before an install', async () => {
    const layout = await temporaryLayout('dsh-portable-record-')
    const record = await writePortableUpdateRecord({
      layout,
      fromVersion: '0.2.2',
      toVersion: '0.2.3',
      stagedApp: 'updates/staging',
      backupApp: 'updates/pending-backup',
      now: () => new Date('2026-01-02T03:04:05.000Z'),
    })
    expect(record.startedAt).toBe('2026-01-02T03:04:05.000Z')
    expect(await readPortableUpdateRecord(layout)).toEqual(record)
    const raw = await readFile(portableUpdateRecord(layout), 'utf8')
    expect(raw.endsWith('\n')).toBe(true)
    await clearPortableUpdateRecord(layout)
    expect(await readPortableUpdateRecord(layout)).toBeUndefined()
  })

  it('rejects a record whose paths escape the volume', async () => {
    const layout = await temporaryLayout('dsh-portable-record-escape-')
    await mkdir(layout.updates, { recursive: true })
    await writeFile(portableUpdateRecord(layout), `${JSON.stringify({
      recordVersion: 1,
      fromVersion: '0.2.2',
      toVersion: '0.2.3',
      startedAt: '2026-01-02T03:04:05.000Z',
      stagedApp: '../../../Windows',
      backupApp: 'updates/pending-backup',
    })}\n`, 'utf8')
    await expect(readPortableUpdateRecord(layout)).rejects.toMatchObject({ code: 'PORTABLE_UPDATE_RECORD_INVALID' })
  })

  it('rejects a record written by a newer version', async () => {
    const layout = await temporaryLayout('dsh-portable-record-version-')
    await mkdir(layout.updates, { recursive: true })
    await writeFile(portableUpdateRecord(layout), `${JSON.stringify({
      recordVersion: 99,
      fromVersion: '0.2.2',
      toVersion: '0.2.3',
      startedAt: '2026-01-02T03:04:05.000Z',
      stagedApp: 'updates/staging',
      backupApp: 'updates/pending-backup',
    })}\n`, 'utf8')
    const failure = await readPortableUpdateRecord(layout).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(PortableUpdateError)
    expect((failure as PortableUpdateError).code).toBe('PORTABLE_UPDATE_RECORD_UNSUPPORTED')
  })

  it('rejects malformed JSON without guessing the outcome', async () => {
    const layout = await temporaryLayout('dsh-portable-record-json-')
    await mkdir(layout.updates, { recursive: true })
    await writeFile(portableUpdateRecord(layout), '{ nope', 'utf8')
    await expect(readPortableUpdateRecord(layout)).rejects.toMatchObject({ code: 'PORTABLE_UPDATE_RECORD_INVALID' })
  })
})

describe('portable update settlement', () => {
  it('classifies the running version against the record', () => {
    const record = {
      recordVersion: 1,
      fromVersion: '0.2.2',
      toVersion: '0.2.3',
      startedAt: '2026-01-02T03:04:05.000Z',
      stagedApp: 'updates/staging',
      backupApp: 'updates/pending-backup',
    }
    expect(classifyPortableUpdate(record, '0.2.3').kind).toBe('installed')
    expect(classifyPortableUpdate(record, '0.2.2').kind).toBe('rolled-back')
    expect(classifyPortableUpdate(record, '0.2.1').kind).toBe('inconclusive')
  })

  it('archives the replaced application after a successful update', async () => {
    const layout = await temporaryLayout('dsh-portable-settle-installed-')
    const backup = portableUpdateBackup(layout)
    await mkdir(backup, { recursive: true })
    await writeFile(join(backup, 'old.exe'), 'old\n', 'utf8')
    await mkdir(portableUpdateStaging(layout), { recursive: true })
    await writePortableUpdateRecord({ layout, fromVersion: '0.2.2', toVersion: '0.2.3', stagedApp: 'updates/staging', backupApp: 'updates/pending-backup' })
    const outcome = await settlePortableUpdate({ layout, currentVersion: '0.2.3' })
    expect(outcome.kind).toBe('installed')
    expect(await readFile(join(portableVersionBackups(layout), 'version-0.2.2', 'old.exe'), 'utf8')).toBe('old\n')
    expect(await readPortableUpdateRecord(layout)).toBeUndefined()
  })

  it('restores the previous application when the replacement never landed', async () => {
    const layout = await temporaryLayout('dsh-portable-settle-rolled-back-')
    const backup = portableUpdateBackup(layout)
    await mkdir(backup, { recursive: true })
    await writeFile(join(backup, 'DSH.exe'), 'old\n', 'utf8')
    await rm(layout.app, { recursive: true, force: true })
    await writePortableUpdateRecord({ layout, fromVersion: '0.2.2', toVersion: '0.2.3', stagedApp: 'updates/staging', backupApp: 'updates/pending-backup' })
    const outcome = await settlePortableUpdate({ layout, currentVersion: '0.2.2' })
    expect(outcome.kind).toBe('rolled-back')
    expect(await readFile(join(layout.app, 'DSH.exe'), 'utf8')).toBe('old\n')
    expect(await readPortableUpdateRecord(layout)).toBeUndefined()
  })

  it('keeps the record when the state cannot be decided', async () => {
    const layout = await temporaryLayout('dsh-portable-settle-inconclusive-')
    await mkdir(layout.app, { recursive: true })
    await writeFile(join(layout.app, 'DSH.exe'), 'current\n', 'utf8')
    await writePortableUpdateRecord({ layout, fromVersion: '0.2.2', toVersion: '0.2.3', stagedApp: 'updates/staging', backupApp: 'updates/pending-backup' })
    const outcome = await settlePortableUpdate({ layout, currentVersion: '0.2.1' })
    expect(outcome.kind).toBe('inconclusive')
    expect(await readPortableUpdateRecord(layout)).toBeDefined()
  })

  it('does nothing without a record', async () => {
    const layout = await temporaryLayout('dsh-portable-settle-none-')
    expect(await settlePortableUpdate({ layout, currentVersion: '0.2.2' })).toEqual({ kind: 'none' })
  })

  it('keeps only the newest previous versions', async () => {
    const layout = await temporaryLayout('dsh-portable-prune-')
    const versions = portableVersionBackups(layout)
    for (const version of ['version-0.2.0', 'version-0.2.1', 'version-0.2.2', 'version-0.2.3']) {
      await mkdir(join(versions, version), { recursive: true })
    }
    await pruneVersionBackups(versions)
    const { readdir } = await import('node:fs/promises')
    expect((await readdir(versions)).sort()).toEqual(['version-0.2.1', 'version-0.2.2', 'version-0.2.3'])
  })

  it('treats a missing versions directory as nothing to prune', async () => {
    const layout = await temporaryLayout('dsh-portable-prune-absent-')
    await expect(pruneVersionBackups(portableVersionBackups(layout))).resolves.toBeUndefined()
  })
})
