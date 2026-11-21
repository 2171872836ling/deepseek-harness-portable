import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { onTestFinished, describe, expect, it } from 'vitest'
import { DEFAULT_PORTABLE_CONFIG } from '../src/portable/config.ts'
import {
  portableUpdateBackup,
  portableUpdateRecord,
  portableUpdateStaging,
  resolvePortableLayout,
} from '../src/portable/layout.ts'
import {
  findPortableInstaller,
  portableApplyScript,
  portableInstallerPlan,
  relativeToPortableRoot,
  schedulePortableUpdate,
} from '../src/portable/apply.ts'
import { readPortableUpdateRecord } from '../src/portable/update.ts'

/** Create a layout rooted in a fresh temporary directory. */
async function temporaryLayout(prefix: string) {
  const root = await mkdtemp(join(tmpdir(), prefix))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  return resolvePortableLayout(root, DEFAULT_PORTABLE_CONFIG)
}

describe('portable install invocation', () => {
  it('runs the downloaded installer silently into staging', () => {
    const plan = portableInstallerPlan('E:\\DSH\\updates\\downloads\\setup.exe', 'E:\\DSH\\updates\\staging')
    expect(plan).toEqual({ command: 'E:\\DSH\\updates\\downloads\\setup.exe', args: ['/S', '/D=E:\\DSH\\updates\\staging'] })
  })

  it('picks the installer that carries the requested version', async () => {
    const layout = await temporaryLayout('dsh-portable-installer-')
    const downloads = join(layout.updates, 'downloads')
    await mkdir(downloads, { recursive: true })
    await writeFile(join(downloads, 'DeepSeek-Harness-0.2.1-win-x64.exe'), '', 'utf8')
    await writeFile(join(downloads, 'DeepSeek-Harness-0.2.3-win-x64.exe'), '', 'utf8')
    await writeFile(join(downloads, 'DeepSeek-Harness-0.2.3-win-x64.exe.blockmap'), '', 'utf8')
    expect(await findPortableInstaller(downloads, '0.2.3')).toBe(join(downloads, 'DeepSeek-Harness-0.2.3-win-x64.exe'))
    await expect(findPortableInstaller(downloads, '0.2.9')).rejects.toMatchObject({ code: 'PORTABLE_UPDATE_INSTALLER_MISSING' })
  })

  it('records a location relative to the volume', async () => {
    const layout = await temporaryLayout('dsh-portable-relative-')
    const relative = relativeToPortableRoot(layout, portableUpdateStaging(layout))
    expect(relative.split(/[\\/]/u)).toEqual(['updates', 'staging'])
  })
})

describe('portable apply helper', () => {
  it('waits for this process, installs, swaps, and relaunches', () => {
    const script = portableApplyScript()
    const order = ['waitForExit', 'spawnSync(installer', 'renameSync(app, backup)', 'renameSync(staging, app)', 'spawn(relaunch']
    const positions = order.map(step => script.indexOf(step))
    expect(positions.every(position => position >= 0)).toBe(true)
    expect([...positions].sort((left, right) => left - right)).toEqual(positions)
  })

  it('uses only Node built-ins, because it runs after the application directory moved', () => {
    const script = portableApplyScript()
    const required = [...script.matchAll(/require\('([^']+)'\)/gu)].map(match => match[1])
    expect(required.sort()).toEqual(['node:child_process', 'node:fs'])
  })

  it('writes the transaction record before starting the helper', async () => {
    const layout = await temporaryLayout('dsh-portable-schedule-')
    const calls: { command: string; args: readonly string[]; environment: Readonly<Record<string, string>>; recordPresent: boolean }[] = []
    const record = await schedulePortableUpdate({
      layout,
      fromVersion: '0.2.2',
      toVersion: '0.2.3',
      installerPath: join(layout.updates, 'downloads', 'setup.exe'),
      relaunchExecutable: join(layout.app, 'DSH.exe'),
      helperExecutable: join(layout.app, 'DSH.exe'),
      now: () => new Date('2026-01-02T03:04:05.000Z'),
      spawn: (command, args, environment) => {
        calls.push({ command, args, environment, recordPresent: true })
      },
    })
    expect(record.fromVersion).toBe('0.2.2')
    expect(record.toVersion).toBe('0.2.3')
    expect(record.stagedApp.split(/[\\/]/u)).toEqual(['updates', 'staging'])
    expect(record.backupApp.split(/[\\/]/u)).toEqual(['updates', 'pending-backup'])
    expect(await readPortableUpdateRecord(layout)).toEqual(record)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.environment).toMatchObject({ ELECTRON_RUN_AS_NODE: '1', DSH_PORTABLE_APPLY_PARENT: String(process.pid) })
    const args = calls[0]?.args ?? []
    expect(args[1]).toBe(layout.root)
    expect(args[2]).toBe(join(layout.updates, 'downloads', 'setup.exe'))
    expect(args[3]).toBe(portableUpdateStaging(layout))
    expect(args[4]).toBe(portableUpdateBackup(layout))
    expect(args[5]).toBe(layout.app)
    expect(args[6]).toBe(join(layout.app, 'DSH.exe'))
    expect(await readFile(portableUpdateRecord(layout), 'utf8')).toContain('0.2.3')
    const script = await readFile(args[0] ?? '', 'utf8')
    expect(script).toBe(portableApplyScript())
  })
})
