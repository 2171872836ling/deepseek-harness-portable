/**
 * Volume discovery and argument parsing for the portable installer.
 * Kept out of the command-line wrapper so both can be tested without launching a
 * process; the wrapper only prompts and prints.
 * @module
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { PortableVolume } from './install.ts'

const run = promisify(execFile)

/** Arguments accepted by the installer. */
export interface PortableInstallArguments {
  /** Packaged application directory to copy. */
  readonly payload?: string
  /** Directory to install into. */
  readonly target?: string
  /** Update feed written into the manifest. */
  readonly feed?: string
  /** Accept the suggested target without a prompt. */
  readonly yes: boolean
}

/**
 * Parse the command line.
 * @param argv - Arguments after the script path.
 * @returns Parsed options.
 */
export function parsePortableInstallArguments(argv: readonly string[]): PortableInstallArguments {
  const parsed: { payload?: string; target?: string; feed?: string; yes: boolean } = { yes: false }
  const next = (index: number, flag: string): string => {
    const value = argv[index]
    if (value === undefined || value.length === 0) throw new Error(`portable install: ${flag} needs a value`)
    return value
  }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--yes') parsed.yes = true
    else if (argument === '--payload') parsed.payload = next(++index, '--payload')
    else if (argument === '--target') parsed.target = next(++index, '--target')
    else if (argument === '--feed') parsed.feed = next(++index, '--feed')
    else throw new Error(`portable install: unknown argument ${argument ?? ''}`)
  }
  return parsed
}

/** One logical disk as Windows reports it. */
interface LogicalDisk {
  readonly DeviceID: string
  readonly VolumeName?: string | null
  readonly FreeSpace?: number
  readonly DriveType: number
}

/**
 * Classify a Windows drive type.
 * @param driveType - `Win32_LogicalDisk.DriveType`.
 * @returns The volume kind used by the installer.
 */
export function volumeKind(driveType: number): PortableVolume['kind'] {
  if (driveType === 2) return 'removable'
  if (driveType === 3) return 'fixed'
  if (driveType === 4) return 'network'
  return 'unknown'
}

/**
 * Read a `Win32_LogicalDisk` listing.
 * @param raw - JSON produced by `ConvertTo-Json`, a single object or an array.
 * @returns Volumes with a trailing separator on the root.
 */
export function parseVolumeList(raw: string): readonly PortableVolume[] {
  const parsed = JSON.parse(raw.trim() || '[]') as LogicalDisk | LogicalDisk[]
  const entries = Array.isArray(parsed) ? parsed : [parsed]
  return entries.map(entry => ({
    root: entry.DeviceID.endsWith('\\') ? entry.DeviceID : `${entry.DeviceID}\\`,
    label: entry.VolumeName ?? '',
    freeBytes: entry.FreeSpace ?? 0,
    kind: volumeKind(entry.DriveType),
  }))
}

/**
 * Ask Windows for the volumes it can name.
 * @returns Volumes with free space and drive type.
 */
export async function listPortableVolumes(): Promise<readonly PortableVolume[]> {
  const script = [
    'Get-CimInstance Win32_LogicalDisk |',
    'Select-Object DeviceID,VolumeName,FreeSpace,DriveType |',
    'ConvertTo-Json -Compress',
  ].join(' ')
  const { stdout } = await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true })
  return parseVolumeList(stdout)
}

/**
 * Format a volume for the prompt.
 * @param volume - Volume to describe.
 * @returns One line naming the root, label, free space, and kind.
 */
export function describePortableVolume(volume: PortableVolume): string {
  const gigabytes = (volume.freeBytes / 1024 ** 3).toFixed(1)
  return `${volume.root}  ${volume.label || '(no label)'}  ${gigabytes} GiB free  ${volume.kind}`
}
